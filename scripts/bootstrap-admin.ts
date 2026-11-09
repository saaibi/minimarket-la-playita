import { Pool } from "pg";
import { databaseOptions } from "../apps/api/src/database-options.js";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}
const { DATABASE_URL, PLAYITA_ADMIN_EMAIL, PLAYITA_ADMIN_PASSWORD } =
  process.env;
if (!DATABASE_URL || !PLAYITA_ADMIN_EMAIL || !PLAYITA_ADMIN_PASSWORD)
  throw Error(
    "Configura DATABASE_URL, PLAYITA_ADMIN_EMAIL y PLAYITA_ADMIN_PASSWORD localmente, sin argumentos ni credenciales fijas.",
  );
const pool = new Pool(databaseOptions(DATABASE_URL));
try {
  await bootstrapAdmin(pool, PLAYITA_ADMIN_EMAIL, PLAYITA_ADMIN_PASSWORD);
  console.log(
    "Primer administrador provisionado. No se imprimen credenciales.",
  );
} finally {
  await pool.end();
}
