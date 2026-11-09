import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Body,
  Param,
  Query,
  Module,
  Inject,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { Server } from "socket.io";
import { orderDraftSchema, actionSchema, type Actor } from "@playita/shared";
import { z } from "zod";
import { Store } from "./store.js";
import { authenticate } from "./auth.js";
const STORE = "STORE";
type Request = { actor: Actor; headers: Record<string, string | undefined> };
function key(req: Request) {
  return z.uuid().safeParse(req.headers["idempotency-key"]);
}
@Controller()
class ApiController {
  constructor(@Inject(STORE) private readonly store: Store) {}
  @Get("health") async health() {
    await this.store.pool.query("SELECT 1");
    return { status: "ok", database: "postgresql", increment: 1 };
  }
  @Get("inventory") inventory(@Req() req: Request) {
    return this.store.inventory(req.actor);
  }
  @Get("orders") orders(@Req() req: Request) {
    return this.store.list(req.actor);
  }
  @Get("orders/:id") async order(
    @Req() req: Request,
    @Param("id") id: string,
    @Res() res: any,
  ) {
    if (!z.uuid().safeParse(id).success)
      return res.status(400).json({ code: "INVALID_ID" });
    const found = await this.store.get(req.actor, id);
    return res.status(found ? 200 : 404).json(found || { code: "NOT_FOUND" });
  }
  @Post("orders") async create(
    @Req() req: Request,
    @Body() input: unknown,
    @Res() res: any,
  ) {
    const parsed = orderDraftSchema.safeParse(input),
      id = key(req);
    if (!parsed.success || !id.success)
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Body válido e Idempotency-Key UUID son obligatorios",
        details: parsed.error?.flatten(),
      });
    const reply = await this.store.create(req.actor, id.data, parsed.data);
    res.setHeader("Idempotency-Replayed", String(!!reply.replayed));
    return res.status(reply.status).json(reply.body);
  }
  @Post("orders/:id/actions") async action(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
    @Res() res: any,
  ) {
    const parsed = actionSchema.safeParse(input),
      idempotency = key(req);
    if (
      !parsed.success ||
      !idempotency.success ||
      !z.uuid().safeParse(id).success
    )
      return res.status(400).json({ code: "VALIDATION_ERROR" });
    if (req.actor.role === "buyer" && parsed.data.action !== "cancel")
      return res.status(403).json({ code: "FORBIDDEN_ACTION" });
    const reply = await this.store.action(
      req.actor,
      idempotency.data,
      id,
      parsed.data.action,
    );
    res.setHeader("Idempotency-Replayed", String(!!reply.replayed));
    return res.status(reply.status).json(reply.body);
  }
  @Get("events") async events(
    @Req() req: Request,
    @Query("after") after = "0",
    @Res() res: any,
  ) {
    if (!/^\d{1,18}$/.test(after))
      return res.status(400).json({ code: "INVALID_CURSOR" });
    return res.json(await this.store.events(req.actor, after));
  }
}
export async function createApp(config: {
  databaseUrl: string;
  secret: string;
  origins?: string[];
}) {
  if (config.secret.length < 32)
    throw Error("JWT secret must be at least 32 characters");
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    await pool.end();
    throw e;
  }
  let io: Server | undefined;
  const store = new Store(pool, (events) => {
    for (const event of events) {
      const rooms = event.ownerId
        ? ["owner:" + event.ownerId, "staff"]
        : "catalog";
      io?.to(rooms).emit("change", event);
    }
  });
  @Module({
    controllers: [ApiController],
    providers: [{ provide: STORE, useValue: store }],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  const origins = config.origins || [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost",
  ];
  app.enableCors({ origin: origins });
  app.use(async (req: any, res: any, next: () => void) => {
    if (req.path === "/health") return next();
    try {
      req.actor = await authenticate(req.headers.authorization, config.secret);
      next();
    } catch {
      return res
        .status(401)
        .json({ code: "AUTH_REQUIRED", message: "Token válido requerido" });
    }
  });
  io = new Server(app.getHttpServer(), { cors: { origin: origins } });
  io.use(async (socket, next) => {
    try {
      socket.data.actor = await authenticate(
        "Bearer " + String(socket.handshake.auth.token || ""),
        config.secret,
      );
      next();
    } catch {
      next(Error("AUTH_REQUIRED"));
    }
  });
  io.on("connection", (socket) => {
    const actor = socket.data.actor as Actor;
    socket.join("catalog");
    socket.join("owner:" + actor.id);
    if (actor.role !== "buyer") socket.join("staff");
  });
  await app.init();
  return {
    app,
    pool,
    store,
    io,
    close: async () => {
      io?.disconnectSockets(true);
      await app.close();
      await pool.end();
    },
  };
}
