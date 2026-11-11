import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("React DOM: acceso, invitado/social deshabilitado, rutas protegidas y alta staff solo admin", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://127.0.0.1:5173/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    sessionStorage: dom.window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react");
  const { MemoryRouter, Routes, Route } = await import("react-router-dom");
  const { render, fireEvent, waitFor, cleanup, act } =
    await import("@testing-library/react");
  const { Login, Protected } = await import("../apps/web/src/login.js");
  const { StaffUsers } = await import("../apps/web/src/staff.js");
  const { auth } = await import("../apps/web/src/session.js");
  const original = globalThis.fetch;
  let role: "buyer" | "admin" = "buyer";
  const requests: Array<{ path: string; body: any }> = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    requests.push({
      path,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path.endsWith("/auth/guest") || path.endsWith("/auth/login"))
      return Response.json({
        actor: {
          id: role + "-a",
          role,
          label: "Local user",
          guest: role === "buyer",
        },
        accessExpiresAt: Date.now() + 300000,
      });
    if (path.endsWith("/auth/users"))
      return init?.method === "POST"
        ? Response.json(
            { id: "new", role: requests.at(-1)!.body.role },
            { status: 201 },
          )
        : Response.json([]);
    return Response.json({ ok: true });
  };
  try {
    let view = render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin"
            element={
              <Protected admin>
                <StaffUsers />
              </Protected>
            }
          />
          <Route path="/app" element={<p>Buyer route</p>} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>,
    );
    assert.ok(view.getByText("Continuar como invitado"));
    assert.equal(
      (
        view.getByRole("button", {
          name: "Acceder con Google",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    assert.equal(view.queryByText(/Continuar con Apple/), null);
    fireEvent.click(view.getByText("Continuar como invitado"));
    await waitFor(() => assert.ok(auth.current));
    assert.equal(
      requests.find((r) => r.path.endsWith("/auth/guest"))!.body.role,
      undefined,
    );
    cleanup();
    view = render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route
            path="/admin"
            element={
              <Protected admin>
                <StaffUsers />
              </Protected>
            }
          />
          <Route path="/app" element={<p>Buyer route</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => assert.ok(view.getByText("Buyer route")));
    cleanup();
    await act(async () => {
      await auth.logout();
      role = "admin";
      await auth.login("admin@example.invalid", "only-ui-test-password");
    });
    view = render(
      <MemoryRouter>
        <Protected admin>
          <StaffUsers />
        </Protected>
      </MemoryRouter>,
    );
    await waitFor(() =>
      assert.ok(view.getByRole("button", { name: "Crear cuenta" })),
    );
    fireEvent.change(view.getByLabelText("Correo"), {
      target: { value: "staff@example.invalid" },
    });
    fireEvent.change(view.getByLabelText(/Contraseña inicial/), {
      target: { value: "only-ui-test-password" },
    });
    fireEvent.change(view.getByLabelText("Rol"), {
      target: { value: "seller" },
    });
    fireEvent.submit(
      view.getByRole("button", { name: "Crear cuenta" }).closest("form")!,
    );
    await waitFor(() =>
      assert.ok(
        requests.some(
          (r) => r.path.endsWith("/auth/users") && r.body?.role === "seller",
        ),
      ),
    );
    assert.equal(
      (view.getByLabelText(/Contraseña inicial/) as HTMLInputElement).value,
      "",
    );
    cleanup();
    await act(async () => {
      await auth.logout();
    });
  } finally {
    cleanup();
    globalThis.fetch = original;
    dom.window.close();
  }
});
