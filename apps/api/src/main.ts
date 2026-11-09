import { createApp } from "./app.js";
try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  /* explicit env also supported */
}
const databaseUrl = process.env.DATABASE_URL,
  secret = process.env.PLAYITA_JWT_SECRET;
if (!databaseUrl || !secret)
  throw Error("Configure DATABASE_URL and PLAYITA_JWT_SECRET; see README");
const server = await createApp({ databaseUrl, secret });
await server.app.listen(Number(process.env.PORT || 4300), "127.0.0.1");
console.log("Playita API http://127.0.0.1:" + String(process.env.PORT || 4300));
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
