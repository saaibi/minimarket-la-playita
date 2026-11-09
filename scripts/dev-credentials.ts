import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
const env = new URL("../.env", import.meta.url);
let content = "";
try {
  content = await readFile(env, "utf8");
} catch {
  content = await readFile(new URL("../.env.example", import.meta.url), "utf8");
}
let secret = content.match(/^PLAYITA_JWT_SECRET=(.+)$/m)?.[1]?.trim();
if (!secret) {
  secret = randomBytes(48).toString("base64url");
  content = content.replace(
    /^PLAYITA_JWT_SECRET=.*$/m,
    "PLAYITA_JWT_SECRET=" + secret,
  );
  await writeFile(env, content, { mode: 0o600 });
}
const tokens: Record<string, string> = {};
for (const role of ["admin", "seller", "buyer"])
  tokens[role] = await new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("local-" + role)
    .setIssuer("playita-local")
    .setAudience("playita-api")
    .setExpirationTime("8h")
    .sign(new TextEncoder().encode(secret));
await mkdir(new URL("../.runtime/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../.runtime/dev-tokens.json", import.meta.url),
  JSON.stringify(tokens, null, 2),
  { mode: 0o600 },
);
console.log(
  "Credenciales de desarrollo escritas en .runtime/dev-tokens.json (excluido de Git). Caducan en 8 h. No son cuentas de producción.",
);
