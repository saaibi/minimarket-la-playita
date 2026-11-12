import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import { Input, Select, Button } from "./material.js";
import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { auth, useSession } from "./session.js";
type Staff = { id: string; email: string; role: string; active: boolean };
export function StaffUsers({ embedded = false }: { embedded?: boolean }) {
  const session = useSession()!,
    [users, setUsers] = useState<Staff[]>([]),
    [email, setEmail] = useState(""),
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
      <h2>Cuentas y roles</h2>
      <p>
        Asigna un correo y su rol. La persona ingresará con su cuenta de Google.
      </p>
      <section className="panel">
        <h2>Asignar rol</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                const r = await auth.request("/auth/users/assign-role", {
                  method: "POST",
                  body: JSON.stringify({ email, role }),
                });
                if (!r.ok) throw Error();
                setEmail("");
                setMessage("Rol guardado. Se aplicará al ingresar con Google.");
                await load();
              } catch {
                setMessage(
                  "No fue posible guardar el rol. Revisa el correo y los permisos.",
                );
              }
            })();
          }}
        >
          <label>
            Correo
            <Input
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Rol
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="seller">Vendedor</option>
              <option value="admin">Administrador</option>
              <option value="buyer">Comprador</option>
            </Select>
          </label>
          <Button>Guardar rol</Button>
        </form>
      </section>
      <section className="panel">
        <h2>Cuentas</h2>
        <List disablePadding>
          {users.map((u) => (
            <ListItem disableGutters className="row" key={u.id}>
              <span>
                {u.email}
                <small>
                  {u.role} · {u.active ? "Activa" : "Desactivada"}
                </small>
              </span>
              <Button
                type="button"
                onClick={() => {
                  setEmail(u.email);
                  setRole(u.role);
                }}
              >
                Cambiar rol
              </Button>
              <Button
                disabled={!u.active || u.id === session.actor.id}
                onClick={() => {
                  void (async () => {
                    const r = await auth.request(
                      `/auth/users/${u.id}/disable`,
                      {
                        method: "POST",
                        body: "{}",
                      },
                    );
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
              </Button>
            </ListItem>
          ))}
        </List>
      </section>
      <p role="status">{message}</p>
    </section>
  );
}
