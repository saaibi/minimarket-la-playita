import React, { useEffect, useRef, useState } from "react";
import { Button } from "./material.js";
type Position = { x: number; y: number };
const key = "playita.inventory.actions.position";
export function clampActionPosition(
  p: Position,
  width: number,
  height: number,
): Position {
  return {
    x: Math.max(12, Math.min(p.x, Math.max(12, width - 68))),
    y: Math.max(
      Math.min(84, Math.max(12, height - 164)),
      Math.min(p.y, Math.max(12, height - 164)),
    ),
  };
}
export function InventoryActions({
  onNew,
  onOrder,
  hidden,
}: {
  onNew: () => void;
  onOrder: () => void;
  hidden: boolean;
}) {
  const [position, setPosition] = useState<Position>(() => {
      let saved;
      try {
        saved = JSON.parse(window.localStorage.getItem(key) || "null");
      } catch {}
      return clampActionPosition(
        saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
          ? saved
          : { x: window.innerWidth - 76, y: window.innerHeight - 180 },
        window.innerWidth,
        window.innerHeight,
      );
    }),
    [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{
      id: number;
      x: number;
      y: number;
      start: Position;
      moved: boolean;
    } | null>(null),
    suppressClick = useRef(false);
  useEffect(() => {
    const resize = () =>
      setPosition((p) =>
        clampActionPosition(p, window.innerWidth, window.innerHeight),
      );
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", resize);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(position));
    } catch {}
  }, [position]);
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);
  if (hidden) return null;
  return (
    <div
      ref={root}
      className="inventory-floating-actions"
      style={{ left: position.x, top: position.y }}
    >
      {open && (
        <div
          className="inventory-action-menu"
          role="group"
          aria-label="Opciones de inventario"
          style={{
            ...(position.x + 220 > window.innerWidth - 12
              ? { right: 0 }
              : { left: 0 }),
            ...(position.y > 260 ? { bottom: 68 } : { top: 68 }),
          }}
        >
          <Button
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            Nuevo producto
          </Button>
          <Button
            tone="secondary"
            onClick={() => {
              setOpen(false);
              onOrder();
            }}
          >
            Preparar pedido
          </Button>
        </div>
      )}
      <Button
        className="inventory-fab"
        aria-label="Acciones de inventario"
        aria-expanded={open}
        title="Toca para abrir; arrastra para mover"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          suppressClick.current = false;
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            start: position,
            moved: false,
          };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.hypot(dx, dy) > 6) d.moved = true;
          if (d.moved) {
            setOpen(false);
            setPosition(
              clampActionPosition(
                { x: d.start.x + dx, y: d.start.y + dy },
                window.innerWidth,
                window.innerHeight,
              ),
            );
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (d?.id !== e.pointerId) return;
          suppressClick.current = !!d?.moved;
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
          suppressClick.current = true;
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden="true">{open ? "×" : "+"}</span>
      </Button>
    </div>
  );
}
