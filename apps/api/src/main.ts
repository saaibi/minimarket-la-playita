import { createApp } from "./app.js";
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  /* explicit env also supported */
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw Error("DATABASE_URL required");
let verificationProvider;
if (process.env.WHATSAPP_PROVIDER === "twilio") {
  const { TwilioVerify } = await import("./verification.js");
  verificationProvider = new TwilioVerify(
    process.env.TWILIO_ACCOUNT_SID || "",
    process.env.TWILIO_AUTH_TOKEN || "",
    process.env.TWILIO_VERIFY_SERVICE_SID || "",
  );
}
const googleVerifier = process.env.GOOGLE_WEB_CLIENT_ID
  ? new (await import("./google.js")).GoogleIdVerifier(
      process.env.GOOGLE_WEB_CLIENT_ID,
    )
  : undefined;
const server = await createApp({
  googleVerifier,
  databaseUrl,
  production: process.env.NODE_ENV === "production",
  origins: process.env.CORS_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  verificationProvider,
});
const host =
  process.env.HOST ||
  (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT || 4300);
await server.app.listen(port, host);
console.log(`Playita API listening on ${host}:${port}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
