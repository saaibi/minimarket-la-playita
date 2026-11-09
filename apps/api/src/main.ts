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
const server = await createApp({
  databaseUrl,
  production: process.env.NODE_ENV === "production",
  origins: process.env.CORS_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  verificationProvider,
});
await server.app.listen(Number(process.env.PORT || 4300), "127.0.0.1");
console.log("Playita API http://127.0.0.1:" + String(process.env.PORT || 4300));
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
