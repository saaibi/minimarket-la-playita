import { Pool } from "pg";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
import { databaseOptions } from "../apps/api/src/database-options.js";

// Owner-controlled one-time setup in Render's secure environment panel.
// No public endpoint, no fixed account, no password reset on restart.
if (process.env.PLAYITA_BOOTSTRAP_ADMIN === "once") {
  const email = process.env.PLAYITA_ADMIN_EMAIL;
  const password = process.env.PLAYITA_ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  if (!email || !password || !databaseUrl) {
    console.error(
      "Admin bootstrap configuration incomplete; set values in secure provider panel.",
    );
    process.exitCode = 1;
  } else {
    const pool = new Pool(databaseOptions(databaseUrl));
    try {
      const created = await bootstrapAdmin(pool, email, password, {
        onlyIfMissing: true,
      });
      console.log(
        created
          ? "First administrator provisioned; remove temporary bootstrap variables."
          : "Administrator already exists; no credentials changed.",
      );
    } catch {
      console.error(
        "Admin bootstrap failed; check secure configuration and database. No credentials are printed.",
      );
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  }
}
