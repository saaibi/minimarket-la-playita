import { z } from "zod";
import {
  orderDraftSchema,
  actionSchema,
  productWriteSchema,
  stockAdjustmentSchema,
  scheduleSchema,
  saleDraftSchema,
  clientWriteSchema,
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
      "Base de desarrollo. PostgreSQL transaccional. Sesiones opacas web/nativas con rotación; despliegue pendiente. Offline solo Android/iOS: pending_sync sin reserva global. Nequi no integrado y nunca se marca pagado por aceptar.",
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
const doc = contract as any;
doc.info.version = "0.2.0";
doc.info.description =
  "Sesiones opacas verificadas contra PostgreSQL (no JWT demo): acceso 5 min, refresh rotatorio 7 días, límite absoluto 30 días y revocación/reuso. Invitado buyer emitido servidor; personal con contraseña y alta admin. Web cookies HttpOnly + CSRF/Origin; nativo secure storage. Google/Apple no conectados; WhatsApp futuro sin proveedor por defecto.";
doc.components.securitySchemes = {
  bearer: {
    type: "http",
    scheme: "bearer",
    bearerFormat: "Opaque server-validated access token",
  },
  sessionCookie: { type: "apiKey", in: "cookie", name: "playita_access" },
};
doc.security = [{ sessionCookie: [] }, { bearer: [] }];
const request = (properties: Record<string, unknown>, required: string[]) => ({
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        additionalProperties: false,
        properties,
        required,
      },
    },
  },
});
const authResponse = {
  description:
    "Web: actor + expiración y Set-Cookie HttpOnly, sin tokens en body. Nativo X-Playita-Client:native: actor + accessToken/refreshToken para vault seguro.",
};
for (const [path, properties, required] of [
  [
    "login",
    {
      email: { type: "string", format: "email" },
      password: { type: "string", maxLength: 128 },
    },
    ["email", "password"],
  ],
  ["guest", {}, []],
  [
    "refresh",
    {
      refreshToken: {
        type: "string",
        description: "Solo nativo; web usa cookie y body vacío",
      },
    },
    [],
  ],
  [
    "logout",
    {
      refreshToken: {
        type: "string",
        description: "Solo nativo; web usa cookie y body vacío",
      },
    },
    [],
  ],
] as const) {
  doc.paths["/auth/" + path] = {
    post: {
      security: [],
      description:
        "X-Playita-Client obligatorio en mutaciones web; Origin allowlist y Content-Type JSON. Refresh/logout web requieren X-CSRF-Token tomado de playita_csrf. No registrar secretos. Login/guest sujetos a rate limit.",
      requestBody: request(properties, [...required]),
      responses: {
        "200": authResponse,
        "400": error,
        "401": error,
        "403": error,
        "429": error,
      },
    },
  };
}
doc.paths["/auth/me"] = {
  get: {
    responses: {
      "200": {
        description:
          "Identidad y vencimiento actuales, rol consultado al servidor",
      },
      "401": error,
    },
  },
};
doc.paths["/auth/options"] = {
  get: {
    security: [],
    responses: {
      "200": {
        description:
          "Guest/staff activos; Google/Apple disponibles=false hasta integración real",
      },
    },
  },
};
doc.paths["/auth/users"] = {
  get: {
    description: "Solo admin, lista staff sin contraseñas/hashes",
    responses: {
      "200": { description: "Lista staff" },
      "401": error,
      "403": error,
    },
  },
  post: {
    description: "Solo admin. Crea seller/admin; no registro público.",
    requestBody: request(
      {
        email: { type: "string", format: "email" },
        password: { type: "string", minLength: 12, maxLength: 128 },
        role: { enum: ["admin", "seller"] },
      },
      ["email", "password", "role"],
    ),
    responses: {
      "201": { description: "Cuenta creada sin hash/contraseña en respuesta" },
      "400": error,
      "401": error,
      "403": error,
      "409": error,
    },
  },
};
doc.paths["/auth/users/{id}/disable"] = {
  post: {
    parameters: [
      {
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    description:
      "Solo admin; desactiva y revoca sesiones. No permite desactivarse a sí mismo ni eliminar último admin.",
    responses: {
      "200": { description: "Desactivada" },
      "401": error,
      "403": error,
      "409": error,
    },
  },
};
doc.paths["/auth/whatsapp/request"] = {
  post: {
    security: [],
    description:
      "Puerto futuro opcional, no requerido para comprar. Sin proveedor devuelve 503; habilitar Twilio puede generar costes, no activado en esta entrega.",
    requestBody: request(
      { phone: { type: "string", pattern: "^\\+[1-9]\\d{7,14}$" } },
      ["phone"],
    ),
    responses: {
      "200": { description: "challengeId y expiración, nunca código OTP" },
      "429": error,
      "503": error,
    },
  },
};
doc.paths["/auth/whatsapp/verify"] = {
  post: {
    security: [],
    requestBody: request(
      {
        challengeId: { type: "string", format: "uuid" },
        code: { type: "string" },
      },
      ["challengeId", "code"],
    ),
    responses: {
      "200": authResponse,
      "401": error,
      "429": error,
      "503": error,
    },
  },
};
Object.assign(contract.paths, {
  "/inventory": {
    ...contract.paths["/inventory"],
    post: {
      description:
        "Solo admin. Alta de producto y presentaciones, existencias iniciales auditadas.",
      parameters: [idempotency],
      requestBody: {
        required: true,
        content: { "application/json": { schema: json(productWriteSchema) } },
      },
      responses: {
        "201": { description: "Producto creado" },
        "403": error,
        "409": error,
      },
    },
  },
  "/inventory/{id}": {
    put: {
      description:
        "Solo admin; versión obligatoria. Conserva snapshots de pedidos existentes.",
      parameters: [
        idempotency,
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: json(productWriteSchema) } },
      },
      responses: {
        "201": { description: "Producto actualizado" },
        "403": error,
        "409": error,
      },
    },
  },
  "/inventory/{id}/adjustments": {
    post: {
      description:
        "Solo admin; delta y motivo auditados. Nunca reduce por debajo de reservas.",
      parameters: [
        idempotency,
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: json(stockAdjustmentSchema) },
        },
      },
      responses: {
        "201": { description: "Ajuste guardado" },
        "403": error,
        "409": error,
      },
    },
  },
  "/sales": {
    post: {
      description:
        "Admin/vendedor. Venta POS en efectivo atómica: entregada y pagada, sin tocar reservas ajenas; misma clave para retries. Nequi no integrado.",
      parameters: [idempotency],
      requestBody: {
        required: true,
        content: { "application/json": { schema: json(saleDraftSchema) } },
      },
      responses: { "201": success, "403": error, "409": error },
    },
  },
  "/settings": {
    get: {
      responses: {
        "200": {
          description:
            "Horario Bogotá y versión; modo manual hasta volver a automático",
        },
      },
    },
    put: {
      description:
        "Solo admin; conflicto de versión protege cambios simultáneos.",
      parameters: [idempotency],
      requestBody: {
        required: true,
        content: { "application/json": { schema: json(scheduleSchema) } },
      },
      responses: {
        "201": { description: "Horario guardado" },
        "403": error,
        "409": error,
      },
    },
  },
  "/audit": {
    get: {
      description:
        "Solo admin. Últimos 200 movimientos/ediciones con responsable y antes/después.",
      responses: { "200": { description: "Trazabilidad" }, "403": error },
    },
  },
  "/notifications": {
    get: {
      description:
        "Últimas 100 notificaciones. Comprador solo pedidos propios; lectura por identidad.",
      responses: { "200": { description: "Notificaciones" } },
    },
  },
  "/notifications/{id}/read": {
    post: {
      description:
        "Marcar una notificación accesible como leída, sin marcar las demás.",
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", pattern: "^[0-9]+$" },
        },
      ],
      responses: { "200": { description: "Lectura guardada" } },
    },
  },
});
Object.assign(contract.paths, {
  "/clients": {
    get: {
      description: "Admin/vendedor; nunca comprador.",
      responses: { "200": { description: "Clientes de tienda" }, "403": error },
    },
    post: {
      description: "Solo admin; snapshots históricos no cambian.",
      parameters: [idempotency],
      requestBody: {
        required: true,
        content: { "application/json": { schema: json(clientWriteSchema) } },
      },
      responses: { "201": { description: "Cliente creado" }, "403": error },
    },
  },
  "/clients/{id}": {
    put: {
      description: "Solo admin; versión protege ediciones simultáneas.",
      parameters: [
        idempotency,
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: json(clientWriteSchema) } },
      },
      responses: {
        "201": { description: "Cliente actualizado" },
        "403": error,
        "409": error,
      },
    },
  },
});
await writeFile(
  new URL("../docs/openapi.json", import.meta.url),
  JSON.stringify(contract, null, 2) + "\n",
);
console.log("docs/openapi.json generado desde contrato Zod compartido");
