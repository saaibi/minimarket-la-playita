import { randomUUID } from "node:crypto";
import { type Pool, type PoolClient } from "pg";
import { cert, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
export type PushMessage = {
  title: string;
  body: string;
  data: { eventId: string; orderId: string };
  tag: string;
};
export type PushSender = (token: string, message: PushMessage) => Promise<void>;
export function firebasePushSender(): PushSender | undefined {
  if (process.env.PUSH_ENABLED !== "true") return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw Error("PUSH_ENABLED requires Firebase server credentials");
  let credential;
  try {
    credential = cert(JSON.parse(raw));
  } catch {
    throw Error("Invalid Firebase server credentials");
  }
  const app = initializeApp({ credential }, "playita-push");
  return async (token, message) => {
    await getMessaging(app).send({
      token,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: {
        priority: "high",
        ttl: 86400000,
        notification: {
          channelId: "playita_orders",
          tag: message.tag,
          icon: "ic_stat_playita",
          color: "#153e31",
        },
      },
    });
  };
}
/** Called inside the order transaction. Provider I/O never runs in this transaction. */
export async function enqueuePush(db: PoolClient, event: any) {
  if (!String(event.kind).startsWith("order.") || !event.payload?.orderId)
    return;
  await db.query(
    `INSERT INTO push_deliveries(event_id,installation_id,user_id,family_id)
    SELECT $1,d.installation_id,d.user_id,d.family_id FROM push_devices d JOIN app_users u ON u.id=d.user_id JOIN orders o ON o.id=$2
    WHERE d.enabled AND u.active AND NOT u.is_guest AND
      (($3='order.confirmed' AND u.role IN ('admin','seller')) OR
       ($3<>'order.confirmed' AND ((u.id::text=o.owner_id AND o.channel<>'pos') OR u.id=o.customer_id)))
    AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id AND s.family_id=d.family_id AND s.revoked_at IS NULL AND s.rotated_at IS NULL AND s.refresh_expires_at>now() AND s.absolute_expires_at>now())
    ON CONFLICT DO NOTHING`,
    [event.id, event.payload.orderId, event.kind],
  );
}
export class PushService {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(
    readonly pool: Pool,
    private sender?: PushSender,
  ) {}
  get available() {
    return !!this.sender;
  }
  async register(
    user: string,
    family: string,
    installation: string,
    token: string,
  ) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const account = (
        await db.query(
          "SELECT active,is_guest FROM app_users WHERE id=$1 AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=app_users.id AND s.family_id=$2 AND s.revoked_at IS NULL AND s.rotated_at IS NULL AND s.refresh_expires_at>now() AND s.absolute_expires_at>now()) FOR UPDATE",
          [user, family],
        )
      ).rows[0];
      if (!account?.active || account.is_guest)
        throw Error("ACCOUNT_NOT_ALLOWED");
      const count = await db.query(
        "SELECT installation_id FROM push_devices d WHERE user_id=$1 AND enabled AND installation_id<>$2 AND token<>$3 AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=d.user_id AND s.family_id=d.family_id AND s.revoked_at IS NULL AND s.rotated_at IS NULL AND s.refresh_expires_at>now() AND s.absolute_expires_at>now())",
        [user, installation, token],
      );
      if (count.rowCount! >= 10) throw Error("DEVICE_LIMIT");
      // A rotated token or account switch replaces the binding, never its queued recipient.
      await db.query(
        "UPDATE push_devices SET enabled=false WHERE token=$1 AND installation_id<>$2",
        [token, installation],
      );
      await db.query(
        "UPDATE push_devices SET token='retired:'||installation_id::text WHERE token=$1 AND installation_id<>$2",
        [token, installation],
      );
      await db.query(
        `INSERT INTO push_devices(installation_id,user_id,family_id,token) VALUES($1,$2,$3,$4)
        ON CONFLICT(installation_id) DO UPDATE SET user_id=excluded.user_id,family_id=excluded.family_id,token=excluded.token,enabled=true,updated_at=now()`,
        [installation, user, family, token],
      );
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  async unregister(user: string, family: string, installation: string) {
    await this.pool.query(
      "UPDATE push_devices SET enabled=false,updated_at=now() WHERE installation_id=$1 AND user_id=$2 AND family_id=$3",
      [installation, user, family],
    );
  }
  start() {
    if (!this.sender || this.timer) return;
    this.timer = setInterval(
      () => void this.flush().catch(() => console.warn("PUSH_QUEUE_RETRY")),
      5000,
    );
    this.timer.unref();
    void this.flush().catch(() => console.warn("PUSH_QUEUE_RETRY"));
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => {});
  }
  flush() {
    if (!this.sender) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async drain() {
    for (let i = 0; i < 20; i++) {
      const lease = randomUUID();
      const row = (
        await this.pool.query(
          `WITH candidate AS (
        SELECT event_id,installation_id FROM push_deliveries WHERE status IN ('pending','sending') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY event_id FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE push_deliveries q SET status='sending',attempts=attempts+1,lease_until=now()+interval '60 seconds',lease_token=$1 FROM candidate c WHERE q.event_id=c.event_id AND q.installation_id=c.installation_id RETURNING q.*`,
          [lease],
        )
      ).rows[0];
      if (!row) return;
      const binding = (
        await this.pool.query(
          `SELECT d.token,e.kind,e.payload FROM push_devices d JOIN app_users u ON u.id=d.user_id JOIN events e ON e.id=$4
        WHERE d.installation_id=$1 AND d.user_id=$2 AND d.family_id=$3 AND d.enabled AND u.active AND NOT u.is_guest AND e.created_at>now()-interval '24 hours'
        AND EXISTS(SELECT 1 FROM auth_sessions s WHERE s.user_id=u.id AND s.family_id=d.family_id AND s.revoked_at IS NULL AND s.rotated_at IS NULL AND s.refresh_expires_at>now() AND s.absolute_expires_at>now())
        AND NOT EXISTS(SELECT 1 FROM push_deliveries newer JOIN events ne ON ne.id=newer.event_id WHERE newer.installation_id=d.installation_id AND newer.user_id=d.user_id AND newer.status='sent' AND newer.event_id>e.id AND ne.payload->>'orderId'=e.payload->>'orderId')`,
          [row.installation_id, row.user_id, row.family_id, row.event_id],
        )
      ).rows[0];
      if (!binding) {
        await this.finish(row, lease, "cancelled");
        continue;
      }
      const body: Record<string, string> = {
        "order.confirmed": "Tienes un nuevo pedido para gestionar.",
        "order.accepted": "Tu pedido fue aceptado.",
        "order.ready": "Tu pedido está listo para recoger.",
        "order.delivered": "Tu pedido fue entregado.",
        "order.cancelled": "Tu pedido fue cancelado.",
      };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.sender!(binding.token, {
            title: "La Playita",
            body: body[binding.kind] || "Hay una actualización de tu pedido.",
            data: {
              eventId: String(row.event_id),
              orderId: binding.payload.orderId,
            },
            tag: "playita-order-" + binding.payload.orderId,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject({ code: "PUSH_TIMEOUT" }), 10000);
          }),
        ]);
        await this.finish(row, lease, "sent");
      } catch (e: any) {
        const code =
          typeof e?.code === "string" && /^[a-zA-Z0-9/_-]{1,100}$/.test(e.code)
            ? e.code
            : "PUSH_FAILED";
        const invalid = [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token",
        ].includes(code);
        if (invalid)
          await this.pool.query(
            "UPDATE push_devices SET enabled=false WHERE installation_id=$1 AND token=$2",
            [row.installation_id, binding.token],
          );
        if (invalid || row.attempts >= 10)
          await this.finish(row, lease, "failed", code);
        else
          await this.pool.query(
            "UPDATE push_deliveries SET status='pending',last_error=$4,lease_until=NULL,next_attempt_at=now()+($5*interval '1 second') WHERE event_id=$1 AND installation_id=$2 AND lease_token=$3",
            [
              row.event_id,
              row.installation_id,
              lease,
              code,
              Math.min(3600, 5 * 2 ** row.attempts),
            ],
          );
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  }
  private async finish(
    row: any,
    lease: string,
    status: string,
    error: string | null = null,
  ) {
    await this.pool.query(
      "UPDATE push_deliveries SET status=$4,last_error=$5,lease_until=NULL WHERE event_id=$1 AND installation_id=$2 AND lease_token=$3",
      [row.event_id, row.installation_id, lease, status, error],
    );
  }
}
