import React, { useEffect, useRef, useState } from "react";
import { bogotaDate } from "@playita/shared";
import { Button, Input, Select } from "./material.js";
import { LoadingMark, money } from "./ui.js";
import type { Api } from "./management.js";
type Report = {
  from: string;
  to: string;
  salesCop: number;
  saleCount: number;
  cashCop: number;
  creditCop: number;
  paymentsCop: number;
  balanceCop: number;
  daily: {
    day: string;
    totalCop: number;
    cashCop: number;
    creditCop: number;
  }[];
  topProducts: { name: string; totalCop: number }[];
  inventory: { available: number; low: number; out: number };
};
let chartsPromise: Promise<any> | undefined;
function charts() {
  if (chartsPromise) return chartsPromise;
  chartsPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("CHART_TIMEOUT")), 15000);
    const load = () => {
      const g = (window as any).google;
      g.charts.load("current", { packages: ["corechart"], language: "es" });
      g.charts.setOnLoadCallback(() => {
        clearTimeout(timer);
        resolve(g.visualization);
      });
    };
    if ((window as any).google?.charts) {
      load();
      return;
    }
    let script = document.getElementById(
      "playita-google-charts",
    ) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "playita-google-charts";
      script.src = "https://www.gstatic.com/charts/loader.js";
      script.async = true;
    }
    script.addEventListener("load", load, { once: true });
    script.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        script?.remove();
        reject(Error("CHART_UNAVAILABLE"));
      },
      { once: true },
    );
    if (!script.isConnected) document.head.appendChild(script);
  }).catch((e) => {
    chartsPromise = undefined;
    throw e;
  });
  return chartsPromise;
}
function Graph({
  title,
  kind,
  columns,
  rows,
}: {
  title: string;
  kind: "LineChart" | "ColumnChart" | "BarChart" | "PieChart";
  columns: string[];
  rows: (string | number)[][];
}) {
  const ref = useRef<HTMLDivElement>(null),
    [failed, setFailed] = useState(false);
  const hasData = rows.some((r) =>
    r.slice(1).some((v) => typeof v === "number" && v > 0),
  );
  useEffect(() => {
    if (!hasData) return;
    let active = true,
      observer: ResizeObserver | undefined,
      chart: any;
    setFailed(false);
    void charts()
      .then((v) => {
        if (!active || !ref.current) return;
        chart = new v[kind](ref.current);
        const data = v.arrayToDataTable([columns, ...rows]);
        const draw = () => {
          if (active && ref.current)
            chart.draw(data, {
              height: 260,
              colors: ["#153e31", "#be4208", "#b3261e"],
              backgroundColor: "transparent",
              fontName: "Arial",
              chartArea: {
                left: kind === "BarChart" ? 110 : 55,
                top: 25,
                width: kind === "BarChart" ? "58%" : "75%",
                height: "65%",
              },
              legend: {
                position:
                  columns.length > 2 || kind === "PieChart" ? "bottom" : "none",
              },
              pieHole: kind === "PieChart" ? 0.42 : 0,
              hAxis: { minValue: 0 },
              vAxis: { minValue: 0, format: "short" },
              animation: { duration: 0 },
              tooltip: { isHtml: false },
              isStacked: columns.length > 2,
            });
        };
        draw();
        observer = new ResizeObserver(draw);
        observer.observe(ref.current);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      observer?.disconnect();
      chart?.clearChart();
    };
  }, [title, kind, JSON.stringify(columns), JSON.stringify(rows)]);
  return (
    <article className="panel business-chart">
      <h3>{title}</h3>
      {hasData ? (
        <>
          <div ref={ref} className="business-chart-canvas" aria-hidden="true" />
          {failed && (
            <p>Gráfico no disponible. Consulta los datos de la tabla.</p>
          )}
          <details>
            <summary>Ver datos</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>
                          {typeof c === "number"
                            ? new Intl.NumberFormat("es-CO").format(c)
                            : c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="empty">Sin datos para este gráfico.</p>
      )}
    </article>
  );
}
function daysAgo(end: string, days: number) {
  const d = new Date(end + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
export function BusinessDashboard({
  api,
  refreshKey,
}: {
  api: Api;
  refreshKey: string;
}) {
  const today = bogotaDate(),
    [period, setPeriod] = useState("30"),
    [from, setFrom] = useState(daysAgo(today, 29)),
    [to, setTo] = useState(today),
    [range, setRange] = useState({ from: daysAgo(today, 29), to: today }),
    [data, setData] = useState<Report | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    void apiRef
      .current("/reports/business?from=" + range.from + "&to=" + range.to)
      .then((d) => {
        if (
          !Array.isArray(d.daily) ||
          !Array.isArray(d.topProducts) ||
          !d.inventory ||
          ![
            d.salesCop,
            d.saleCount,
            d.cashCop,
            d.creditCop,
            d.balanceCop,
            d.paymentsCop,
          ].every(Number.isFinite)
        )
          throw Error("INVALID_REPORT");
        if (active) setData(d);
      })
      .catch(() => {
        if (active)
          setError(
            "No fue posible consultar el resumen. Desliza para volver a actualizar.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [range.from, range.to, refreshKey]);
  const dateLabel = (day: string) =>
    new Date(day + "T12:00:00Z").toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "short",
      timeZone: "America/Bogota",
    });
  return (
    <section className="business-dashboard">
      <h2>Resumen del negocio</h2>
      <p>Ventas entregadas por fecha de registro · COP</p>
      <div className="business-filters">
        <label>
          Período
          <Select
            value={period}
            onChange={(e) => {
              const v = e.target.value;
              setPeriod(v);
              if (v !== "custom") {
                const r = { from: daysAgo(today, Number(v) - 1), to: today };
                setFrom(r.from);
                setTo(r.to);
                setRange(r);
              }
            }}
          >
            <option value="1">Hoy</option>
            <option value="7">7 días</option>
            <option value="30">30 días</option>
            <option value="custom">Rango de fechas</option>
          </Select>
        </label>
        {period === "custom" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (
                from > to ||
                (Date.parse(to) - Date.parse(from)) / 86400000 >= 366
              ) {
                setError("Elige un rango válido de hasta 366 días.");
                return;
              }
              setRange({ from, to });
            }}
          >
            <label>
              Desde
              <Input
                type="date"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Hasta
              <Input
                type="date"
                required
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button>Aplicar</Button>
          </form>
        )}
      </div>
      {loading && <LoadingMark label="Consultando resumen del negocio…" />}
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <div className="business-totals">
            <div>
              Ventas del período<strong>{money(data.salesCop)}</strong>
              <small>{data.saleCount} ventas</small>
            </div>
            <div>
              Venta promedio
              <strong>
                {money(
                  data.saleCount
                    ? Math.round(data.salesCop / data.saleCount)
                    : 0,
                )}
              </strong>
            </div>
            <div>
              Cartera pendiente actual<strong>{money(data.balanceCop)}</strong>
            </div>
            <div>
              Abonos posteriores del período
              <strong>{money(data.paymentsCop)}</strong>
            </div>
          </div>
          <div className="business-charts">
            <Graph
              title="Ventas por día"
              kind="LineChart"
              columns={["Fecha", "Ventas COP"]}
              rows={data.daily.map((d) => [dateLabel(d.day), d.totalCop])}
            />
            <Graph
              title="Contado y crédito al vender"
              kind="PieChart"
              columns={["Tipo", "COP"]}
              rows={[
                ["Pagado al vender", data.cashCop],
                ["Dejado a crédito", data.creditCop],
              ]}
            />
            <Graph
              title="Productos más vendidos por importe"
              kind="BarChart"
              columns={["Producto", "Ventas COP"]}
              rows={data.topProducts.map((p) => [p.name, p.totalCop])}
            />
            <Graph
              title="Composición de ventas por día"
              kind="ColumnChart"
              columns={["Fecha", "Pagado al vender", "Dejado a crédito"]}
              rows={data.daily.map((d) => [
                dateLabel(d.day),
                d.cashCop,
                d.creditCop,
              ])}
            />
            <Graph
              title="Estado actual del inventario"
              kind="ColumnChart"
              columns={["Estado", "Productos"]}
              rows={[
                ["Disponible", data.inventory.available],
                ["Por reponer", data.inventory.low],
                ["Agotado", data.inventory.out],
              ]}
            />
            <Graph
              title="Cartera y abonos"
              kind="BarChart"
              columns={["Concepto", "COP"]}
              rows={[
                ["Deuda actual", data.balanceCop],
                ["Abonos del período", data.paymentsCop],
              ]}
            />
          </div>
          <small>
            La torta separa lo pagado al vender de lo dejado a crédito; los
            abonos posteriores no se suman como nuevas ventas. La cartera y el
            inventario muestran su estado actual, sin filtro de fechas.
          </small>
        </>
      )}
    </section>
  );
}
