import { ZodError } from "zod";
/** Only fixed codes, never raw messages, SQL details, input values or stack traces. */
export function bootstrapFailureCodes(error: unknown): string[] {
  if (error instanceof ZodError)
    return [
      ...new Set(
        error.issues.map((issue) => {
          if (issue.path[0] === "email") return "ADMIN_EMAIL_INVALID";
          if (issue.path[0] === "password") {
            if (issue.code === "too_small") return "ADMIN_PASSWORD_TOO_SHORT";
            if (issue.code === "too_big") return "ADMIN_PASSWORD_TOO_LONG";
            return "ADMIN_PASSWORD_INVALID";
          }
          return "ADMIN_CONFIGURATION_INVALID";
        }),
      ),
    ];
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  switch (code) {
    case "23505":
      return ["BOOTSTRAP_IDENTITY_CONFLICT"];
    case "42501":
      return ["BOOTSTRAP_DB_PERMISSION_DENIED"];
    case "42P01":
    case "42703":
      return ["BOOTSTRAP_SCHEMA_MISSING"];
    case "28P01":
    case "28000":
      return ["BOOTSTRAP_DB_AUTH_FAILED"];
    case "ENOTFOUND":
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "53300":
      return ["BOOTSTRAP_DB_UNAVAILABLE"];
    case "ERR_CRYPTO_INVALID_SCRYPT_PARAMS":
      return ["BOOTSTRAP_HASH_CONFIGURATION_INVALID"];
    default:
      return ["BOOTSTRAP_UNKNOWN_FAILURE"];
  }
}
