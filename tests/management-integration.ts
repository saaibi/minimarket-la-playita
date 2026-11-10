import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createApp } from "../apps/api/dist/app.js";
import { bootstrapAdmin } from "../apps/api/src/auth.js";
import { migrate } from "../scripts/migrate.js";
import { bogotaDate } from "@playita/shared";
const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "PostgreSQL: módulos admin, auditoría, POS atómico, horario y avisos por usuario",
  { skip: !databaseUrl },
  async () => {
    const root = new Pool({ connectionString: databaseUrl }),
      schema = "management_" + crypto.randomUUID().replace(/-/g, ""),
      url = new URL(databaseUrl!);
    url.searchParams.set("options", "-c search_path=" + schema);
    await root.query(`CREATE SCHEMA ${schema}`);
    let server: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await migrate(url.toString());
      server = await createApp({ databaseUrl: url.toString() });
      const pass = "only-integration-" + crypto.randomUUID();
      await bootstrapAdmin(server.pool, "owner@example.invalid", pass);
      await server.app.listen(0, "127.0.0.1");
      const base =
        "http://127.0.0.1:" + server.app.getHttpServer().address().port;
      const native = {
        "Content-Type": "application/json",
        "X-Playita-Client": "native",
      };
      async function req(
        path: string,
        token = "",
        method = "GET",
        body?: unknown,
        key = crypto.randomUUID(),
      ) {
        const r = await fetch(base + path, {
          method,
          headers: {
            ...native,
            ...(token ? { Authorization: "Bearer " + token } : {}),
            "Idempotency-Key": key,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return {
          status: r.status,
          data: await r.json(),
          replayed: r.headers.get("Idempotency-Replayed"),
        };
      }
      const admin = (
        await req("/auth/login", "", "POST", {
          email: "owner@example.invalid",
          password: pass,
        })
      ).data.accessToken;
      const buyer = (await req("/auth/guest", "", "POST", {})).data.accessToken;
      await req("/auth/users", admin, "POST", {
        email: "seller@example.invalid",
        password: pass,
        role: "seller",
      });
      const seller = (
        await req("/auth/login", "", "POST", {
          email: "seller@example.invalid",
          password: pass,
        })
      ).data.accessToken;
      assert.equal((await req("/audit", seller)).status, 403);
      assert.equal((await req("/audit", buyer)).status, 403);
      const settings = (await req("/settings", admin)).data;
      settings.override = "open";
      settings.overrideDate = bogotaDate();
      assert.equal(
        (await req("/settings", seller, "PUT", settings)).status,
        403,
      );
      assert.equal(
        (await req("/settings", admin, "PUT", settings)).status,
        201,
      );
      assert.equal(
        (await req("/settings", admin, "PUT", settings)).status,
        409,
      );
      assert.equal((await req("/clients", buyer)).status, 403);
      assert.equal(
        (
          await req("/clients", seller, "POST", {
            name: "Cliente de prueba",
            contact: "",
          })
        ).status,
        403,
      );
      const customer = (
        await req("/clients", admin, "POST", {
          name: "Cliente de prueba",
          contact: "Referencia ficticia",
        })
      ).data;
      const savedCustomer = (await req("/clients", seller)).data.find(
        (c: any) => c.id === customer.id,
      );
      assert.ok(savedCustomer);
      assert.equal(
        (
          await req("/clients/" + customer.id, admin, "PUT", {
            name: "Cliente actualizado",
            contact: "",
            version: savedCustomer.version,
          })
        ).status,
        201,
      );
      const input = {
        name: "Producto prueba",
        kind: "unit",
        priceCop: 1000,
        costCop: 500,
        minimum: 3,
        visible: true,
        initialStock: 40,
        presentations: [
          { name: "Unidad", factor: 1, priceCop: 1000 },
          { name: "Quince", factor: 15, priceCop: 13000 },
          { name: "Treinta", factor: 30, priceCop: 24000 },
        ],
      };
      assert.equal(
        (await req("/inventory", seller, "POST", input)).status,
        403,
      );
      const createKey = crypto.randomUUID(),
        created = await req("/inventory", admin, "POST", input, createKey);
      assert.equal(created.status, 201);
      assert.equal(
        (await req("/inventory", admin, "POST", input, createKey)).data.id,
        created.data.id,
      );
      let p = (await req("/inventory", admin)).data.find(
        (p: any) => p.id === created.data.id,
      );
      assert.ok(
        !(
          "costCop" in
          (await req("/inventory", seller)).data.find((p: any) => p.id === p.id)
        ),
      );
      const draft = {
        paymentMethod: "cash",
        lines: [
          {
            productId: p.id,
            presentationId: p.presentations.find((v: any) => v.factor === 15)
              .id,
            quantity: 1,
            expectedPriceCop: 13000,
          },
        ],
      };
      const order = (await req("/orders", buyer, "POST", draft)).data;
      assert.ok(order.id);
      p = (await req("/inventory", admin)).data.find((x: any) => x.id === p.id);
      assert.equal(p.reserved, 15);
      assert.equal(
        (
          await req("/inventory/" + p.id + "/adjustments", admin, "POST", {
            delta: -30,
            reason: "Corrección de conteo",
            version: p.version,
          })
        ).status,
        409,
      );
      assert.equal((await req("/sales", buyer, "POST", draft)).status, 403);
      assert.equal(
        (await req("/sales", seller, "POST", { ...draft, cashReceived: 0 }))
          .data.code,
        "INSUFFICIENT_CASH",
      );
      const saleKey = crypto.randomUUID(),
        sale = await req(
          "/sales",
          seller,
          "POST",
          { ...draft, cashReceived: 15000 },
          saleKey,
        );
      assert.equal(sale.status, 201);
      assert.equal(sale.data.status, "delivered");
      assert.equal(sale.data.paymentStatus, "paid");
      assert.equal(sale.data.channel, "pos");
      assert.equal(
        (
          await req(
            "/sales",
            seller,
            "POST",
            { ...draft, cashReceived: 15000 },
            saleKey,
          )
        ).data.id,
        sale.data.id,
      );
      p = (await req("/inventory", admin)).data.find((x: any) => x.id === p.id);
      assert.equal(p.stock, 25);
      assert.equal(p.reserved, 15);
      assert.equal(
        (await req("/sales", seller, "POST", { ...draft, cashReceived: 15000 }))
          .status,
        409,
      );
      assert.equal(
        (
          await req("/sales", seller, "POST", {
            ...draft,
            paymentMethod: "nequi",
            cashReceived: 15000,
          })
        ).status,
        409,
      );
      const adjustments = await req(
        "/inventory/" + p.id + "/adjustments",
        admin,
        "POST",
        { delta: 5, reason: "Ingreso documentado", version: p.version },
      );
      assert.equal(adjustments.status, 201);
      p = (await req("/inventory", admin)).data.find((x: any) => x.id === p.id);
      const update = {
        ...input,
        version: p.version,
        name: "Producto actualizado",
        minimum: 50,
        presentations: p.presentations,
      };
      delete (update as any).initialStock;
      assert.equal(
        (await req("/inventory/" + p.id, admin, "PUT", update)).status,
        201,
      );
      assert.equal(
        (await req("/orders/" + order.id, buyer)).data.lines[0].productName,
        "Producto prueba",
      );
      const alert = (await req("/notifications", seller)).data.find(
        (n: any) => n.id.startsWith("stock:") && n.payload.productId === p.id,
      );
      assert.ok(alert);
      await req("/notifications/" + alert.id + "/read", seller, "POST", {});
      assert.ok(
        (await req("/notifications", seller)).data.find(
          (n: any) => n.id === alert.id,
        ).read,
      );
      const close = (await req("/settings", admin)).data;
      close.override = "closed";
      assert.equal((await req("/settings", admin, "PUT", close)).status, 201);
      const closedOrder = await req("/orders", buyer, "POST", draft);
      assert.equal(closedOrder.status, 201);
      await req("/orders/" + closedOrder.data.id + "/actions", buyer, "POST", {
        action: "cancel",
      });
      assert.equal(
        (
          await req("/orders/" + order.id + "/actions", buyer, "POST", {
            action: "cancel",
          })
        ).status,
        201,
      );
      const notes = (await req("/notifications", buyer)).data;
      assert.ok(notes.length >= 2);
      assert.ok(
        notes.every((n: any) =>
          [order.id, closedOrder.data.id].includes(n.payload.orderId),
        ),
      );
      await req("/notifications/" + notes[0].id + "/read", buyer, "POST", {});
      const after = (await req("/notifications", buyer)).data;
      assert.equal(after.filter((n: any) => n.read).length, 1);
      const stranger = (await req("/auth/guest", "", "POST", {})).data
        .accessToken;
      assert.equal((await req("/notifications", stranger)).data.length, 0);
      const audit = (await req("/audit", admin)).data;
      assert.ok(audit.some((a: any) => a.kind === "stock.adjusted"));
      assert.ok(audit.some((a: any) => a.kind === "sale"));
      assert.ok(audit.every((a: any) => a.actorId));
      assert.equal(
        (await req("/inventory", admin)).data.find((x: any) => x.id === p.id)
          .reserved,
        0,
      );
    } finally {
      await server?.close();
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
  },
);
