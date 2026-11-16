import {
  accountSaveError,
  OpeningBalanceFields,
  openingPayload,
  type OpeningInfo,
} from "./opening-balance.js";
import { LoadingMark } from "./ui.js";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import { Input, Select, Button } from "./material.js";
import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { auth, useSession } from "./session.js";
type Staff = {
  id: string;
  email: string;
  role: string;
  active: boolean;
  creditEnabled: boolean;
  openingBalance?: OpeningInfo | null;
};
export function StaffUsers({ embedded = false }: { embedded?: boolean }) {
  const session = useSession()!,
    [users, setUsers] = useState<Staff[]>([]),
    [email, setEmail] = useState(""),
    [role, setRole] = useState("seller"),
    [creditEnabled, setCreditEnabled] = useState(false),
    [openingAmount, setOpeningAmount] = useState(""),
    [openingNote, setOpeningNote] = useState(
      "Deuda previa al uso de la aplicación",
    ),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      const r = await auth.request("/auth/users");
      if (!r.ok) throw Error("No autorizado");
      setUsers(await r.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load().catch(() =>
      setMessage("No fue posible consultar el personal."),
    );
  }, []);
  const existingOpening = users.find(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
  )?.openingBalance;
  return (
    <section className="staff-users">
      {!embedded && <Link to="/app">← Volver a tienda</Link>}
      <h2>Cuentas y roles</h2>
      <p>
        Asigna un correo y su rol. La persona ingresará con su cuenta de Google.
      </p>
      <section className="panel">
        <h2>Crear o editar cuenta</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              try {
                const r = await auth.request("/auth/users/assign-role", {
                  method: "POST",
                  body: JSON.stringify({
                    email,
                    role,
                    creditEnabled,
                    ...openingPayload(
                      creditEnabled,
                      existingOpening,
                      openingAmount,
                      openingNote,
                    ),
                  }),
                });
                if (!r.ok) throw Error((await r.json()).code || "");
                setEmail("");
                setOpeningAmount("");
                setOpeningNote("Deuda previa al uso de la aplicación");
                window.dispatchEvent(
                  new window.Event("playita:accounts-changed"),
                );
                setCreditEnabled(false);
                setMessage(
                  "Cuenta guardada. El rol y el permiso de crédito están actualizados.",
                );
                await load();
              } catch (e: any) {
                setMessage(accountSaveError(String(e.message)));
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
          <label className="check">
            <Input
              type="checkbox"
              checked={creditEnabled}
              onChange={(e) => setCreditEnabled(e.target.checked)}
            />
            Permitir compras a crédito
          </label>
          <OpeningBalanceFields
            enabled={creditEnabled}
            existing={existingOpening}
            amount={openingAmount}
            note={openingNote}
            onAmount={setOpeningAmount}
            onNote={setOpeningNote}
          />
          <Button>Guardar cuenta</Button>
        </form>
      </section>
      <section className="panel">
        <h2>Cuentas</h2>
        {loading && <LoadingMark label="Consultando cuentas…" />}
        <List disablePadding>
          {[...users]
            .sort((a, b) => a.email.localeCompare(b.email, "es"))
            .map((u) => (
              <ListItem
                disableGutters
                className="row compact-account"
                key={u.id}
              >
                <span>
                  <strong>{u.email}</strong>
                  <small>
                    {{
                      admin: "Administrador",
                      seller: "Vendedor",
                      buyer: "Comprador",
                    }[u.role] || u.role}{" "}
                    · {u.active ? "Activa" : "Desactivada"} ·{" "}
                    {u.creditEnabled ? "Con crédito" : "Sin crédito"}
                  </small>
                </span>
                <div className="compact-account-actions">
                  <Button
                    tone="secondary"
                    type="button"
                    onClick={() => {
                      setOpeningAmount("");
                      setOpeningNote("Deuda previa al uso de la aplicación");
                      setEmail(u.email);
                      setRole(u.role);
                      setCreditEnabled(!!u.creditEnabled);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    tone="error"
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
                </div>
              </ListItem>
            ))}
        </List>
      </section>
      <p role="status">{message}</p>
    </section>
  );
}
