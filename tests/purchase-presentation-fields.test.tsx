import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
test("Presentaciones de compra: añadir varias, evitar vacíos o repetidas y quitar una", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  const React = await import("react");
  const { render, fireEvent, cleanup } = await import("@testing-library/react");
  const { PurchasePresentationFields, purchaseNamesValid } =
    await import("../apps/web/src/purchase-presentation-fields.js");
  function Form() {
    const [values, setValues] = React.useState(["arroba"]);
    return (
      <>
        <PurchasePresentationFields values={values} onChange={setValues} />
        <button disabled={!purchaseNamesValid(values)}>Guardar prueba</button>
      </>
    );
  }
  try {
    const view = render(<Form />);
    fireEvent.click(
      view.getByRole("button", { name: "Agregar presentación de compra" }),
    );
    assert.equal(
      (
        view.getByRole("button", {
          name: "Guardar prueba",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    fireEvent.change(view.getByLabelText("Presentación de compra 2"), {
      target: { value: "ARROBA" },
    });
    assert.equal(
      (
        view.getByRole("button", {
          name: "Guardar prueba",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    fireEvent.change(view.getByLabelText("Presentación de compra 2"), {
      target: { value: "bulto" },
    });
    assert.equal(
      (
        view.getByRole("button", {
          name: "Guardar prueba",
        }) as HTMLButtonElement
      ).disabled,
      false,
    );
    fireEvent.click(
      view.getByRole("button", { name: "Quitar presentación de compra 1" }),
    );
    assert.equal(
      (view.getByLabelText("Presentación de compra 1") as HTMLInputElement)
        .value,
      "bulto",
    );
  } finally {
    cleanup();
    dom.window.close();
  }
});
