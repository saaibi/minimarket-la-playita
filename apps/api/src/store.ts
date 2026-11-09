import { randomUUID, createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  baseQuantity,
  lineTotal,
  canonical,
  type Actor,
  type OrderDraft,
} from "@playita/shared";
export type Reply = {
  status: number;
  body: Record<string, unknown>;
  replayed?: boolean;
};
class Conflict extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export class Store {
  constructor(
    readonly pool: Pool,
    private notify: (events: Record<string, unknown>[]) => void = () => {},
  ) {}
  async inventory(actor: Actor) {
    const { rows } = await this.pool.query(
      `SELECT id,name,kind,price_cop AS "priceCop",stock,reserved,stock-reserved AS available,version${actor.role === "admin" ? ',cost_cop AS "costCop"' : ""} FROM products ${actor.role === "buyer" ? "WHERE visible" : ""} ORDER BY name`,
    );
    for (const p of rows)
      p.presentations = (
        await this.pool.query(
          'SELECT id,name,factor,price_cop AS "priceCop" FROM presentations WHERE product_id=$1 ORDER BY factor',
          [p.id],
        )
      ).rows;
    return rows;
  }
  async list(actor: Actor) {
    const { rows } = await this.pool.query(
      `SELECT id FROM orders ${actor.role === "buyer" ? "WHERE owner_id=$1" : ""} ORDER BY created_at DESC LIMIT 100`,
      actor.role === "buyer" ? [actor.id] : [],
    );
    return Promise.all(rows.map((o) => this.get(actor, o.id)));
  }
  async get(actor: Actor, id: string, db: Pool | PoolClient = this.pool) {
    const row = (
      await db.query(
        'SELECT id,owner_id AS "ownerId",status,payment_method AS "paymentMethod",payment_status AS "paymentStatus",client_name AS "clientName",client_reference AS "clientReference",total_cop AS "totalCop",created_at AS "createdAt" FROM orders WHERE id=$1',
        [id],
      )
    ).rows[0];
    if (!row || (actor.role === "buyer" && row.ownerId !== actor.id))
      return null;
    row.lines = (
      await db.query(
        'SELECT product_id AS "productId",product_name AS "productName",kind,presentation_name AS "presentationName",units_per_package AS factor,quantity,base_quantity AS "baseQuantity",price_cop AS "priceCop",total_cop AS "totalCop" FROM order_lines WHERE order_id=$1 ORDER BY id',
        [id],
      )
    ).rows;
    return row;
  }
  private async once(
    actor: Actor,
    key: string,
    input: unknown,
    work: (
      db: PoolClient,
      events: Record<string, unknown>[],
    ) => Promise<Record<string, unknown>>,
  ): Promise<Reply> {
    const db = await this.pool.connect(),
      hash = createHash("sha256").update(canonical(input)).digest("hex"),
      events: Record<string, unknown>[] = [];
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        actor.id + "|" + key,
      ]);
      const prev = (
        await db.query(
          "SELECT * FROM idempotency WHERE actor_id=$1 AND key=$2",
          [actor.id, key],
        )
      ).rows[0];
      if (prev) {
        await db.query("COMMIT");
        return prev.request_hash === hash
          ? { status: prev.status_code, body: prev.response, replayed: true }
          : {
              status: 409,
              body: {
                code: "IDEMPOTENCY_MISMATCH",
                message:
                  "Esta clave ya pertenece a otra solicitud. Revisar y crear una clave nueva.",
              },
            };
      }
      let status = 201,
        body: Record<string, unknown>;
      await db.query("SAVEPOINT operation");
      try {
        body = await work(db, events);
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        await db.query("ROLLBACK TO SAVEPOINT operation");
        events.length = 0;
        status = 409;
        body = { code: e.code, message: e.message, details: e.details };
      }
      await db.query(
        "INSERT INTO idempotency(actor_id,key,request_hash,status_code,response) VALUES($1,$2,$3,$4,$5)",
        [actor.id, key, hash, status, JSON.stringify(body)],
      );
      await db.query("COMMIT");
      try {
        this.notify(events);
      } catch {
        /* REST event log is authoritative; never undo a committed order. */
      }
      return { status, body };
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  }
  private async event(
    db: PoolClient,
    events: Record<string, unknown>[],
    kind: string,
    owner: string | null,
    payload: unknown,
  ) {
    await db.query("SELECT pg_advisory_xact_lock(77332002)");
    const e = (
      await db.query(
        'INSERT INTO events(kind,owner_id,payload) VALUES($1,$2,$3) RETURNING id,kind,owner_id AS "ownerId",payload',
        [kind, owner, JSON.stringify(payload)],
      )
    ).rows[0];
    events.push(e);
  }
  create(actor: Actor, key: string, draft: OrderDraft) {
    return this.once(
      actor,
      key,
      { operation: "create-order", draft },
      async (db, events) => {
        const ids = [...new Set(draft.lines.map((l) => l.productId))].sort(),
          products = (
            await db.query(
              "SELECT * FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
              [ids],
            )
          ).rows,
          pres = (
            await db.query(
              "SELECT * FROM presentations WHERE product_id=ANY($1::uuid[])",
              [ids],
            )
          ).rows;
        const needs = new Map<string, number>(),
          lines = [];
        let total = 0;
        for (const l of draft.lines) {
          const p = products.find((p) => p.id === l.productId);
          if (!p || (actor.role === "buyer" && !p.visible))
            throw new Conflict(
              "PRODUCT_UNAVAILABLE",
              "Producto no disponible",
              { productId: l.productId },
            );
          const v =
            p.kind === "unit"
              ? pres.find(
                  (v) =>
                    v.product_id === p.id &&
                    (l.presentationId ? v.id === l.presentationId : v.is_base),
                )
              : null;
          if (
            (p.kind === "unit" && !v) ||
            (p.kind === "weight" && l.presentationId)
          )
            throw new Conflict(
              "PRESENTATION_CHANGED",
              "Revisa la presentación seleccionada",
              { productId: p.id },
            );
          const price = v?.price_cop ?? p.price_cop;
          if (price !== l.expectedPriceCop)
            throw new Conflict(
              "PRICE_CHANGED",
              "El precio cambió: revisar antes de reenviar",
              {
                productId: p.id,
                currentPriceCop: price,
                expectedPriceCop: l.expectedPriceCop,
              },
            );
          const base = baseQuantity(p.kind, l.quantity, v?.factor ?? 1),
            linePrice = lineTotal(p.kind, l.quantity, price);
          total += linePrice;
          if (!Number.isSafeInteger(total) || total > 2_000_000_000)
            throw new Conflict(
              "TOTAL_LIMIT",
              "El total excede el límite del incremento",
            );
          needs.set(p.id, (needs.get(p.id) || 0) + base);
          lines.push({ p, v, l, base, linePrice, price });
        }
        for (const [id, needed] of needs) {
          const p = products.find((p) => p.id === id);
          if (needed > p.stock - p.reserved)
            throw new Conflict(
              "STOCK_CONFLICT",
              "No hay disponibilidad global suficiente; revisar pedido",
              { productId: id, needed, available: p.stock - p.reserved },
            );
        }
        const id = randomUUID();
        await db.query(
          "INSERT INTO orders(id,owner_id,status,payment_method,payment_status,client_name,client_reference,total_cop) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            id,
            actor.id,
            "confirmed",
            draft.paymentMethod,
            draft.paymentMethod === "nequi" ? "not_integrated" : "pending",
            draft.client?.name || "Cliente general",
            draft.client?.reference || "",
            total,
          ],
        );
        for (const { p, v, l, base, linePrice, price } of lines)
          await db.query(
            "INSERT INTO order_lines(order_id,product_id,product_name,kind,presentation_id,presentation_name,units_per_package,quantity,base_quantity,price_cop,total_cop) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
            [
              id,
              p.id,
              p.name,
              p.kind,
              v?.id || null,
              v?.name || null,
              v?.factor || null,
              l.quantity,
              base,
              price,
              linePrice,
            ],
          );
        for (const [id, needed] of needs)
          await db.query(
            "UPDATE products SET reserved=reserved+$2,version=version+1 WHERE id=$1",
            [id, needed],
          );
        await this.event(db, events, "order.confirmed", actor.id, {
          orderId: id,
        });
        await this.event(db, events, "inventory.changed", null, {
          productIds: ids,
        });
        return (await this.get(actor, id, db))!;
      },
    );
  }
  action(actor: Actor, key: string, id: string, action: string) {
    return this.once(
      actor,
      key,
      { operation: "order-action", id, action },
      async (db, events) => {
        const o = (
          await db.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])
        ).rows[0];
        if (!o || (actor.role === "buyer" && o.owner_id !== actor.id))
          throw new Conflict("ORDER_UNAVAILABLE", "Pedido no disponible");
        if (actor.role === "buyer" && action !== "cancel")
          throw new Conflict(
            "FORBIDDEN_ACTION",
            "Solo la tienda puede ejecutar esta acción",
          );
        if (["delivered", "cancelled"].includes(o.status))
          throw new Conflict("ORDER_CLOSED", "El pedido ya está cerrado");
        let status = o.status,
          payment = o.payment_status;
        if (action === "accept") {
          if (status !== "confirmed")
            throw new Conflict(
              "INVALID_STATE",
              "Solo se acepta un pedido nuevo",
            );
          status = "accepted";
        } else if (action === "ready") {
          if (status !== "accepted")
            throw new Conflict("INVALID_STATE", "Primero aceptar el pedido");
          status = "ready";
        } else if (action === "pay_cash") {
          if (o.payment_method !== "cash" || payment === "paid")
            throw new Conflict(
              "INVALID_PAYMENT",
              "No corresponde confirmar efectivo",
            );
          payment = "paid";
        } else if (action === "deliver") {
          if (status !== "ready" || payment !== "paid")
            throw new Conflict(
              "NOT_DELIVERABLE",
              "Requiere pedido listo y pago confirmado",
            );
          status = "delivered";
        } else if (action === "cancel") {
          if (payment === "paid")
            throw new Conflict(
              "REFUND_REQUIRED",
              "No se cancela un pago cobrado; devolución pendiente de implementar",
            );
          status = "cancelled";
        } else throw new Conflict("INVALID_ACTION", "Acción inválida");
        if (["delivered", "cancelled"].includes(status)) {
          const lines = (
            await db.query(
              "SELECT product_id,SUM(base_quantity)::int AS qty FROM order_lines WHERE order_id=$1 GROUP BY product_id ORDER BY product_id",
              [id],
            )
          ).rows;
          await db.query(
            "SELECT id FROM products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
            [lines.map((l) => l.product_id)],
          );
          for (const l of lines)
            await db.query(
              "UPDATE products SET reserved=reserved-$2,stock=stock-$3,version=version+1 WHERE id=$1",
              [l.product_id, l.qty, status === "delivered" ? l.qty : 0],
            );
          await this.event(db, events, "inventory.changed", null, {
            productIds: lines.map((l) => l.product_id),
          });
        }
        await db.query(
          "UPDATE orders SET status=$2,payment_status=$3,updated_at=now() WHERE id=$1",
          [id, status, payment],
        );
        await this.event(db, events, "order." + status, o.owner_id, {
          orderId: id,
        });
        return (await this.get(actor, id, db))!;
      },
    );
  }
  async events(actor: Actor, after: string) {
    return (
      await this.pool.query(
        `SELECT id,kind,payload,created_at AS "createdAt" FROM events WHERE id>$1 ${actor.role === "buyer" ? "AND (owner_id=$2 OR owner_id IS NULL)" : ""} ORDER BY id LIMIT 200`,
        actor.role === "buyer" ? [after, actor.id] : [after],
      )
    ).rows;
  }
}
