import { orderDraftSchema, type OrderDraft } from "@playita/shared";
export interface SqlDriver {
  execute(sql: string): Promise<void>;
  run(sql: string, values: unknown[]): Promise<void>;
  query<T>(sql: string, values?: unknown[]): Promise<T[]>;
}
export type OutboxRow = {
  request_key: string;
  owner_id: string;
  payload: string;
  status: "pending_sync" | "syncing" | "synced" | "conflict";
  attempts: number;
  next_attempt_at: number;
  lease_until: number;
  lease_token: string | null;
  last_error: string | null;
  response: string | null;
  resolved_by: string | null;
};
export const SQLITE_SCHEMA = `CREATE TABLE IF NOT EXISTS outbox(request_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending_sync','syncing','synced','conflict')),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,lease_token TEXT,last_error TEXT,response TEXT,resolved_by TEXT,created_at INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS outbox_owner ON outbox(owner_id,status,next_attempt_at);CREATE TABLE IF NOT EXISTS catalog_cache(owner_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);PRAGMA user_version=1;`;
const driverQueues = new WeakMap<SqlDriver, Promise<unknown>>();
export class Outbox {
  constructor(
    private db: SqlDriver,
    readonly owner: string,
  ) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = driverQueues.get(this.db) || Promise.resolve();
    const current = previous.then(fn, fn);
    driverQueues.set(
      this.db,
      current.catch(() => {}),
    );
    return current;
  }
  init() {
    return this.exclusive(async () => {
      const version =
        (
          await this.db.query<{ user_version: number }>("PRAGMA user_version")
        )[0]?.user_version || 0;
      if (version > 1)
        throw Error(
          "Versión SQLite futura: actualizar app, sin modificar la base",
        );
      await this.db.execute(SQLITE_SCHEMA);
    });
  }
  enqueue(draft: OrderDraft, key = crypto.randomUUID(), now = Date.now()) {
    return this.exclusive(async () => {
      const valid = orderDraftSchema.parse(draft);
      await this.db.run(
        "INSERT INTO outbox(request_key,owner_id,payload,status,created_at) VALUES(?,?,?,'pending_sync',?)",
        [key, this.owner, JSON.stringify(valid), now],
      );
      return key;
    });
  }
  list() {
    return this.exclusive(() =>
      this.db.query<OutboxRow>(
        "SELECT * FROM outbox WHERE owner_id=? ORDER BY created_at,request_key",
        [this.owner],
      ),
    );
  }
  claim(now = Date.now()) {
    return this.exclusive(async () => {
      await this.db.execute("BEGIN IMMEDIATE");
      try {
        const row = (
          await this.db.query<OutboxRow>(
            "SELECT * FROM outbox WHERE owner_id=? AND resolved_by IS NULL AND ((status='pending_sync' AND next_attempt_at<=?) OR (status='syncing' AND lease_until<=?)) ORDER BY created_at,request_key LIMIT 1",
            [this.owner, now, now],
          )
        )[0];
        if (!row) {
          await this.db.execute("COMMIT");
          return null;
        }
        const lease = crypto.randomUUID();
        await this.db.run(
          "UPDATE outbox SET status='syncing',attempts=attempts+1,lease_until=?,lease_token=? WHERE request_key=? AND owner_id=?",
          [now + 60000, lease, row.request_key, this.owner],
        );
        await this.db.execute("COMMIT");
        return {
          ...row,
          status: "syncing" as const,
          attempts: row.attempts + 1,
          lease_until: now + 60000,
          lease_token: lease,
        };
      } catch (e) {
        await this.db.execute("ROLLBACK");
        throw e;
      }
    });
  }
  settle(
    row: OutboxRow,
    status: "synced" | "conflict" | "pending_sync",
    response: unknown,
    error: string | null,
    next = 0,
  ) {
    return this.exclusive(() =>
      this.db.run(
        "UPDATE outbox SET status=?,response=?,last_error=?,next_attempt_at=?,lease_until=0,lease_token=NULL WHERE request_key=? AND owner_id=? AND lease_token=?",
        [
          status,
          response == null ? null : JSON.stringify(response),
          error,
          next,
          row.request_key,
          this.owner,
          row.lease_token,
        ],
      ),
    );
  }
  revise(oldKey: string, draft: OrderDraft, newKey = crypto.randomUUID()) {
    return this.exclusive(async () => {
      const valid = orderDraftSchema.parse(draft);
      await this.db.execute("BEGIN IMMEDIATE");
      try {
        const old = (
          await this.db.query<OutboxRow>(
            "SELECT * FROM outbox WHERE request_key=? AND owner_id=? AND status='conflict' AND resolved_by IS NULL",
            [oldKey, this.owner],
          )
        )[0];
        if (!old)
          throw Error("Solo se revisa un conflicto sin resolución previa");
        await this.db.run(
          "INSERT INTO outbox(request_key,owner_id,payload,status,created_at) VALUES(?,?,?,'pending_sync',?)",
          [newKey, this.owner, JSON.stringify(valid), Date.now()],
        );
        await this.db.run(
          "UPDATE outbox SET resolved_by=? WHERE request_key=? AND owner_id=?",
          [newKey, oldKey, this.owner],
        );
        await this.db.execute("COMMIT");
        return newKey;
      } catch (e) {
        await this.db.execute("ROLLBACK");
        throw e;
      }
    });
  }
  saveCatalog(value: unknown) {
    return this.exclusive(() =>
      this.db.run(
        "INSERT INTO catalog_cache(owner_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
        [this.owner, JSON.stringify(value), Date.now()],
      ),
    );
  }
  catalog() {
    return this.exclusive(async () => {
      const row = (
        await this.db.query<{ payload: string; updated_at: number }>(
          "SELECT payload,updated_at FROM catalog_cache WHERE owner_id=?",
          [this.owner],
        )
      )[0];
      return row
        ? {
            data: JSON.parse(row.payload) as unknown,
            updatedAt: row.updated_at,
          }
        : null;
    });
  }
}
export type Transport = (
  key: string,
  draft: OrderDraft,
) => Promise<{ status: number; body: unknown }>;
export class Synchronizer {
  private running = false;
  constructor(
    private outbox: Outbox,
    private send: Transport,
    private clock = Date.now,
    private random = Math.random,
  ) {}
  async sync() {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 20; i++) {
        const row = await this.outbox.claim(this.clock());
        if (!row) break;
        try {
          const reply = await this.send(
            row.request_key,
            JSON.parse(row.payload) as OrderDraft,
          );
          if (reply.status >= 200 && reply.status < 300)
            await this.outbox.settle(row, "synced", reply.body, null);
          else if ([401, 403].includes(reply.status)) {
            await this.outbox.settle(
              row,
              "pending_sync",
              reply.body,
              "Sesión requerida: reautenticar la misma cuenta; clave conservada",
              this.clock() + 30000,
            );
            break;
          } else if ([400, 404, 409, 422].includes(reply.status))
            await this.outbox.settle(
              row,
              "conflict",
              reply.body,
              "Revisión requerida; no confirmado",
            );
          else await this.retry(row, reply.body, "HTTP " + reply.status);
        } catch (e) {
          await this.retry(
            row,
            null,
            e instanceof Error ? e.message : "NETWORK_ERROR",
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
  private retry(row: OutboxRow, body: unknown, message: string) {
    const delay =
      Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6)) +
      Math.floor(this.random() * 500);
    return this.outbox.settle(
      row,
      "pending_sync",
      body,
      message,
      this.clock() + delay,
    );
  }
}
export function httpTransport(baseUrl: string, token: () => string): Transport {
  return async (key, draft) => {
    const response = await fetch(baseUrl + "/orders", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token(),
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, body: await response.json() };
  };
}
