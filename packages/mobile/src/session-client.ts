import type { SecretVault } from "./vault.js";
import type { Role, OrderDraft } from "@playita/shared";
import type { Transport } from "./outbox.js";
export type User = { id: string; role: Role; label: string; guest: boolean };
export type Session = {
  actor: User;
  accessExpiresAt: number;
  mode: "authenticated" | "offline";
};
export class SessionError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export class SessionClient {
  current: Session | null = null;
  private access = "";
  private refreshing: Promise<Session> | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private vaultQueue: Promise<unknown> = Promise.resolve();
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.vaultQueue.then(fn, fn);
    this.vaultQueue = task.catch(() => {});
    return task;
  }
  constructor(
    private config: {
      base: string;
      mode: "web" | "native";
      vault?: SecretVault;
      fetch?: typeof fetch;
      restoreTimeoutMs?: number;
      csrf?: () => string;
      lock?: <T>(fn: () => Promise<T>) => Promise<T>;
      intent?: { get(): boolean; set(value: boolean): void };
    },
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(session: Session | null) {
    this.current = session;
    for (const fn of this.listeners) fn();
  }
  private async raw(path: string, body?: unknown, access = false) {
    const response = await (this.config.fetch || fetch)(
      this.config.base + path,
      {
        method: body === undefined ? "GET" : "POST",
        credentials: this.config.mode === "web" ? "include" : "omit",
        headers: {
          "Content-Type": "application/json",
          "X-Playita-Client": this.config.mode,
          ...(this.config.mode === "web"
            ? { "X-CSRF-Token": this.config.csrf?.() || "" }
            : access
              ? { Authorization: "Bearer " + this.access }
              : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new SessionError(response.status, data.code || "AUTH_REQUIRED");
    return data;
  }
  private async accept(
    data: {
      actor: User;
      accessExpiresAt: number;
      accessToken?: string;
      refreshToken?: string;
    },
    generation: number,
  ) {
    if (generation !== this.generation)
      throw new SessionError(401, "SESSION_CHANGED");
    if (this.config.mode === "native") {
      if (!this.config.vault || !data.accessToken || !data.refreshToken)
        throw Error("Secure vault required");
      await this.locked(async () => {
        if (generation !== this.generation)
          throw new SessionError(401, "SESSION_CHANGED");
        await this.config.vault!.set(
          "session",
          JSON.stringify({
            actor: data.actor,
            refreshToken: data.refreshToken,
          }),
        );
      });
      if (generation !== this.generation)
        throw new SessionError(401, "SESSION_CHANGED");
      this.access = data.accessToken;
    }
    this.config.intent?.set(false);
    this.set({
      actor: data.actor,
      accessExpiresAt: data.accessExpiresAt,
      mode: "authenticated",
    });
    return this.current!;
  }
  async login(email: string, password: string) {
    await this.flushLogout();
    if (this.config.mode === "web" && this.config.intent?.get())
      throw new SessionError(503, "LOGOUT_PENDING");
    const generation = ++this.generation;
    const data = await this.raw("/auth/login", { email, password });
    return this.accept(data, generation);
  }
  async googleOptions(): Promise<{ available: boolean; clientId?: string }> {
    return (await this.raw("/auth/options")).google ?? { available: false };
  }
  async google(
    getCredential: (challenge: {
      challengeId: string;
      nonce: string;
      clientId: string;
      proof?: string;
    }) => Promise<string>,
  ) {
    await this.flushLogout();
    if (this.config.mode === "web" && this.config.intent?.get())
      throw new SessionError(503, "LOGOUT_PENDING");
    const generation = ++this.generation;
    const challenge = await this.raw("/auth/google/challenge", {});
    const credential = await getCredential(challenge);
    if (generation !== this.generation)
      throw new SessionError(401, "SESSION_CHANGED");
    const data = await this.raw("/auth/google/verify", {
      challengeId: challenge.challengeId,
      credential,
      ...(challenge.proof ? { proof: challenge.proof } : {}),
    });
    return this.accept(data, generation);
  }
  async guest() {
    await this.flushLogout();
    if (this.config.mode === "web" && this.config.intent?.get())
      throw new SessionError(503, "LOGOUT_PENDING");
    const generation = ++this.generation;
    const data = await this.raw("/auth/guest", {});
    return this.accept(data, generation);
  }
  async restore() {
    const generation = this.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new SessionError(503, "RESTORE_TIMEOUT")),
        this.config.restoreTimeoutMs ?? 15000,
      );
    });
    try {
      return await Promise.race([this.restoreInner(generation), timeout]);
    } catch (e) {
      if (
        e instanceof SessionError &&
        e.code === "RESTORE_TIMEOUT" &&
        generation === this.generation
      ) {
        this.generation++;
        this.refreshing = null;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  private async restoreInner(generation: number) {
    const ensure = () => {
      if (generation !== this.generation)
        throw new SessionError(401, "SESSION_CHANGED");
    };
    await this.flushLogout();
    ensure();
    if (this.config.mode === "web" && this.config.intent?.get()) return null;
    if (this.config.mode === "native") {
      const record = await this.saved();
      ensure();
      if (!record) return null;
      try {
        return await this.refresh();
      } catch (e) {
        ensure();
        this.access = "";
        if (e instanceof SessionError) {
          await this.config.vault!.set(
            "session",
            JSON.stringify({ actor: record.actor }),
          );
        }
        this.set({ actor: record.actor, accessExpiresAt: 0, mode: "offline" });
        return this.current;
      }
    }
    try {
      const data = await this.raw("/auth/me");
      ensure();
      this.set({ ...data, mode: "authenticated" });
      return this.current;
    } catch (e) {
      if (e instanceof SessionError && e.status === 401) {
        try {
          return await this.refresh();
        } catch {
          return null;
        }
      }
      return null;
    }
  }
  private async saved(): Promise<{
    actor: User;
    refreshToken?: string;
  } | null> {
    const value = await this.locked(async () =>
      this.config.vault?.get("session"),
    );
    return value ? JSON.parse(value) : null;
  }
  async refresh(): Promise<Session> {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    const fn = async () => {
      const saved = await this.saved();
      if (this.config.mode === "native" && !saved?.refreshToken)
        throw new SessionError(401, "REAUTHENTICATION_REQUIRED");
      const data = await this.raw(
        "/auth/refresh",
        this.config.mode === "native"
          ? { refreshToken: saved!.refreshToken }
          : {},
      );
      if (this.current && data.actor.id !== this.current.actor.id)
        throw new SessionError(401, "ACCOUNT_MISMATCH");
      return this.accept(data, generation);
    };
    const pending = (this.config.lock ? this.config.lock(fn) : fn())
      .catch((e) => {
        if (generation === this.generation && e instanceof SessionError) {
          this.access = "";
          this.set(
            this.config.mode === "native" && this.current
              ? { ...this.current, mode: "offline", accessExpiresAt: 0 }
              : null,
          );
        }
        throw e;
      })
      .finally(() => {
        if (this.refreshing === pending) this.refreshing = null;
      });
    this.refreshing = pending;
    return pending;
  }
  async request(path: string, init: RequestInit = {}, expectedOwner?: string) {
    const generation = this.generation,
      owner = expectedOwner || this.current?.actor.id;
    if (!owner || this.current?.actor.id !== owner)
      throw new SessionError(401, "ACCOUNT_MISMATCH");
    if (
      this.current.mode !== "authenticated" ||
      this.current.accessExpiresAt <= Date.now() + 1000
    )
      await this.refresh();
    if (generation !== this.generation || this.current?.actor.id !== owner)
      throw new SessionError(401, "ACCOUNT_MISMATCH");
    const run = () =>
      (this.config.fetch || fetch)(this.config.base + path, {
        ...init,
        credentials: this.config.mode === "web" ? "include" : "omit",
        headers: {
          "Content-Type": "application/json",
          "X-Playita-Client": this.config.mode,
          ...(this.config.mode === "native"
            ? { Authorization: "Bearer " + this.access }
            : { "X-CSRF-Token": this.config.csrf?.() || "" }),
          ...init.headers,
        },
        signal: AbortSignal.timeout(10000),
      });
    let response = await run();
    if (response.status === 401) {
      await this.refresh();
      if (generation !== this.generation || this.current?.actor.id !== owner)
        throw new SessionError(401, "ACCOUNT_MISMATCH");
      response = await run();
    }
    return response;
  }
  transport(owner: string): Transport {
    return async (key: string, draft: OrderDraft) => {
      try {
        const response = await this.request(
          "/orders",
          {
            method: "POST",
            headers: { "Idempotency-Key": key },
            body: JSON.stringify(draft),
          },
          owner,
        );
        return { status: response.status, body: await response.json() };
      } catch (e) {
        if (e instanceof SessionError)
          return { status: e.status, body: { code: e.code } };
        throw e;
      }
    };
  }
  async socketCredentials(owner: string) {
    if (this.current?.actor.id !== owner)
      throw new SessionError(401, "ACCOUNT_MISMATCH");
    if (
      this.current.mode !== "authenticated" ||
      this.current.accessExpiresAt <= Date.now() + 1000
    )
      await this.refresh();
    return this.config.mode === "native" ? { accessToken: this.access } : {};
  }
  async logout() {
    const generation = ++this.generation;
    const saved = await this.saved();
    this.access = "";
    this.set(null);
    if (this.config.mode === "web") this.config.intent?.set(true);
    try {
      await this.raw(
        "/auth/logout",
        this.config.mode === "native"
          ? { refreshToken: saved?.refreshToken || "" }
          : {},
      );
      this.config.intent?.set(false);
    } catch {
      if (this.config.mode === "native" && saved?.refreshToken) {
        const pending = JSON.parse(
          (await this.config.vault!.get("logout_pending")) || "[]",
        ) as string[];
        await this.config.vault!.set(
          "logout_pending",
          JSON.stringify([...new Set([...pending, saved.refreshToken])]),
        );
      }
    } finally {
      if (this.config.mode === "native" && generation === this.generation)
        await this.locked(() => this.config.vault!.remove("session"));
    }
  }
  async flushLogout() {
    if (this.config.mode === "web") {
      if (this.config.intent?.get()) {
        try {
          await this.raw("/auth/logout", {});
          this.config.intent.set(false);
        } catch (e) {
          if (e instanceof SessionError && e.status === 401)
            this.config.intent.set(false);
        }
      }
      return;
    }
    const pending = JSON.parse(
        (await this.config.vault?.get("logout_pending")) || "[]",
      ) as string[],
      remaining: string[] = [];
    if (!pending.length) return;
    remaining.push(...pending.slice(3));
    await Promise.all(
      pending.slice(0, 3).map(async (refreshToken) => {
        try {
          await this.raw("/auth/logout", { refreshToken });
        } catch (e) {
          if (!(e instanceof SessionError && e.status === 401))
            remaining.push(refreshToken);
        }
      }),
    );
    if (this.config.vault)
      await this.config.vault.set("logout_pending", JSON.stringify(remaining));
  }
}
