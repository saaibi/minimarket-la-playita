import React from "react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { auth, useSession } from "./session.js";
import { SessionError } from "@playita/mobile";
import { GoogleLogin } from "./google-login.js";
import { Brand } from "./ui.js";
export function Login() {
  const session = useSession(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (session) return <Navigate to="/app" replace />;
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setPassword("");
    } catch (error) {
      setError(loginErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <Brand />
        <p className="eyebrow">CERCA DE TI, CADA DÍA</p>
      </div>
      <section className="intro">
        <p className="eyebrow">BIENVENIDO A LA PLAYITA</p>
        <h1>Bienvenido a tu tienda.</h1>
        <p>
          Compra para recoger. Puedes entrar como invitado sin crear una cuenta.
        </p>
      </section>
      <section className="panel">
        <h2>Comprar</h2>
        <button disabled={busy} onClick={() => void act(() => auth.guest())}>
          Continuar como invitado
        </button>
        <small>
          La primera entrada requiere conexión. La sesión invitada pertenece a
          este navegador o app; no permite recuperar pedidos desde otro
          dispositivo.
        </small>
        <GoogleLogin disabled={busy} onBusy={setBusy} />
        <small>
          Google solo se usa para identificarte. No solicitamos acceso a Gmail
          ni a tus contactos.
        </small>
      </section>
      <section className="panel">
        <h2>Personal de la tienda</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => auth.login(email, password));
          }}
        >
          <label>
            Correo
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={128}
            />
          </label>
          <button disabled={busy}>{busy ? "Conectando…" : "Ingresar"}</button>
          {busy && (
            <p role="status">
              La primera conexión puede tardar alrededor de un minuto mientras
              despierta el servidor.
            </p>
          )}
        </form>
        <small>
          Administradores y vendedores creados por un administrador.
          Recuperación de contraseña pendiente.
        </small>
      </section>
      <p role="alert" className="status">
        {error}
      </p>
    </main>
  );
}
export function Protected({
  children,
  admin = false,
}: {
  children: React.ReactNode;
  admin?: boolean;
}) {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (
    admin &&
    (session.actor.role !== "admin" || session.mode !== "authenticated")
  )
    return <Navigate to="/app" replace />;
  return children;
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("NATIVE_STORAGE_"))
    return "No se pudo leer la sesión segura del dispositivo. Cierra y vuelve a abrir la app, sin borrar sus datos.";
  if (error instanceof SessionError) {
    if (error.code === "SESSION_STORAGE_UNAVAILABLE")
      return "El acceso fue validado, pero no se pudo guardar la sesión segura en este dispositivo. Cierra y vuelve a abrir la app sin borrar sus datos.";
    if (error.code === "NETWORK_UNAVAILABLE")
      return "No se pudo conectar con la tienda. Revisa la conexión del teléfono y vuelve a intentar.";
    if (error.code === "REQUEST_TIMEOUT")
      return "La tienda tardó demasiado en responder. Espera unos segundos y vuelve a intentar; el servidor puede estar despertando.";
    if (error.status === 401)
      return "El correo o la contraseña no coinciden. Usa los mismos datos de tu cuenta del personal.";
    if (error.status === 429)
      return "Hay demasiados intentos de acceso. Espera unos minutos antes de reintentar.";
    if (error.status >= 500)
      return "El servicio de acceso no está disponible en este momento. Vuelve a intentar en unos segundos.";
  }
  return "No fue posible completar el acceso en este dispositivo. Cierra y vuelve a abrir la app, sin borrar sus datos.";
}
