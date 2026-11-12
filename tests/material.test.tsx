import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("Material numeric fields can clear zero and enter a replacement without moving the cursor", async () => {
  const dom = new JSDOM("<html><body></body></html>", {
    url: "http://localhost",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react");
  const { render, fireEvent, cleanup } = await import("@testing-library/react");
  const { Input } = await import("../apps/web/src/material.js");
  function Form() {
    const [value, setValue] = React.useState(0);
    return (
      <label>
        Precio
        <Input
          type="number"
          clearZero
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
      </label>
    );
  }
  try {
    const view = render(<Form />);
    const field = view.getByLabelText("Precio") as HTMLInputElement;
    fireEvent.focus(field);
    assert.equal(field.value, "");
    fireEvent.change(field, { target: { value: "4500" } });
    assert.equal(field.value, "4500");
    fireEvent.change(field, { target: { value: "" } });
    assert.equal(field.value, "");
    fireEvent.change(field, { target: { value: "0" } });
    assert.equal(field.value, "0");
  } finally {
    cleanup();
    dom.window.close();
  }
});
