import React, { useEffect, useRef, useState } from "react";
import type { Order } from "./shop.js";
import { Button } from "./material.js";
import { LoadingMark, money } from "./ui.js";
import { BusinessDashboard } from "./business-dashboard.js";
type Page = {
  page: number;
  pageSize: number;
  total: number;
  totalCop: number;
  items: Order[];
};
export function SalesHistory({
  api,
  admin,
  refreshKey,
  onDetail,
}: {
  api: (path: string) => Promise<any>;
  admin: boolean;
  refreshKey: string;
  onDetail: (order: Order) => void;
}) {
  const [page, setPage] = useState(1),
    [data, setData] = useState<Page | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void apiRef
      .current(`/sales?page=${page}`)
      .then((result: Page) => {
        if (!active) return;
        if (!Array.isArray(result.items) || !Number.isInteger(result.total))
          throw Error("INVALID_PAGE");
        const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setData(result);
      })
      .catch(() => {
        if (active) {
          setData(null);
          setError(
            "No fue posible consultar las ventas. Desliza para volver a actualizar.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, refreshKey]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section aria-label="Ventas registradas">
      <h1>Ventas registradas</h1>
      {data && (
        <div className="stats">
          <div className="stat">
            Ventas<b>{data.total}</b>
          </div>
          <div className="stat">
            Total vendido<b>{money(data.totalCop)}</b>
          </div>
        </div>
      )}
      {loading ? (
        <LoadingMark label="Consultando ventas…" />
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <ul className="sales-list">
            {data?.items.map((order) => (
              <li key={order.id}>
                <div className="sales-list-info">
                  <strong>{order.clientName || "Cliente general"}</strong>
                  <small>
                    {new Date(order.createdAt).toLocaleString("es-CO", {
                      timeZone: "America/Bogota",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}{" "}
                    · {order.channel === "pos" ? "Venta POS" : "Pedido"}
                  </small>
                  <small>
                    Pedido {order.id.slice(0, 8)} ·{" "}
                    {order.creditClientId ? "Crédito" : "Pagado"}
                  </small>
                </div>
                <strong>{money(order.totalCop)}</strong>
                <Button
                  onClick={() => onDetail(order)}
                  aria-label={`Ver detalle de venta ${order.id.slice(0, 8)}`}
                >
                  Ver detalle
                </Button>
              </li>
            ))}
          </ul>
          {data?.total === 0 && (
            <p className="empty">No hay ventas registradas.</p>
          )}
        </>
      )}
      {data && data.total > 0 && (
        <nav className="sales-pagination" aria-label="Páginas de ventas">
          <Button
            variant="outlined"
            disabled={loading || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span aria-live="polite">
            Página {page} de {pages}
          </span>
          <Button
            disabled={loading || page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </nav>
      )}
      {admin && <BusinessDashboard api={api} refreshKey={refreshKey} />}
    </section>
  );
}
