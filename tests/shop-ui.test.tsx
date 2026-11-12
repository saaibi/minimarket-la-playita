import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("React real: navegación por rol, marca, canasta, pedidos y ajustes sin credenciales demo", async () => {
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
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  const React = await import("react");
  const { MemoryRouter } = await import("react-router-dom");
  const { render, fireEvent, waitFor, cleanup, act, within } =
    await import("@testing-library/react");
  const { Protected } = await import("../apps/web/src/login.js");
  const { Shop } = await import("../apps/web/src/shop.js");
  const { auth } = await import("../apps/web/src/session.js");
  const previous = globalThis.fetch;
  let role: "admin" | "seller" | "buyer" = "admin";
  const product = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Huevos de prueba",
    kind: "unit",
    priceCop: 650,
    costCop: 400,
    stock: 90,
    reserved: 0,
    available: 90,
    version: 1,
    minimum: 12,
    visible: true,
    category: "Huevos",
    presentations: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        name: "Unidad",
        factor: 1,
        priceCop: 650,
      },
    ],
  };
  const settings = {
    days: Array.from({ length: 7 }, () => ({
      closed: false,
      open: "06:00",
      close: "20:00",
    })),
    override: "auto",
    overrideDate: "2000-01-01",
    version: 0,
  };
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path.endsWith("/auth/login") || path.endsWith("/auth/guest"))
      return Response.json({
        actor: {
          id: role + "-test",
          role,
          label: "Usuario de prueba",
          guest: role === "buyer",
        },
        accessExpiresAt: Date.now() + 300000,
      });
    if (path.endsWith("/inventory"))
      return Response.json([
        { ...product, ...(role === "admin" ? {} : { costCop: undefined }) },
      ]);
    if (path.endsWith("/settings")) return Response.json(settings);
    if (
      [
        "/orders",
        "/notifications",
        "/clients",
        "/audit",
        "/auth/users",
        "/auth/customers",
        "/credit/clients",
      ].some((p) => path.endsWith(p))
    )
      return Response.json([]);
    return Response.json({ ok: true });
  };
  try {
    for (const nextRole of ["admin", "seller", "buyer"] as const) {
      role = nextRole;
      await act(async () => {
        await auth.login("test@example.invalid", "synthetic-only-password");
      });
      const view = render(
        <MemoryRouter>
          <Protected>
            <Shop />
          </Protected>
        </MemoryRouter>,
      );
      await waitFor(() =>
        assert.ok(view.getAllByAltText("Minimarket La Playita").length),
      );
      const nav = view.getByRole("navigation", { name: "Módulos" });
      assert.equal(
        nav.querySelectorAll("button").length,
        role === "admin" ? 6 : role === "seller" ? 5 : 3,
      );
      if (role === "admin") {
        await waitFor(() =>
          assert.ok(view.getByRole("button", { name: /Nuevo producto/ })),
        );
        fireEvent.click(view.getByRole("button", { name: "Ajustes" }));
        await waitFor(() =>
          assert.ok(view.getByRole("heading", { name: "Cuentas y roles" })),
        );
        assert.ok(view.getByRole("heading", { name: "Clientes" }));
        assert.ok(view.getByRole("heading", { name: "Horario · Bogotá" }));
        fireEvent.click(view.getByRole("button", { name: "Inventario" }));
        assert.ok(view.getByRole("columnheader", { name: "Costo base" }));
        fireEvent.click(view.getByRole("button", { name: "Ajustar" }));
        assert.equal(
          view.queryByRole("group", { name: "Nuevos precios de venta" }),
          null,
        );
        fireEvent.click(
          view.getByRole("checkbox", {
            name: "Actualizar también el precio de venta",
          }),
        );
        assert.ok(view.getByRole("group", { name: "Nuevos precios de venta" }));
        assert.equal(
          (view.getByLabelText("Unidad (COP)") as HTMLInputElement).value,
          "650",
        );
        fireEvent.click(
          within(view.getByRole("dialog")).getByRole("button", {
            name: "Cancelar",
          }),
        );
        fireEvent.click(view.getByRole("button", { name: "Caja" }));
      }
      if (role === "seller") {
        assert.equal(view.queryByRole("button", { name: "Ajustes" }), null);
        assert.equal(
          view.queryByRole("button", { name: /Nuevo producto/ }),
          null,
        );
      }
      await waitFor(() =>
        assert.ok(view.getByRole("button", { name: "+ Agregar" })),
      );
      fireEvent.click(view.getByRole("button", { name: "+ Agregar" }));
      if (role !== "buyer") {
        assert.ok(view.getByLabelText("Ver canasta"));
        assert.equal(view.queryByRole("button", { name: /Canasta ·/ }), null);
      }
      fireEvent.click(
        view.getAllByRole("button", { name: "Ver canasta" }).at(-1)!,
      );
      assert.ok(view.getByRole("dialog"));
      assert.ok(view.getByText("Total"));
      if (role !== "buyer") {
        fireEvent.click(view.getByRole("button", { name: "A crédito" }));
        fireEvent.click(view.getByRole("button", { name: "× Cerrar" }));
        fireEvent.click(view.getByRole("button", { name: "Inventario" }));
        fireEvent.click(view.getByLabelText("Ver canasta"));
        assert.equal(
          view
            .getByRole("button", { name: "A crédito" })
            .getAttribute("aria-pressed"),
          "true",
        );
        assert.equal(view.queryByLabelText("Forma de pago"), null);
        assert.ok(view.getByRole("button", { name: "Anotar a crédito" }));
      }

      fireEvent.click(view.getByRole("button", { name: "× Cerrar" }));
      assert.equal(view.queryByRole("dialog"), null);
      fireEvent.click(view.getByRole("button", { name: "Notificaciones" }));
      assert.ok(
        within(view.getByRole("dialog")).getByRole("button", {
          name: "Pedidos",
        }),
      );
      assert.equal(
        within(view.getByRole("dialog"))
          .getByRole("button", { name: "Pedidos" })
          .getAttribute("aria-pressed"),
        "true",
      );
      fireEvent.click(view.getByRole("button", { name: "× Cerrar" }));
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: "Salir" }));
      });
      await waitFor(() => assert.equal(auth.current, null));
      cleanup();
    }
  } finally {
    cleanup();
    globalThis.fetch = previous;
    dom.window.close();
  }
});
