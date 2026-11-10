import { randomUUID, createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  baseQuantity,
  lineTotal,
  canonical,
  type Actor,
  type OrderDraft,
  type ProductWrite,
  type Schedule,
  isStoreOpen,
  bogotaDate,
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
      `SELECT id,name,kind,price_cop AS "priceCop",stock,reserved,stock-reserved AS available,version,minimum,visible,category,code,description,photo${actor.role === "admin" ? ',cost_cop AS "costCop",supplier' : ""} FROM products ${actor.role === "buyer" ? "WHERE visible" : ""} ORDER BY name`,
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
        'SELECT id,owner_id AS "ownerId",status,payment_method AS "paymentMethod",payment_status AS "paymentStatus",client_name AS "clientName",client_reference AS "clientReference",total_cop AS "totalCop",created_at AS "createdAt",channel,cash_received AS "cashReceived",cash_change AS "cashChange" FROM orders WHERE id=$1',
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
  create(
    actor: Actor,
    key: string,
    draft: OrderDraft,
    sale = false,
    cashReceived?: number,
  ) {
    return this.once(
      actor,
      key,
      {
        operation: sale ? "create-sale" : "create-order",
        draft,
        ...(sale ? { cashReceived } : {}),
      },
      async (db, events) => {
        if (sale && (actor.role === "buyer" || draft.paymentMethod !== "cash"))
          throw new Conflict(
            "POS_NOT_ALLOWED",
            "Venta directa solo personal y efectivo confirmado",
          );
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
        if (sale && (cashReceived === undefined || cashReceived < total))
          throw new Conflict(
            "INSUFFICIENT_CASH",
            "El efectivo recibido no cubre el total",
          );
        const id = randomUUID();
        await db.query(
          "INSERT INTO orders(id,owner_id,status,payment_method,payment_status,client_name,client_reference,total_cop,channel,cash_received,cash_change) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            id,
            actor.id,
            sale ? "delivered" : "confirmed",
            draft.paymentMethod,
            sale
              ? "paid"
              : draft.paymentMethod === "nequi"
                ? "not_integrated"
                : "pending",
            draft.client?.name || "Cliente general",
            draft.client?.reference || "",
            total,
            sale ? "pos" : "pickup",
            sale ? cashReceived : null,
            sale ? cashReceived! - total : null,
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
        for (const [productId, needed] of needs) {
          await db.query(
            sale
              ? "UPDATE products SET stock=stock-$2,version=version+1 WHERE id=$1"
              : "UPDATE products SET reserved=reserved+$2,version=version+1 WHERE id=$1",
            [productId, needed],
          );
          if (sale)
            await this.audit(
              db,
              actor,
              "sale",
              productId,
              products.find((p) => p.id === productId),
              { deducted: needed, orderId: id },
              "Venta POS en efectivo",
            );
        }
        await this.event(
          db,
          events,
          sale ? "order.delivered" : "order.confirmed",
          actor.id,
          {
            orderId: id,
          },
        );
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
          for (const l of lines) {
            await this.audit(
              db,
              actor,
              status,
              l.product_id,
              null,
              { orderId: id, quantity: l.qty },
              "Cierre de pedido",
            );
            await db.query(
              "UPDATE products SET reserved=reserved-$2,stock=stock-$3,version=version+1 WHERE id=$1",
              [l.product_id, l.qty, status === "delivered" ? l.qty : 0],
            );
          }
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
  private async audit(
    db: PoolClient,
    actor: Actor,
    kind: string,
    entity: string,
    before: unknown,
    after: unknown,
    reason: string,
  ) {
    await db.query(
      "INSERT INTO inventory_audit(actor_id,kind,entity_id,before_data,after_data,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [
        actor.id,
        kind,
        entity,
        JSON.stringify(before),
        JSON.stringify(after),
        reason,
      ],
    );
  }
  async clients() {
    return (
      await this.pool.query(
        "SELECT id,name,contact,version FROM clients ORDER BY name",
      )
    ).rows;
  }
  saveClient(
    actor: Actor,
    key: string,
    id: string,
    input: { name: string; contact: string; version?: number },
    create: boolean,
  ) {
    return this.once(
      actor,
      key,
      { operation: "client", id: create ? null : id, input },
      async (db, events) => {
        if (actor.role !== "admin")
          throw new Conflict("FORBIDDEN", "Solo administrador");
        const old = (
          await db.query("SELECT * FROM clients WHERE id=$1 FOR UPDATE", [id])
        ).rows[0];
        if (!create && (!old || old.version !== input.version))
          throw new Conflict(
            "VERSION_CONFLICT",
            "El cliente cambió; vuelve a consultarlo",
          );
        if (create)
          await db.query(
            "INSERT INTO clients(id,name,contact) VALUES($1,$2,$3)",
            [id, input.name, input.contact],
          );
        else
          await db.query(
            "UPDATE clients SET name=$2,contact=$3,version=version+1 WHERE id=$1",
            [id, input.name, input.contact],
          );
        await this.audit(
          db,
          actor,
          "client.updated",
          id,
          old,
          input,
          "Cliente actualizado; ventas previas conservan snapshot",
        );
        return { id };
      },
    );
  }

  async audits() {
    return (
      await this.pool.query(
        'SELECT id,actor_id AS "actorId",kind,entity_id AS "entityId",before_data AS before,after_data AS after,reason,created_at AS "createdAt" FROM inventory_audit ORDER BY id DESC LIMIT 200',
      )
    ).rows;
  }
  async settings(): Promise<Schedule> {
    const row = (
      await this.pool.query(
        "SELECT schedule,version FROM store_settings WHERE singleton",
      )
    ).rows[0];
    return { ...row.schedule, version: row.version };
  }
  saveSettings(actor: Actor, key: string, input: Schedule) {
    return this.once(
      actor,
      key,
      { operation: "settings", input },
      async (db, events) => {
        if (actor.role !== "admin")
          throw new Conflict("FORBIDDEN", "Solo administrador");
        const old = (
          await db.query(
            "SELECT schedule,version FROM store_settings WHERE singleton FOR UPDATE",
          )
        ).rows[0];
        if (old.version !== input.version)
          throw new Conflict(
            "VERSION_CONFLICT",
            "El horario cambió; vuelve a consultarlo",
          );
        const next = { ...input, overrideDate: bogotaDate() };
        delete (next as Partial<Schedule>).version;
        await db.query(
          "UPDATE store_settings SET schedule=$1,version=version+1 WHERE singleton",
          [JSON.stringify(next)],
        );
        await this.audit(
          db,
          actor,
          "schedule",
          "store",
          old.schedule,
          next,
          "Actualización de horario",
        );
        await this.event(db, events, "store.changed", null, {});
        return { ...next, version: old.version + 1 };
      },
    );
  }
  saveProduct(
    actor: Actor,
    key: string,
    id: string,
    input: ProductWrite,
    create: boolean,
  ) {
    return this.once(
      actor,
      key,
      { operation: "save-product", id: create ? null : id, input },
      async (db, events) => {
        if (actor.role !== "admin")
          throw new Conflict("FORBIDDEN", "Solo administrador");
        const old = (
          await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [id])
        ).rows[0];
        if (!create && (!old || old.version !== input.version))
          throw new Conflict(
            "VERSION_CONFLICT",
            "El producto cambió; actualiza el inventario",
          );
        if (old && old.kind !== input.kind)
          throw new Conflict(
            "KIND_IMMUTABLE",
            "El tipo de producto no puede cambiar",
          );
        if (!create && input.initialStock !== undefined)
          throw new Conflict(
            "USE_ADJUSTMENT",
            "Usa ajuste de existencias con motivo",
          );
        const price =
          input.kind === "unit"
            ? input.presentations.find((v) => v.factor === 1)!.priceCop
            : input.priceCop;
        if (create)
          await db.query(
            "INSERT INTO products(id,name,kind,price_cop,cost_cop,stock,minimum,visible) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              id,
              input.name,
              input.kind,
              price,
              input.costCop,
              input.initialStock || 0,
              input.minimum,
              input.visible,
            ],
          );
        else
          await db.query(
            "UPDATE products SET name=$2,price_cop=$3,cost_cop=$4,minimum=$5,visible=$6,version=version+1 WHERE id=$1",
            [
              id,
              input.name,
              price,
              input.costCop,
              input.minimum,
              input.visible,
            ],
          );
        await db.query(
          "UPDATE products SET category=$2,code=$3,supplier=$4,description=$5,photo=$6 WHERE id=$1",
          [
            id,
            input.category,
            input.code,
            input.supplier,
            input.description,
            input.photo,
          ],
        );
        const oldPresentations = (
          await db.query("SELECT * FROM presentations WHERE product_id=$1", [
            id,
          ])
        ).rows;
        const owned = new Set(oldPresentations.map((p) => p.id));
        for (const v of input.presentations)
          if (v.id && !owned.has(v.id))
            throw new Conflict(
              "INVALID_PRESENTATION",
              "Presentación ajena al producto",
            );
        await db.query("DELETE FROM presentations WHERE product_id=$1", [id]);
        for (const v of input.presentations)
          await db.query(
            "INSERT INTO presentations(id,product_id,name,factor,price_cop,is_base) VALUES($1,$2,$3,$4,$5,$6)",
            [
              v.id || randomUUID(),
              id,
              v.name,
              v.factor,
              v.priceCop,
              v.factor === 1,
            ],
          );
        await this.audit(
          db,
          actor,
          create ? "product.created" : "product.updated",
          id,
          old
            ? {
                ...old,
                photo: old.photo ? "Imagen configurada" : "",
                presentations: oldPresentations,
              }
            : null,
          { ...input, photo: input.photo ? "Imagen configurada" : "" },
          create ? "Alta de producto" : "Edición de producto",
        );
        await this.event(db, events, "inventory.changed", null, {
          productIds: [id],
        });
        return { id };
      },
    );
  }
  adjustStock(
    actor: Actor,
    key: string,
    id: string,
    input: { delta: number; reason: string; version: number },
  ) {
    return this.once(
      actor,
      key,
      { operation: "stock-adjustment", id, input },
      async (db, events) => {
        if (actor.role !== "admin")
          throw new Conflict("FORBIDDEN", "Solo administrador");
        const old = (
          await db.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [id])
        ).rows[0];
        if (!old || old.version !== input.version)
          throw new Conflict(
            "VERSION_CONFLICT",
            "El producto cambió; actualiza antes de ajustar",
          );
        const stock = old.stock + input.delta;
        if (
          !Number.isSafeInteger(stock) ||
          stock < old.reserved ||
          stock > 100000000
        )
          throw new Conflict(
            "RESERVED_STOCK",
            "Las existencias no pueden quedar por debajo de lo reservado",
          );
        await db.query(
          "UPDATE products SET stock=$2,version=version+1 WHERE id=$1",
          [id, stock],
        );
        await this.audit(
          db,
          actor,
          "stock.adjusted",
          id,
          { stock: old.stock, reserved: old.reserved },
          { stock, delta: input.delta },
          input.reason,
        );
        await this.event(db, events, "inventory.changed", null, {
          productIds: [id],
        });
        return { id, stock };
      },
    );
  }
  async notifications(actor: Actor) {
    const rows = (
      await this.pool.query(
        `SELECT e.id::text,e.kind,e.payload,e.created_at AS "createdAt",(r.event_id IS NOT NULL) AS read FROM events e LEFT JOIN notification_reads r ON r.event_id=e.id AND r.user_id=$1 WHERE e.kind LIKE 'order.%' ${actor.role === "buyer" ? "AND e.owner_id=$1" : ""} ORDER BY e.id DESC LIMIT 100`,
        [actor.id],
      )
    ).rows;
    if (actor.role !== "buyer") {
      const alerts = (
        await this.pool.query(
          `SELECT 'stock:'||p.id||':'||p.version AS id,'inventory.changed' AS kind,json_build_object('productId',p.id,'name',p.name,'available',p.stock-p.reserved,'minimum',p.minimum,'kind',p.kind) AS payload,now() AS "createdAt",(r.product_id IS NOT NULL) AS read FROM products p LEFT JOIN inventory_notice_reads r ON r.product_id=p.id AND r.version=p.version AND r.user_id=$1 WHERE p.stock-p.reserved<=p.minimum ORDER BY p.name`,
          [actor.id],
        )
      ).rows;
      rows.push(...alerts);
    }
    return rows;
  }
  async readNotification(actor: Actor, id: string) {
    if (id.startsWith("stock:")) {
      if (actor.role === "buyer") return { ok: false };
      const [, productId, version] = id.split(":");
      await this.pool.query(
        `INSERT INTO inventory_notice_reads(user_id,product_id,version) SELECT $1,id,version FROM products WHERE id=$2 AND version=$3 AND stock-reserved<=minimum ON CONFLICT DO NOTHING`,
        [actor.id, productId, Number(version)],
      );
    } else
      await this.pool.query(
        `INSERT INTO notification_reads(user_id,event_id) SELECT $1,id FROM events WHERE id=$2 ${actor.role === "buyer" ? "AND owner_id=$1" : ""} ON CONFLICT DO NOTHING`,
        [actor.id, id],
      );
    return { ok: true };
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
