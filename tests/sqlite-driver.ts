import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlDriver } from "../packages/mobile/src/outbox.js";
export class NodeSqliteDriver implements SqlDriver {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000;");
  }
  async execute(sql: string) {
    this.db.exec(sql);
  }
  async run(sql: string, values: unknown[]) {
    this.db.prepare(sql).run(...(values as SQLInputValue[]));
  }
  async query<T>(sql: string, values: unknown[] = []) {
    return this.db.prepare(sql).all(...(values as SQLInputValue[])) as T[];
  }
  close() {
    this.db.close();
  }
}
