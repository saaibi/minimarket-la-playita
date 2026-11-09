import type { PoolConfig } from "pg";

/** Shared by the API, migration runner and first-admin command. */
export function databaseOptions(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  for (const name of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    if (url.searchParams.has(name))
      throw Error("Use DATABASE_TLS_MODE instead of URL TLS parameters");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const mode =
    process.env.DATABASE_TLS_MODE || (local ? "local" : "verify-full");
  let ssl: PoolConfig["ssl"];
  if (mode === "local" && local) ssl = false;
  else if (mode === "verify-full") ssl = { rejectUnauthorized: true };
  else if (mode === "render-internal" && /^dpg-[a-z0-9-]+$/.test(url.hostname))
    // Render private endpoints use a self-signed certificate. Never allow this on public hosts.
    ssl = { rejectUnauthorized: false };
  else throw Error("Invalid DATABASE_TLS_MODE or host");
  return {
    connectionString,
    ssl,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
  };
}
