import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { auth, useSession } from "./session.js";
type Staff = { id: string; email: string; role: string; active: boolean };
export function StaffUsers({ embedded = false }: { embedded?: boolean }) {
  const session = useSession()!,
    [users, setUsers] = useState<Staff[]>([]),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState("seller"),
    [message, setMessage] = useState("");
  async function load() {
    const r = await auth.request("/auth/users");
    if (!r.ok) throw Error("No autorizado");
    setUsers(await r.json());
  }
  useEffect(() => {
    void load().catch(() =>
      setMessage("No fue posible consultar el personal."),
    );
  }, []);
  return (
    <section className="staff-users">
      {!embedded && <Link to="/app">← Volver a tienda</Link>}
      <h2>Personal de la tienda</h2>
      <p>Solo administrador. No hay registro público de personal.</p>
      <section className="panel">
        <h2>Crear cuenta</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                const r = await auth.request("/auth/users", {
                  method: "POST",
                  body: JSON.stringify({ email, password, role }),
                });
                if (!r.ok) throw Error();
                setPassword("");
                setEmail("");
                setMessage(
                  "Cuenta creada. Entrega su contraseña por un canal privado apropiado; no se registra en logs.",
                );
                await load();
              } catch {
                setMessage(
                  "No fue posible crear la cuenta. Revisa datos y permisos.",
                );
              }
            })();
          }}
        >
          <label>
            Correo
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Contraseña inicial (mínimo 12 caracteres)
            <input
              type="password"
              minLength={12}
              maxLength={128}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            Rol
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="seller">Vendedor</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button>Crear cuenta</button>
        </form>
      </section>
      <section className="panel">
        <h2>Cuentas</h2>
        {users.map((u) => (
          <div className="row" key={u.id}>
            <span>
              {u.email}
              <small>
                {u.role} · {u.active ? "Activa" : "Desactivada"}
              </small>
            </span>
            <button
              disabled={!u.active || u.id === session.actor.id}
              onClick={() => {
                void (async () => {
                  const r = await auth.request(`/auth/users/${u.id}/disable`, {
                    method: "POST",
                    body: "{}",
                  });
                  setMessage(
                    r.ok
                      ? "Cuenta desactivada y sesiones revocadas."
                      : "No se pudo desactivar la cuenta.",
                  );
                  await load();
                })().catch(() =>
                  setMessage("No se pudo actualizar la cuenta."),
                );
              }}
            >
              Desactivar
            </button>
          </div>
        ))}
      </section>
      <p role="status">{message}</p>
    </section>
  );
}
