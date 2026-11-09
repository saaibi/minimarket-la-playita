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
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { databaseOptions } from "./database-options.js";
import { Server } from "socket.io";
import { orderDraftSchema, actionSchema, type Actor } from "@playita/shared";
import { z } from "zod";
import { Store } from "./store.js";
import { AuthService, AuthError } from "./auth.js";
import { type VerificationProvider } from "./verification.js";
import { json } from "express";
const STORE = "STORE";
type Request = { actor: Actor; headers: Record<string, string | undefined> };
function key(req: Request) {
  return z.uuid().safeParse(req.headers["idempotency-key"]);
}
@Controller()
class ApiController {
  constructor(@Inject(STORE) private readonly store: Store) {}
  @Get("health") async health() {
    try {
      const healthQuery = {
        text: "SELECT version FROM schema_migrations WHERE version = $1",
        values: ["002_sessions.sql"],
        query_timeout: 2500,
      };
      const result = await this.store.pool.query(healthQuery);
      if (result.rowCount !== 1) throw Error("Migrations missing");
      return { status: "ok", database: "postgresql", increment: 2 };
    } catch {
      throw new ServiceUnavailableException({ status: "not_ready" });
    }
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
  production?: boolean;
  verificationProvider?: VerificationProvider;
  origins?: string[];
}) {
  const pool = new Pool(databaseOptions(config.databaseUrl));
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
  if (
    config.production &&
    (!config.origins?.length ||
      config.origins.some(
        (o) =>
          !o.startsWith("https://") &&
          !["capacitor://localhost", "http://localhost"].includes(o),
      ))
  )
    throw Error("Production requires explicit HTTPS CORS allowlist");
  app.enableCors({ origin: origins, credentials: true });
  app.use(json({ limit: "64kb" }));
  const auth = new AuthService(
    pool,
    origins,
    !!config.production,
    config.verificationProvider,
    (family) => io?.in("session:" + family).disconnectSockets(true),
  );
  await auth.init();
  app.use(async (req: any, res: any, next: () => void) => {
    if (req.method === "OPTIONS") return next();
    if (req.path === "/health") return next();
    if (req.path.startsWith("/auth/")) return auth.handle(req, res);
    try {
      const session = await auth.protect(req);
      req.actor = session.actor;
      next();
    } catch (e) {
      return res
        .status(e instanceof AuthError ? e.status : 401)
        .json({ code: e instanceof AuthError ? e.code : "AUTH_REQUIRED" });
    }
  });
  io = new Server(app.getHttpServer(), {
    cors: { origin: origins, credentials: true },
  });
  io.use(async (socket, next) => {
    try {
      if (
        socket.handshake.headers.origin &&
        !origins.includes(socket.handshake.headers.origin)
      )
        throw Error("ORIGIN_REJECTED");
      const nativeToken = socket.handshake.auth.accessToken;
      const req = {
        headers: nativeToken
          ? {
              "x-playita-client": "native",
              authorization: "Bearer " + String(nativeToken),
            }
          : socket.handshake.headers,
        method: "GET",
      };
      socket.data.session = await auth.identity(req);
      socket.data.authRequest = req;
      next();
    } catch {
      next(Error("AUTH_REQUIRED"));
    }
  });
  io.on("connection", (socket) => {
    const session = socket.data.session,
      actor = session.actor as Actor;
    socket.join("catalog");
    socket.join("owner:" + actor.id);
    socket.join("session:" + session.family);
    if (actor.role !== "buyer") socket.join("staff");
    const expiry = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, session.expires - Date.now()),
    );
    const check = setInterval(() => {
      void auth
        .identity(socket.data.authRequest)
        .then((current) => {
          if (current.actor.role !== actor.role) socket.disconnect(true);
        })
        .catch(() => socket.disconnect(true));
    }, 30000);
    socket.on("disconnect", () => {
      clearTimeout(expiry);
      clearInterval(check);
    });
  });
  await app.init();
  return {
    app,
    pool,
    store,
    auth,
    io,
    close: async () => {
      io?.disconnectSockets(true);
      await app.close();
      await pool.end();
    },
  };
}
