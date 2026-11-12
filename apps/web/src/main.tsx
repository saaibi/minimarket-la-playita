import { Button } from "./material.js";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { auth, backendConfigured } from "./session.js";
import { Login, Protected } from "./login.js";
import { StaffUsers } from "./staff.js";
import { Shop } from "./shop.js";
import "./style.css";
import { AppAppearance } from "./material.js";
function Root() {
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!backendConfigured) return;
    setReady(false);
    setFailed(false);
    let active = true;
    void auth
      .restore()
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (!backendConfigured)
    return (
      <main>
        <article>
          <h1>Minimarket La Playita</h1>
          <p>Versión de prueba Android · 0.2.0</p>
          <h2>API de pruebas no configurada</h2>
          <p>
            La aplicación está instalada. Para iniciar sesión, consultar
            inventario y enviar pedidos necesita una API HTTPS disponible.
          </p>
          <p>
            Esta compilación no incluye datos de demostración ni confirma
            pedidos sin conexión. El acceso estará disponible en una nueva
            compilación con la API configurada.
          </p>
        </article>
      </main>
    );
  if (failed)
    return (
      <main className="login-page">
        <img
          className="brand-logo"
          src="/assets/marca.png"
          alt="Minimarket La Playita"
        />
        <section className="panel">
          <h1>No pudimos recuperar tu sesión</h1>
          <p>
            La conexión o el almacenamiento seguro no respondió a tiempo. Tus
            pedidos guardados no se han borrado.
          </p>
          <Button className="primary" onClick={() => setAttempt((n) => n + 1)}>
            Reintentar conexión
          </Button>
          <Button onClick={() => setFailed(false)}>Ir al acceso</Button>
        </section>
      </main>
    );
  if (!ready)
    return (
      <main>
        <p role="status">Comprobando sesión…</p>
      </main>
    );
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/app/*"
          element={
            <Protected>
              <Shop />
            </Protected>
          }
        />
        <Route
          path="/admin/users"
          element={
            <Protected admin>
              <StaffUsers />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
createRoot(document.getElementById("root")!).render(
  <AppAppearance>
    <Root />
  </AppAppearance>,
);
