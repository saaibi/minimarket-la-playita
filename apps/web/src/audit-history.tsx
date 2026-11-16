import React, { useEffect, useRef, useState } from "react";
import type { Api } from "./management.js";
import { Button } from "./material.js";
import { LoadingMark } from "./ui.js";
const labels: Record<string, string> = {
  "credit.payment.receipt": "Abono único del cliente",
  "credit.opening": "Saldo anterior registrado",
  "credit.opening.payment": "Abono a saldo anterior",
  "account.credit": "Cliente y crédito",
  "account.role": "Cuenta y rol",
  "stock.adjusted": "Ajuste de existencias y precios",
  sale: "Venta de caja",
  "product.created": "Producto creado",
  "product.updated": "Producto editado",
  schedule: "Horario actualizado",
  "sale.removed": "Venta retirada",
  "sale.restored": "Venta restaurada",
};
export function AuditHistory({ api }: { api: Api }) {
  const [page, setPage] = useState(1),
    [data, setData] = useState<{ total: number; items: any[] } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [restoring, setRestoring] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void apiRef
      .current(`/audit?page=${page}`)
      .then((result) => {
        if (!active) return;
        if (!Array.isArray(result.items) || !Number.isInteger(result.total))
          throw Error("INVALID_PAGE");
        const last = Math.max(1, Math.ceil(result.total / 50));
        if (page > last) {
          setPage(last);
          return;
        }
        setData(result);
      })
      .catch(() => {
        if (active) {
          setData(null);
          setError("No se pudo consultar la trazabilidad.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, refresh]);
  async function restore(id: string) {
    setRestoring(true);
    setError("");
    try {
      await api(`/sales/${id}/removal`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          removed: false,
          reason:
            "Restauración de registro de venta retirado; inventario sin cambios",
        }),
      });
      setRefresh((n) => n + 1);
    } catch {
      setError(
        "No se pudo restaurar. Puede que el registro ya esté restaurado.",
      );
    } finally {
      setRestoring(false);
    }
  }
  const pages = Math.max(1, Math.ceil((data?.total || 0) / 50));
  return (
    <section className="panel">
      <h2>Ajustes de inventario y trazabilidad</h2>
      <p>
        Cada cambio conserva motivo, responsable y antes/después. 50 movimientos
        por página.
      </p>
      <Button
        tone="secondary"
        disabled={loading || restoring}
        onClick={() => setRefresh((n) => n + 1)}
      >
        Actualizar movimientos
      </Button>
      {loading ? (
        <LoadingMark label="Consultando movimientos…" />
      ) : (
        data && (
          <>
            <div className="table-wrap">
              <table className="audit-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Movimiento</th>
                    <th>Motivo</th>
                    <th>Responsable</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {new Date(r.createdAt).toLocaleString("es-CO", {
                          timeZone: "America/Bogota",
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td>{labels[r.kind] || r.kind}</td>
                      <td>{r.reason}</td>
                      <td title={r.actorId}>{r.actorId.slice(0, 8)}</td>
                      <td>
                        <details>
                          <summary>Antes y después</summary>
                          <pre>
                            {JSON.stringify(
                              { antes: r.before, despues: r.after },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                        {r.kind === "sale.removed" && (
                          <Button
                            disabled={restoring}
                            onClick={() => void restore(r.entityId)}
                          >
                            Restaurar venta
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.total === 0 ? (
              <p className="empty">Sin movimientos registrados.</p>
            ) : (
              <nav
                className="sales-pagination"
                aria-label="Páginas de trazabilidad"
              >
                <Button
                  variant="outlined"
                  disabled={page === 1 || restoring}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Anterior
                </Button>
                <span aria-live="polite">
                  Página {page} de {pages} · {data.total} movimientos
                </span>
                <Button
                  disabled={page >= pages || restoring}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente
                </Button>
              </nav>
            )}
          </>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
