import React from "react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { auth, useSession } from "./session.js";
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
    } catch {
      setError(
        "No fue posible iniciar sesión. Revisa tus datos o la conexión e inténtalo de nuevo.",
      );
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
        <button disabled title="Integración OIDC pendiente">
          Continuar con Google · próximamente
        </button>
        <button disabled title="Integración OIDC pendiente">
          Continuar con Apple · próximamente
        </button>
        <small>
          Opciones preparadas, todavía no conectadas. No leemos Gmail ni tomamos
          datos de la cuenta del dispositivo.
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
          <button disabled={busy}>Ingresar</button>
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
