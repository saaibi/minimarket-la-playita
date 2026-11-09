import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import { Outbox, type SqlDriver } from "./outbox.js";
let cachedDriver: SqlDriver | undefined;
let connection: Promise<SQLiteDBConnection> | undefined;
async function nativeDatabase() {
  if (!Capacitor.isNativePlatform())
    throw Error(
      "Offline SQLite solo disponible en Android/iOS; la web requiere conexión.",
    );
  connection ??= (async () => {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const consistent = await sqlite.checkConnectionsConsistency(),
      exists = await sqlite.isConnection("playita_orders_v1", false);
    const db =
      consistent.result && exists.result
        ? await sqlite.retrieveConnection("playita_orders_v1", false)
        : await sqlite.createConnection(
            "playita_orders_v1",
            false,
            "no-encryption",
            1,
            false,
          );
    await db.open();
    return db;
  })();
  return connection;
}
export async function openNativeOutbox(owner: string) {
  const db = await nativeDatabase();
  const driver: SqlDriver = (cachedDriver ??= {
    execute: async (sql) => {
      await db.execute(sql, false);
    },
    run: async (sql, values) => {
      await db.run(sql, values, false);
    },
    query: async <T>(sql: string, values: unknown[] = []) => {
      const result = await db.query(sql, values);
      return (result.values || []) as T[];
    },
  });
  const outbox = new Outbox(driver, owner);
  await outbox.init();
  return outbox;
}
