import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  parseCookie as parse,
  stringifySetCookie,
  type SetCookie,
} from "cookie";
const serialize = (
  name: string,
  value: string,
  options: Omit<SetCookie, "name" | "value">,
) => stringifySetCookie({ name, value, ...options });
import { z } from "zod";
import type { Actor } from "@playita/shared";
import type { GoogleVerifier } from "./google.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  UnavailableVerification,
  type VerificationProvider,
} from "./verification.js";
const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex"),
  random = () => randomBytes(32).toString("base64url");
const email = z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password = z.string().min(12).max(128),
  phone = z.string().regex(/^\+[1-9]\d{7,14}$/);
export type AuthIdentity = {
  actor: Actor;
  family: string;
  expires: number;
  csrfHash: string;
  client: "web" | "native";
  label: string;
  guest: boolean;
};
export class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export class AuthService {
  private dummy = "";
  constructor(
    readonly pool: Pool,
    readonly origins: string[],
    readonly secure: boolean,
    private provider: VerificationProvider = new UnavailableVerification(),
    private revoke: (family: string) => void = () => {},
    private clock = Date.now,
    private google?: GoogleVerifier,
  ) {}
  async init() {
    this.dummy = await hashPassword(random());
  }
  private client(req: any): "web" | "native" {
    if (req.headers["x-playita-client"] === "native") {
      const origin = req.headers.origin;
      if (
        origin &&
        ![
          "capacitor://localhost",
          "http://localhost",
          "https://localhost",
        ].includes(origin)
      )
        throw new AuthError(403, "ORIGIN_REJECTED");
      return "native";
    }
    return "web";
  }
  private origin(req: any) {
    if (!this.origins.includes(req.headers.origin))
      throw new AuthError(403, "ORIGIN_REJECTED");
    if (
      !String(req.headers["content-type"] || "").startsWith(
        "application/json",
      ) ||
      req.headers["x-playita-client"] !== "web"
    )
      throw new AuthError(403, "CSRF_REQUIRED");
  }
  private mode(req: any) {
    const mode = this.client(req);
    if (mode === "web") this.origin(req);
    return mode;
  }
  private cookies(req: any) {
    return parse(req.headers.cookie || "");
  }
  private csrf(req: any, hash: string) {
    const value = String(req.headers["x-csrf-token"] || "");
    if (!value || digest(value) !== hash)
      throw new AuthError(403, "CSRF_REQUIRED");
  }
  async identity(req: any): Promise<AuthIdentity> {
    const mode = this.client(req),
      access =
        mode === "native"
          ? String(req.headers.authorization || "").replace(/^Bearer /, "")
          : this.cookies(req).playita_access;
    if (!access) throw new AuthError(401, "AUTH_REQUIRED");
    const row = (
      await this.pool.query(
        `SELECT s.*,u.role,u.email,u.phone,u.is_guest FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.access_hash=$1 AND s.client_type=$2 AND u.active AND s.rotated_at IS NULL AND s.revoked_at IS NULL AND s.access_expires_at>$3 AND s.absolute_expires_at>$3`,
        [digest(access), mode, new Date(this.clock())],
      )
    ).rows[0];
    if (!row) throw new AuthError(401, "AUTH_REQUIRED");
    return {
      guest: !!row.is_guest,
      actor: { id: row.user_id, role: row.role },
      family: row.family_id,
      expires: new Date(row.access_expires_at).getTime(),
      csrfHash: row.csrf_hash,
      client: mode,
      label:
        row.email ||
        (row.phone ? "WhatsApp …" + String(row.phone).slice(-4) : "Invitado"),
    };
  }
  async protect(req: any) {
    const session = await this.identity(req);
    if (
      session.client === "web" &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      this.origin(req);
      this.csrf(req, session.csrfHash);
    }
    return session;
  }
  private async limit(name: string, key: string, max: number) {
    const window = Math.floor(this.clock() / 900000),
      row = (
        await this.pool.query(
          "INSERT INTO auth_limits(bucket,window_start,hits) VALUES($1,$2,1) ON CONFLICT(bucket,window_start) DO UPDATE SET hits=auth_limits.hits+1 RETURNING hits",
          [name + ":" + digest(key), window],
        )
      ).rows[0];
    if (row.hits > max) throw new AuthError(429, "TRY_LATER");
  }
  private async rate(req: any, key: string, kind: string, max = 10) {
    await this.limit(kind + "-ip", req.socket.remoteAddress || "unknown", 60);
    await this.limit(kind + "-identity", key, max);
  }
  private async revokeFamily(db: Pool | PoolClient, family: string) {
    await db.query(
      "UPDATE auth_sessions SET revoked_at=$2 WHERE family_id=$1 AND revoked_at IS NULL",
      [family, new Date(this.clock())],
    );
    this.revoke(family);
  }
  private async issue(
    db: Pool | PoolClient,
    user: any,
    client: "web" | "native",
    family = randomUUID(),
    absolute = this.clock() + 30 * 86400000,
  ) {
    const access = random(),
      refresh = random(),
      csrf = random(),
      expires = this.clock() + 5 * 60000,
      refreshExpires = Math.min(absolute, this.clock() + 7 * 86400000);
    await db.query(
      "INSERT INTO auth_sessions(id,family_id,user_id,client_type,access_hash,refresh_hash,csrf_hash,access_expires_at,refresh_expires_at,absolute_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        randomUUID(),
        family,
        user.id,
        client,
        digest(access),
        digest(refresh),
        digest(csrf),
        new Date(expires),
        new Date(refreshExpires),
        new Date(absolute),
      ],
    );
    return {
      access,
      refresh,
      csrf,
      expires,
      refreshExpires,
      actor: {
        id: user.id,
        role: user.role,
        label:
          user.email ||
          (user.phone
            ? "WhatsApp …" + String(user.phone).slice(-4)
            : "Invitado"),
        guest: !!user.is_guest,
      },
    };
  }
  private respond(
    res: any,
    client: "web" | "native",
    result: Awaited<ReturnType<AuthService["issue"]>>,
  ) {
    res.setHeader("Cache-Control", "no-store");
    if (client === "web") {
      const common = { secure: this.secure, sameSite: "lax" as const };
      res.setHeader("Set-Cookie", [
        serialize("playita_access", result.access, {
          ...common,
          httpOnly: true,
          path: "/",
          expires: new Date(result.expires),
        }),
        serialize("playita_refresh", result.refresh, {
          ...common,
          httpOnly: true,
          path: "/auth",
          expires: new Date(result.refreshExpires),
        }),
        serialize("playita_csrf", result.csrf, {
          ...common,
          path: "/",
          expires: new Date(result.refreshExpires),
        }),
      ]);
      return res.json({ actor: result.actor, accessExpiresAt: result.expires });
    }
    return res.json({
      actor: result.actor,
      accessToken: result.access,
      refreshToken: result.refresh,
      accessExpiresAt: result.expires,
    });
  }
  private clear(res: any) {
    res.setHeader("Set-Cookie", [
      serialize("playita_access", "", {
        path: "/",
        httpOnly: true,
        secure: this.secure,
        sameSite: "lax",
        maxAge: 0,
      }),
      serialize("playita_refresh", "", {
        path: "/auth",
        httpOnly: true,
        secure: this.secure,
        sameSite: "lax",
        maxAge: 0,
      }),
      serialize("playita_csrf", "", {
        path: "/",
        secure: this.secure,
        sameSite: "lax",
        maxAge: 0,
      }),
    ]);
  }
  async handle(req: any, res: any) {
    res.setHeader("Cache-Control", "no-store");
    try {
      const path = req.path,
        body = req.body || {};
      if (req.method === "GET" && path === "/auth/me") {
        const s = await this.identity(req);
        return res.json({
          actor: { ...s.actor, label: s.label, guest: s.guest },
          accessExpiresAt: s.expires,
        });
      }
      if (req.method === "GET" && path === "/auth/options")
        return res.json({
          guest: true,
          staffPassword: true,
          google: this.google
            ? { available: true, clientId: this.google.clientId }
            : { available: false, reason: "GOOGLE_NOT_CONFIGURED" },
          apple: { available: false, reason: "OIDC_INTEGRATION_PENDING" },
        });
      if (req.method === "POST" && path === "/auth/google/challenge") {
        const mode = this.mode(req);
        z.object({}).strict().parse(body);
        if (!this.google) throw new AuthError(503, "GOOGLE_NOT_CONFIGURED");
        await this.rate(
          req,
          req.socket.remoteAddress || "unknown",
          "google-start",
          20,
        );
        const id = randomUUID(),
          nonce = random(),
          proof = random();
        await this.pool.query(
          "DELETE FROM google_challenges WHERE expires_at<$1",
          [new Date(this.clock() - 86400000)],
        );
        await this.pool.query(
          "INSERT INTO google_challenges(id,client_type,proof_hash,nonce,expires_at) VALUES($1,$2,$3,$4,$5)",
          [id, mode, digest(proof), nonce, new Date(this.clock() + 300000)],
        );
        if (mode === "web")
          res.setHeader(
            "Set-Cookie",
            serialize("playita_google", proof, {
              path: "/",
              httpOnly: true,
              secure: this.secure,
              sameSite: "strict",
              maxAge: 300,
            }),
          );
        return res.json({
          challengeId: id,
          nonce,
          clientId: this.google.clientId,
          ...(mode === "native" ? { proof } : {}),
        });
      }
      if (req.method === "POST" && path === "/auth/google/verify") {
        const mode = this.mode(req);
        if (!this.google) throw new AuthError(503, "GOOGLE_NOT_CONFIGURED");
        const input = z
          .object({
            challengeId: z.uuid(),
            credential: z.string().min(100).max(10000),
            proof: z.string().min(32).max(100).optional(),
          })
          .strict()
          .parse(body);
        await this.rate(req, input.challengeId, "google-verify", 5);
        const proof =
          mode === "native" ? input.proof : this.cookies(req).playita_google;
        if (!proof) throw new AuthError(401, "GOOGLE_SIGNIN_FAILED");
        const c = (
          await this.pool.query(
            "UPDATE google_challenges SET attempts=attempts+1 WHERE id=$1 AND client_type=$2 AND proof_hash=$3 AND consumed_at IS NULL AND expires_at>$4 AND attempts<5 RETURNING *",
            [input.challengeId, mode, digest(proof), new Date(this.clock())],
          )
        ).rows[0];
        if (!c) throw new AuthError(401, "GOOGLE_SIGNIN_FAILED");
        let identity;
        try {
          identity = await this.google.verify(input.credential, c.nonce);
        } catch {
          throw new AuthError(401, "GOOGLE_SIGNIN_FAILED");
        }
        const db = await this.pool.connect();
        try {
          await db.query("BEGIN");
          const consumed = await db.query(
            "UPDATE google_challenges SET consumed_at=$2 WHERE id=$1 AND consumed_at IS NULL AND expires_at>$2 RETURNING id",
            [c.id, new Date(this.clock())],
          );
          if (!consumed.rowCount)
            throw new AuthError(401, "GOOGLE_SIGNIN_FAILED");
          // Bind by Google's stable subject. Initial email matching is restricted
          // to Google-authoritative email ownership, never a client-provided role.
          await db.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,77332005))",
            [identity.subject],
          );
          let user = (
            await db.query(
              "SELECT u.* FROM google_identities g JOIN app_users u ON u.id=g.user_id WHERE g.subject=$1 FOR UPDATE OF u",
              [identity.subject],
            )
          ).rows[0];
          if (!user) {
            user = (
              await db.query(
                "SELECT * FROM app_users WHERE email=$1 FOR UPDATE",
                [identity.email],
              )
            ).rows[0];
            if (user) {
              if (!identity.emailAuthoritative)
                throw new AuthError(409, "ACCOUNT_EXISTS_USE_EXISTING_LOGIN");
              if (
                (
                  await db.query(
                    "SELECT 1 FROM google_identities WHERE user_id=$1",
                    [user.id],
                  )
                ).rowCount
              )
                throw new AuthError(409, "ACCOUNT_EXISTS_USE_EXISTING_LOGIN");
            } else {
              user = (
                await db.query(
                  "INSERT INTO app_users(id,email,role) VALUES($1,$2,'buyer') RETURNING *",
                  [randomUUID(), identity.email],
                )
              ).rows[0];
            }
            if (!user.active) throw new AuthError(403, "GOOGLE_SIGNIN_FAILED");
            await db.query(
              "INSERT INTO google_identities(subject,user_id) VALUES($1,$2)",
              [identity.subject, user.id],
            );
          }
          if (!user.active) throw new AuthError(403, "GOOGLE_SIGNIN_FAILED");
          const result = await this.issue(db, user, mode);
          await db.query("COMMIT");
          return this.respond(res, mode, result);
        } catch (e: any) {
          await db.query("ROLLBACK");
          if (e.code === "23505")
            throw new AuthError(409, "ACCOUNT_EXISTS_USE_EXISTING_LOGIN");
          throw e;
        } finally {
          db.release();
        }
      }
      if (req.method === "POST" && path === "/auth/guest") {
        const mode = this.mode(req);
        z.object({}).strict().parse(body);
        await this.rate(
          req,
          req.socket.remoteAddress || "unknown",
          "guest",
          30,
        );
        const user = (
          await this.pool.query(
            "INSERT INTO app_users(id,role,is_guest) VALUES($1,'buyer',true) RETURNING *",
            [randomUUID()],
          )
        ).rows[0];
        return this.respond(res, mode, await this.issue(this.pool, user, mode));
      }
      if (req.method === "POST" && path === "/auth/login") {
        const mode = this.mode(req),
          input = z
            .object({ email, password: z.string().min(1).max(128) })
            .strict()
            .parse(body);
        await this.rate(req, input.email, "login");
        const user = (
          await this.pool.query(
            "SELECT * FROM app_users WHERE email=$1 AND active AND role IN ('admin','seller')",
            [input.email],
          )
        ).rows[0];
        const valid = await verifyPassword(
          input.password,
          user?.password_hash || this.dummy,
        );
        if (!user || !valid) throw new AuthError(401, "INVALID_CREDENTIALS");
        return this.respond(res, mode, await this.issue(this.pool, user, mode));
      }
      if (req.method === "POST" && path === "/auth/whatsapp/request") {
        this.mode(req);
        const input = z.object({ phone }).strict().parse(body);
        await this.rate(req, input.phone, "otp-request", 3);
        let reference: string;
        try {
          reference = await this.provider.start(input.phone);
        } catch {
          throw new AuthError(503, "WHATSAPP_NOT_AVAILABLE");
        }
        const id = randomUUID(),
          expires = new Date(this.clock() + 300000);
        const challenge = (
          await this.pool.query(
            "INSERT INTO otp_challenges(id,phone,provider_reference,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(provider_reference) DO UPDATE SET provider_reference=excluded.provider_reference RETURNING id,expires_at",
            [id, input.phone, reference, expires],
          )
        ).rows[0];
        return res.json({
          challengeId: challenge.id,
          expiresAt: new Date(challenge.expires_at).toISOString(),
        });
      }
      if (req.method === "POST" && path === "/auth/whatsapp/verify") {
        const mode = this.mode(req),
          input = z
            .object({
              challengeId: z.uuid(),
              code: z.string().regex(/^\d{4,10}$/),
            })
            .strict()
            .parse(body);
        await this.rate(req, input.challengeId, "otp-check", 5);
        const db = await this.pool.connect();
        try {
          await db.query("BEGIN");
          const c = (
            await db.query(
              "SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE",
              [input.challengeId],
            )
          ).rows[0];
          if (
            !c ||
            c.consumed_at ||
            c.attempts >= 5 ||
            new Date(c.expires_at).getTime() <= this.clock()
          )
            throw new AuthError(401, "INVALID_CODE");
          await db.query(
            "UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1",
            [c.id],
          );
          let valid = false;
          try {
            valid = await this.provider.check(c.provider_reference, input.code);
          } catch {
            await db.query("COMMIT");
            throw new AuthError(503, "WHATSAPP_NOT_AVAILABLE");
          }
          if (!valid) {
            await db.query("COMMIT");
            throw new AuthError(401, "INVALID_CODE");
          }
          await db.query(
            "UPDATE otp_challenges SET consumed_at=$2 WHERE id=$1",
            [c.id, new Date(this.clock())],
          );
          await db.query(
            "INSERT INTO app_users(id,phone,role) VALUES($1,$2,'buyer') ON CONFLICT(phone) DO NOTHING",
            [randomUUID(), c.phone],
          );
          const user = (
            await db.query(
              "SELECT * FROM app_users WHERE phone=$1 FOR UPDATE",
              [c.phone],
            )
          ).rows[0];
          if (!user?.active || user.role !== "buyer") {
            await db.query("COMMIT");
            throw new AuthError(401, "INVALID_CODE");
          }
          const result = await this.issue(db, user, mode);
          await db.query("COMMIT");
          return this.respond(res, mode, result);
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      if (
        req.method === "POST" &&
        (path === "/auth/refresh" || path === "/auth/logout")
      ) {
        const mode = this.mode(req),
          token =
            mode === "native"
              ? z
                  .object({ refreshToken: z.string().min(32).max(200) })
                  .strict()
                  .parse(body).refreshToken
              : this.cookies(req).playita_refresh;
        if (!token) throw new AuthError(401, "AUTH_REQUIRED");
        const db = await this.pool.connect();
        try {
          await db.query("BEGIN");
          const row = (
            await db.query(
              "SELECT s.*,u.role,u.active,u.email,u.phone,u.is_guest FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE refresh_hash=$1 AND client_type=$2 FOR UPDATE OF s",
              [digest(token), mode],
            )
          ).rows[0];
          if (!row) throw new AuthError(401, "AUTH_REQUIRED");
          if (mode === "web") this.csrf(req, row.csrf_hash);
          if (path === "/auth/logout") {
            await this.revokeFamily(db, row.family_id);
            await db.query("COMMIT");
            this.clear(res);
            return res.json({ ok: true });
          }
          if (row.rotated_at || row.revoked_at) {
            await this.revokeFamily(db, row.family_id);
            await db.query("COMMIT");
            this.clear(res);
            throw new AuthError(401, "SESSION_REUSED");
          }
          if (
            !row.active ||
            new Date(row.refresh_expires_at).getTime() <= this.clock() ||
            new Date(row.absolute_expires_at).getTime() <= this.clock()
          ) {
            await this.revokeFamily(db, row.family_id);
            await db.query("COMMIT");
            this.clear(res);
            throw new AuthError(401, "SESSION_EXPIRED");
          }
          await db.query("UPDATE auth_sessions SET rotated_at=$2 WHERE id=$1", [
            row.id,
            new Date(this.clock()),
          ]);
          const result = await this.issue(
            db,
            {
              id: row.user_id,
              role: row.role,
              email: row.email,
              phone: row.phone,
              is_guest: row.is_guest,
            },
            mode,
            row.family_id,
            new Date(row.absolute_expires_at).getTime(),
          );
          await db.query("COMMIT");
          return this.respond(res, mode, result);
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      if (req.method === "GET" && path === "/auth/customers") {
        const s = await this.protect(req);
        if (s.actor.role !== "admin") throw new AuthError(403, "FORBIDDEN");
        return res.json(
          (
            await this.pool.query(
              "SELECT id,email,phone,active,created_at AS \"createdAt\" FROM app_users WHERE role='buyer' AND NOT is_guest ORDER BY created_at",
            )
          ).rows,
        );
      }
      if (req.method === "POST" && path === "/auth/users/assign-role") {
        const s = await this.protect(req);
        if (s.actor.role !== "admin") throw new AuthError(403, "FORBIDDEN");
        const input = z
          .object({ email, role: z.enum(["admin", "seller", "buyer"]) })
          .strict()
          .parse(body);
        const db = await this.pool.connect();
        try {
          await db.query("BEGIN");
          await db.query("SELECT pg_advisory_xact_lock(77332003)");
          const existing = (
            await db.query(
              "SELECT * FROM app_users WHERE email=$1 FOR UPDATE",
              [input.email],
            )
          ).rows[0];
          if (existing?.role === "admin" && input.role !== "admin") {
            if (existing.id === s.actor.id)
              throw new AuthError(409, "CANNOT_CHANGE_SELF_ROLE");
            if (
              (
                await db.query(
                  "SELECT id FROM app_users WHERE role='admin' AND active",
                )
              ).rowCount! <= 1
            )
              throw new AuthError(409, "LAST_ADMIN");
          }
          if (existing && !existing.active)
            throw new AuthError(409, "ACCOUNT_INACTIVE");
          const user = existing
            ? (
                await db.query(
                  "UPDATE app_users SET role=$2 WHERE id=$1 RETURNING id,email,role,active",
                  [existing.id, input.role],
                )
              ).rows[0]
            : (
                await db.query(
                  "INSERT INTO app_users(id,email,role) VALUES($1,$2,$3) RETURNING id,email,role,active",
                  [randomUUID(), input.email, input.role],
                )
              ).rows[0];
          if (existing && existing.role !== input.role) {
            const families = (
              await db.query(
                "SELECT DISTINCT family_id FROM auth_sessions WHERE user_id=$1",
                [existing.id],
              )
            ).rows;
            for (const f of families) await this.revokeFamily(db, f.family_id);
          }
          await db.query(
            "INSERT INTO inventory_audit(actor_id,kind,entity_id,before_data,after_data,reason) VALUES($1,'account.role',$2,$3,$4,'Asignación de rol por administrador')",
            [
              s.actor.id,
              user.id,
              existing ? JSON.stringify({ role: existing.role }) : null,
              JSON.stringify({ role: user.role }),
            ],
          );
          await db.query("COMMIT");
          return res.status(existing ? 200 : 201).json(user);
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      if (path === "/auth/users" && ["GET", "POST"].includes(req.method)) {
        const s = await this.protect(req);
        if (s.actor.role !== "admin") throw new AuthError(403, "FORBIDDEN");
        if (req.method === "GET")
          return res.json(
            (
              await this.pool.query(
                "SELECT id,email,role,active FROM app_users WHERE role IN ('admin','seller') ORDER BY created_at",
              )
            ).rows,
          );
        const input = z
          .object({ email, password, role: z.enum(["admin", "seller"]) })
          .strict()
          .parse(body);
        const encoded = await hashPassword(input.password);
        try {
          const user = (
            await this.pool.query(
              "INSERT INTO app_users(id,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,role,active",
              [randomUUID(), input.email, encoded, input.role],
            )
          ).rows[0];
          return res.status(201).json(user);
        } catch (e: any) {
          if (e.code === "23505")
            throw new AuthError(409, "ACCOUNT_UNAVAILABLE");
          throw e;
        }
      }
      if (
        req.method === "POST" &&
        /^\/auth\/users\/[^/]+\/disable$/.test(path)
      ) {
        const s = await this.protect(req);
        if (s.actor.role !== "admin") throw new AuthError(403, "FORBIDDEN");
        const id = z.uuid().parse(path.split("/")[3]);
        if (id === s.actor.id) throw new AuthError(409, "CANNOT_DISABLE_SELF");
        const db = await this.pool.connect();
        try {
          await db.query("BEGIN");
          await db.query("SELECT pg_advisory_xact_lock(77332003)");
          const user = (
            await db.query("SELECT * FROM app_users WHERE id=$1 FOR UPDATE", [
              id,
            ])
          ).rows[0];
          if (!user || user.role === "buyer")
            throw new AuthError(404, "NOT_FOUND");
          if (
            user.role === "admin" &&
            (
              await db.query(
                "SELECT id FROM app_users WHERE role='admin' AND active",
              )
            ).rowCount! <= 1
          )
            throw new AuthError(409, "LAST_ADMIN");
          await db.query("UPDATE app_users SET active=false WHERE id=$1", [id]);
          const families = (
            await db.query(
              "SELECT DISTINCT family_id FROM auth_sessions WHERE user_id=$1",
              [id],
            )
          ).rows;
          for (const f of families) await this.revokeFamily(db, f.family_id);
          await db.query("COMMIT");
          return res.json({ ok: true });
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      return res.status(404).json({ code: "NOT_FOUND" });
    } catch (e) {
      if (e instanceof AuthError)
        return res.status(e.status).json({
          code: e.code,
          message:
            e.status === 401 ? "No fue posible verificar el acceso." : e.code,
        });
      if (e instanceof z.ZodError)
        return res.status(400).json({ code: "INVALID_INPUT" });
      return res.status(500).json({ code: "AUTH_UNAVAILABLE" });
    }
  }
}
export async function bootstrapAdmin(
  pool: Pool,
  emailAddress: string,
  pass: string,
  options: { onlyIfMissing?: boolean } = {},
) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(77332003)");
    if (
      (await db.query("SELECT 1 FROM app_users WHERE role='admin'")).rowCount
    ) {
      if (options.onlyIfMissing) {
        await db.query("COMMIT");
        return false;
      }
      throw Error(
        "Primer administrador ya provisionado; usar gestión autorizada",
      );
    }
    const input = z
      .object({ email, password })
      .parse({ email: emailAddress, password: pass });
    await db.query(
      "INSERT INTO app_users(id,email,password_hash,role) VALUES($1,$2,$3,'admin')",
      [randomUUID(), input.email, await hashPassword(input.password)],
    );
    await db.query("COMMIT");
    return true;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
