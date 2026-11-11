import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
export interface GoogleIdentity {
  subject: string;
  email: string;
}
export interface GoogleVerifier {
  clientId: string;
  verify(token: string, nonce: string): Promise<GoogleIdentity>;
}
/** Only Google's public signing keys in production. Constructor key injection is for local signed-token tests. */
export class GoogleIdVerifier implements GoogleVerifier {
  private keys: JWTVerifyGetKey;
  constructor(
    readonly clientId: string,
    keys?: JWTVerifyGetKey,
  ) {
    if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId))
      throw Error("Invalid Google client ID");
    this.keys =
      keys ??
      createRemoteJWKSet(
        new URL("https://www.googleapis.com/oauth2/v3/certs"),
        { timeoutDuration: 5000 },
      );
  }
  async verify(token: string, nonce: string): Promise<GoogleIdentity> {
    const { payload } = await jwtVerify(token, this.keys, {
      algorithms: ["RS256"],
      audience: this.clientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      requiredClaims: ["sub", "exp", "iat", "email", "nonce"],
      maxTokenAge: "10 minutes",
    });
    if (
      payload.nonce !== nonce ||
      payload.email_verified !== true ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      payload.sub.length > 255 ||
      typeof payload.email !== "string" ||
      payload.email.length > 254 ||
      !payload.email.includes("@")
    )
      throw Error("Invalid Google identity");
    return { subject: payload.sub, email: payload.email.toLowerCase() };
  }
}
