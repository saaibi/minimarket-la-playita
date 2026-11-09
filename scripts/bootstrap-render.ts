import { Pool } from "pg";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
import { databaseOptions } from "../apps/api/src/database-options.js";
import { bootstrapFailureCodes } from "../apps/api/src/bootstrap-diagnostics.js";

// Optional owner setup never bypasses validation, changes an existing account,
// or prevents the otherwise healthy API from serving its authorized guest flow.
const flag = process.env.PLAYITA_BOOTSTRAP_ADMIN;
if (flag && flag !== "once") {
  console.error(
    "ADMIN_BOOTSTRAP_FLAG_INVALID: PLAYITA_BOOTSTRAP_ADMIN must be once; bootstrap not attempted.",
  );
} else if (flag === "once") {
  const email = process.env.PLAYITA_ADMIN_EMAIL;
  const password = process.env.PLAYITA_ADMIN_PASSWORD;
  const databaseUrl = process.env.DATABASE_URL;
  const missing = [
    !email && "ADMIN_EMAIL_MISSING",
    !password && "ADMIN_PASSWORD_MISSING",
    !databaseUrl && "BOOTSTRAP_DATABASE_URL_MISSING",
  ].filter(Boolean);
  if (missing.length) {
    console.error(
      "Admin bootstrap not completed: " +
        missing.join(",") +
        ". API startup continues; no account created.",
    );
  } else {
    let pool: Pool | undefined;
    try {
      pool = new Pool(databaseOptions(databaseUrl!));
      const created = await bootstrapAdmin(pool, email!, password!, {
        onlyIfMissing: true,
      });
      console.log(
        created
          ? "ADMIN_BOOTSTRAP_CREATED: first administrator provisioned; remove temporary bootstrap variables after successful owner login."
          : "ADMIN_BOOTSTRAP_ALREADY_EXISTS: no credentials changed.",
      );
    } catch (error) {
      console.error(
        "Admin bootstrap not completed: " +
          bootstrapFailureCodes(error).join(",") +
          ". API startup continues; no credentials printed or defaults enabled.",
      );
    } finally {
      await pool?.end();
    }
  }
}
