import { z } from "zod";
import {
  orderDraftSchema,
  actionSchema,
} from "../packages/shared/src/index.js";
import { writeFile } from "node:fs/promises";
const json = (schema: z.ZodType) => {
  const value = z.toJSONSchema(schema);
  delete value.$schema;
  return value;
};
const error = {
  description: "Error explícito; conflicto no confirma ni reserva un pedido.",
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } },
  },
};
const success = {
  description:
    "Pedido con snapshot de líneas/precios, reserva confirmada en transacción; no significa pago confirmado.",
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Order" } },
  },
};
const idempotency = {
  in: "header",
  name: "Idempotency-Key",
  required: true,
  schema: { type: "string", format: "uuid" },
  description:
    "Reutilizar la misma clave y mismo body al reintentar. Revisión de conflicto usa clave nueva. Alcance por identidad autenticada; sin vencimiento en este incremento.",
};
const contract = {
  openapi: "3.1.0",
  info: {
    title: "Minimarket La Playita",
    version: "0.1.0",
    description:
      "Primer incremento local. PostgreSQL transaccional. JWT local de desarrollo; onboarding/autenticación productiva pendiente. Offline solo Android/iOS: pending_sync sin reserva global. Nequi no integrado y nunca se marca pagado por aceptar.",
  },
  servers: [{ url: "http://127.0.0.1:4300" }],
  security: [{ bearer: [] }],
  paths: {
    "/health": {
      get: {
        security: [],
        responses: {
          "200": { description: "Conexión PostgreSQL real disponible" },
        },
      },
    },
    "/inventory": {
      get: {
        description:
          "Stock físico/reservado/disponible y presentaciones. Costo solo administrador. Comprador solo productos visibles.",
        responses: {
          "200": {
            description: "Catálogo actual",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Product" },
                },
              },
            },
          },
          "401": error,
        },
      },
    },
    "/orders": {
      get: {
        description:
          "Hasta 100 pedidos recientes. Comprador solo propios; tienda todos. Paginación ampliada pendiente.",
        responses: { "200": { description: "Lista de pedidos" }, "401": error },
      },
      post: {
        parameters: [idempotency],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OrderDraft" },
            },
          },
        },
        responses: { "201": success, "400": error, "401": error, "409": error },
      },
    },
    "/orders/{id}": {
      get: {
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": success, "400": error, "401": error, "404": error },
      },
    },
    "/orders/{id}/actions": {
      post: {
        description:
          "Tienda: accept → ready → pay_cash y deliver (pago y preparación separados). Cancel permitido al dueño o tienda antes de cobro. Entregar descuenta una sola vez. Nequi sin integración no puede cobrarse con pay_cash.",
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          idempotency,
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: json(actionSchema) } },
        },
        responses: {
          "201": success,
          "400": error,
          "401": error,
          "403": error,
          "409": error,
        },
      },
    },
    "/events": {
      get: {
        description:
          "Recuperación durable tras reconexión; cursor global creciente (string bigint), máximo 200 por respuesta. Comprador: propios + catálogo. Repetir desde último id; Socket.IO solo invalida, REST es la fuente de verdad.",
        parameters: [
          {
            in: "query",
            name: "after",
            schema: { type: "string", pattern: "^\\d{1,18}$", default: "0" },
          },
        ],
        responses: {
          "200": { description: "Eventos posteriores ordenados por id" },
          "400": error,
          "401": error,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      OrderDraft: json(orderDraftSchema),
      Order: {
        type: "object",
        required: [
          "id",
          "status",
          "paymentStatus",
          "totalCop",
          "clientName",
          "lines",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          status: {
            enum: ["confirmed", "accepted", "ready", "delivered", "cancelled"],
          },
          paymentStatus: { enum: ["pending", "not_integrated", "paid"] },
          totalCop: { type: "integer" },
          clientName: { type: "string" },
          lines: {
            type: "array",
            items: {
              type: "object",
              description:
                "Snapshot producto/presentación/factor/cantidad base/precio/total",
            },
          },
        },
      },
      Product: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          kind: { enum: ["unit", "weight"] },
          stock: { type: "integer" },
          reserved: { type: "integer" },
          available: { type: "integer" },
          priceCop: { type: "integer" },
          costCop: { type: "integer", description: "Solo admin" },
          presentations: { type: "array", items: { type: "object" } },
        },
      },
      Error: {
        type: "object",
        required: ["code"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: {},
        },
      },
    },
  },
};
await writeFile(
  new URL("../docs/openapi.json", import.meta.url),
  JSON.stringify(contract, null, 2) + "\n",
);
console.log("docs/openapi.json generado desde contrato Zod compartido");
