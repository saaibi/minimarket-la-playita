import React, { useEffect, useRef } from "react";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={compact ? "brand-logo compact" : "brand-logo"}
      src="/assets/marca.png"
      alt="Minimarket La Playita"
    />
  );
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    inventory: "M4 7h16v13H4zM3 3h18v4H3zM9 11h6",
    pos: "M3 3h18v13H3zM8 21h8M12 16v5M7 7h3M7 11h8",
    orders: "M6 4h12v17H6zM9 2h6v4H9M9 10h6M9 14h6",
    history: "M4 5v5h5M4 10a8 8 0 1 1 0 5M12 7v5l3 2",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    basket: "M3 8h18l-2 12H5zM7 8l5-6 5 6M9 12v4M15 12v4",
    catalog: "M3 7h18M5 7v14h14V7M3 7l2-5h14l2 5M9 21v-7h6v7",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.catalog} />
    </svg>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const nodes = root.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0]!,
          last = nodes[nodes.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <div className="dialog-top">
          <h2>{title}</h2>
          <button onClick={close}>× Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  );
}
export const money = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
export const roles = {
  admin: "Administrador",
  seller: "Vendedor",
  buyer: "Comprador",
};
export const navItems = [
  ["inventory", "Inventario"],
  ["pos", "Caja"],
  ["orders", "Pedidos"],
  ["history", "Ventas"],
  ["settings", "Ajustes"],
] as const;
export function modulesFor(role: string) {
  return role === "buyer"
    ? [
        ["catalog", "Catálogo"],
        ["orders", "Mis pedidos"],
      ]
    : navItems.filter(([id]) => role === "admin" || id !== "settings");
}
