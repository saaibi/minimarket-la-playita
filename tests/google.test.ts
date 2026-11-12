import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet } from "jose";
import { GoogleIdVerifier } from "../apps/api/src/google.js";
test("Google JWT: HTTP JWKS, firma, audiencia, emisor, nonce, vencimiento y correo verificado", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "local-test" };
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const verifier = new GoogleIdVerifier(
    "test.apps.googleusercontent.com",
    createRemoteJWKSet(new URL(`http://127.0.0.1:${address.port}/jwks`), {
      timeoutDuration: 1000,
    }),
  );
  async function token(
    overrides: Record<string, unknown> = {},
    key = privateKey,
  ) {
    return new SignJWT({
      sub: "test-subject",
      email: "buyer@example.invalid",
      email_verified: true,
      nonce: "nonce-test",
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "local-test" })
      .setIssuer("https://accounts.google.com")
      .setAudience("test.apps.googleusercontent.com")
      .setIssuedAt()
      .setExpirationTime("5 minutes")
      .sign(key);
  }
  try {
    assert.deepEqual(await verifier.verify(await token(), "nonce-test"), {
      subject: "test-subject",
      email: "buyer@example.invalid",
      emailAuthoritative: false,
    });
    assert.ok(requests > 0);
    assert.equal(
      (
        await verifier.verify(
          await token({ email: "owner@gmail.com" }),
          "nonce-test",
        )
      ).emailAuthoritative,
      true,
    );
    assert.equal(
      (
        await verifier.verify(
          await token({
            email: "owner@example.invalid",
            hd: "example.invalid",
          }),
          "nonce-test",
        )
      ).emailAuthoritative,
      true,
    );

    for (const overrides of [
      { nonce: "other" },
      { email_verified: false },
      { sub: "" },
    ])
      await assert.rejects(
        verifier.verify(await token(overrides), "nonce-test"),
      );
    const wrongAudience = await new SignJWT({
      sub: "x",
      email: "x@example.invalid",
      email_verified: true,
      nonce: "nonce-test",
    })
      .setProtectedHeader({ alg: "RS256", kid: "local-test" })
      .setIssuer("https://accounts.google.com")
      .setAudience("other")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await assert.rejects(verifier.verify(wrongAudience, "nonce-test"));
    for (const [issuer, expiry] of [
      ["https://attacker.invalid", "5m"],
      ["https://accounts.google.com", "-1m"],
    ]) {
      const t = await new SignJWT({
        sub: "x",
        email: "x@example.invalid",
        email_verified: true,
        nonce: "nonce-test",
      })
        .setProtectedHeader({ alg: "RS256", kid: "local-test" })
        .setIssuer(issuer!)
        .setAudience("test.apps.googleusercontent.com")
        .setIssuedAt()
        .setExpirationTime(expiry!)
        .sign(privateKey);
      await assert.rejects(verifier.verify(t, "nonce-test"));
    }
    const other = await generateKeyPair("RS256");
    await assert.rejects(
      verifier.verify(await token({}, other.privateKey), "nonce-test"),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const failing = createServer((_req, res) => {
    res.statusCode = 503;
    res.end();
  });
  await new Promise<void>((resolve) => failing.listen(0, "127.0.0.1", resolve));
  try {
    const a = failing.address() as { port: number };
    const unavailable = new GoogleIdVerifier(
      "test.apps.googleusercontent.com",
      createRemoteJWKSet(new URL(`http://127.0.0.1:${a.port}/jwks`), {
        timeoutDuration: 1000,
      }),
    );
    await assert.rejects(unavailable.verify(await token(), "nonce-test"));
  } finally {
    await new Promise<void>((resolve) => failing.close(() => resolve()));
  }
});
