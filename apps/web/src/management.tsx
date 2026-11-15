import { BusinessDashboard } from "./business-dashboard.js";
import { LoadingMark } from "./ui.js";
import { TextSizeSettings } from "./material.js";
import { Button, Input, Select, Textarea } from "./material.js";
import React, { useEffect, useState } from "react";
import {
  type Product,
  type ProductWrite,
  type Schedule,
  bogotaDate,
  stockLabel,
  weightFactor,
} from "@playita/shared";
import { Modal, money } from "./ui.js";
import { ProductPhoto } from "./product-photo.js";
import { StaffUsers } from "./staff.js";
export type Api = (path: string, init?: RequestInit) => Promise<any>;
export function Inventory({
  products,
  admin,
  api,
  reload,
  refreshToken = 0,
  ordersCount = 0,
  salesTotal = 0,
  onNavigate = () => {},
}: {
  refreshToken?: number;
  ordersCount?: number;
  salesTotal?: number;
  onNavigate?: (view: string) => void;
  products: Product[];
  admin: boolean;
  api: Api;
  reload: () => Promise<void>;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [category, setCategory] = useState("all"),
    [edit, setEdit] = useState<Product | null | undefined>(),
    [adjust, setAdjust] = useState<Product | null>(null),
    [delta, setDelta] = useState(""),
    [changePrice, setChangePrice] = useState(false),
    [prices, setPrices] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [audit, setAudit] = useState<any[] | null>(null);
  const listed = products.filter(
    (p) =>
      (p.name + " " + (p.code || ""))
        .toLocaleLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .includes(
          search
            .toLocaleLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, ""),
        ) &&
      (category === "all" || (p.category || "Despensa") === category) &&
      (filter === "all" ||
        (filter === "low" &&
          p.available > 0 &&
          p.available <= (p.minimum || 0)) ||
        (filter === "out" && p.available <= 0) ||
        (filter === "reserved" && p.reserved > 0)),
  );
  async function trace() {
    try {
      setAudit(await api("/audit"));
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">CONTROL DE TU TIENDA</p>
          <h1>Todo en su lugar</h1>
          <p>
            Existencias según la medida de cada producto. Reservas compartidas
            entre presentaciones.
          </p>
        </div>
        {admin && (
          <Button className="primary" onClick={() => setEdit(null)}>
            + Nuevo producto
          </Button>
        )}
      </div>
      <div className="stats">
        <Button
          variant="outlined"
          aria-pressed={filter === "all"}
          className="stat"
          onClick={() => setFilter("all")}
        >
          Productos<b>{products.length}</b>
        </Button>
        <Button
          variant="outlined"
          aria-pressed={filter === "low"}
          className="stat"
          onClick={() => setFilter("low")}
        >
          Por reponer
          <b>
            {
              products.filter(
                (p) => p.available > 0 && p.available <= (p.minimum || 0),
              ).length
            }
          </b>
        </Button>
        <Button
          variant="outlined"
          aria-pressed={filter === "out"}
          className="stat"
          onClick={() => setFilter("out")}
        >
          Agotados<b>{products.filter((p) => p.available <= 0).length}</b>
        </Button>
        <Button
          variant="outlined"
          className="stat"
          onClick={() => onNavigate("orders")}
        >
          Pedidos por entregar<b>{ordersCount}</b>
        </Button>
        <Button
          variant="outlined"
          className="stat sales-total-stat"
          onClick={() => onNavigate("history")}
        >
          Ventas registradas<b>{money(salesTotal)}</b>
        </Button>
      </div>
      <div className="toolbar">
        <Input
          aria-label="Buscar inventario"
          placeholder="Buscar producto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          aria-label="Categoría"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="all">Todas las categorías</option>
          {[...new Set(products.map((p) => p.category || "Despensa"))].map(
            (c) => (
              <option key={c}>{c}</option>
            ),
          )}
        </Select>
        <Select
          aria-label="Filtrar inventario"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todos</option>
          <option value="low">Por reponer</option>
          <option value="out">Agotados</option>
        </Select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Imagen</th>
              <th>Producto</th>
              <th>Físico</th>
              <th>Reservado</th>
              <th>Disponible</th>
              <th>Precio de venta</th>
              {admin && (
                <>
                  <th>Costo</th>
                  <th>Acciones</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {listed.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.photo ? (
                    <img
                      className="inventory-thumbnail"
                      src={p.photo}
                      alt={p.name}
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="inventory-thumbnail empty"
                      aria-label="Sin imagen"
                    >
                      —
                    </span>
                  )}
                </td>
                <td>
                  <strong>{p.name}</strong>
                  <small>
                    {p.category || "Despensa"} · {p.code}
                  </small>
                  <small>
                    {p.kind === "weight"
                      ? p.weightUnit === "lb"
                        ? "Por libra"
                        : "Por kilo"
                      : "Unidades"}{" "}
                    · {p.visible === false ? "Oculto" : "Visible"}
                  </small>
                  <small>
                    {p.presentations
                      .map(
                        (v) => `${v.name} (${v.factor}) ${money(v.priceCop)}`,
                      )
                      .join(" · ")}
                  </small>
                </td>
                <td>{stockLabel(p, p.stock)}</td>
                <td>{stockLabel(p, p.reserved)}</td>
                <td>
                  <span
                    className={
                      "tag " + (p.available <= (p.minimum || 0) ? "warn" : "")
                    }
                  >
                    {stockLabel(p, p.available)}
                  </span>
                </td>
                <td>
                  {money(
                    p.kind === "weight" && p.weightUnit === "lb"
                      ? p.priceCop / 2
                      : p.priceCop,
                  )}
                </td>
                {admin && (
                  <>
                    <td>
                      {money(
                        p.kind === "weight" && p.weightUnit === "lb"
                          ? (p.costCop || 0) / 2
                          : p.costCop || 0,
                      )}
                    </td>
                    <td className="product-actions-cell">
                      <div className="product-actions">
                        <Button tone="secondary" onClick={() => setEdit(p)}>
                          Editar
                        </Button>
                        <Button
                          onClick={() => {
                            setAdjust(p);
                            setDelta("0");
                            setChangePrice(false);
                            setPrices(
                              p.kind === "weight"
                                ? {
                                    kilo: String(
                                      p.weightUnit === "lb"
                                        ? p.priceCop / 2
                                        : p.priceCop,
                                    ),
                                  }
                                : Object.fromEntries(
                                    p.presentations.map((v) => [
                                      v.id,
                                      String(v.priceCop),
                                    ]),
                                  ),
                            );
                            setReason("");
                            setError("");
                          }}
                        >
                          Ajustar
                        </Button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!listed.length && (
        <p className="empty">No hay productos para este filtro.</p>
      )}
      <p role="alert">{error}</p>
      {admin && (
        <BusinessDashboard
          api={api}
          refreshKey={`${refreshToken}-${ordersCount}-${salesTotal}-${products.map((p) => p.version).join(",")}`}
        />
      )}
      {edit !== undefined && (
        <ProductEditor
          product={edit}
          close={() => setEdit(undefined)}
          save={async (value) => {
            await api(edit ? "/inventory/" + edit.id : "/inventory", {
              method: edit ? "PUT" : "POST",
              headers: { "Idempotency-Key": crypto.randomUUID() },
              body: JSON.stringify(value),
            });
            await reload();
            setEdit(undefined);
          }}
        />
      )}
      {adjust && (
        <Modal title={"Ajustar " + adjust.name} close={() => setAdjust(null)}>
          <p>
            Físico: {stockLabel(adjust, adjust.stock)}. Reservado:{" "}
            {stockLabel(adjust, adjust.reserved)}.{" "}
            {adjust.kind === "weight"
              ? `Ingresa ${adjust.weightUnit === "lb" ? "libras" : "kilos"}.`
              : "Ingresa unidades."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void api("/inventory/" + adjust.id + "/adjustments", {
                method: "POST",
                headers: { "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({
                  delta:
                    Number(delta) *
                    (adjust.kind === "weight"
                      ? weightFactor(adjust.weightUnit)
                      : 1),
                  reason,
                  version: adjust.version,
                  ...(changePrice
                    ? adjust.kind === "weight"
                      ? {
                          priceCop:
                            Number(prices.kilo) *
                            (adjust.weightUnit === "lb" ? 2 : 1),
                        }
                      : {
                          presentationPrices: adjust.presentations.map((v) => ({
                            id: v.id,
                            priceCop: Number(prices[v.id]),
                          })),
                        }
                    : {}),
                }),
              })
                .then(reload)
                .then(() => setAdjust(null))
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Cambio (+ ingreso / − salida)
              <Input
                type="number"
                step={
                  adjust.kind === "weight"
                    ? adjust.weightUnit === "lb"
                      ? "0.002"
                      : "0.001"
                    : "1"
                }
                value={delta}
                required
                onChange={(e) => setDelta(e.target.value)}
              />
            </label>
            <label>
              <Input
                type="checkbox"
                checked={changePrice}
                onChange={(e) => setChangePrice(e.target.checked)}
              />
              Actualizar también el precio de venta
            </label>
            {changePrice && (
              <fieldset>
                <legend>Nuevos precios de venta</legend>
                <p>
                  Se aplican a compras nuevas. Los pedidos ya creados conservan
                  su precio. Puedes dejar el cambio de cantidad en cero para
                  actualizar solo precios.
                </p>
                {(adjust.kind === "weight"
                  ? [
                      {
                        id: "kilo",
                        name:
                          adjust.weightUnit === "lb"
                            ? "Precio por libra"
                            : "Precio por kilo",
                      },
                    ]
                  : adjust.presentations
                ).map((v) => (
                  <label key={v.id}>
                    {v.name} (COP)
                    <Input
                      type="number"
                      min="0"
                      max="100000000"
                      step="1"
                      required
                      clearZero
                      value={prices[v.id] ?? ""}
                      onChange={(e) =>
                        setPrices({ ...prices, [v.id]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </fieldset>
            )}
            <label>
              Motivo obligatorio
              <Input
                value={reason}
                minLength={3}
                maxLength={200}
                required
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p role="alert">{error}</p>
            <Button className="primary" disabled={busy}>
              Guardar ajuste
            </Button>
            <Button
              tone="secondary"
              type="button"
              onClick={() => setAdjust(null)}
            >
              Cancelar
            </Button>
          </form>
        </Modal>
      )}
      {audit && (
        <Modal title="Trazabilidad del inventario" close={() => setAudit(null)}>
          {audit.length ? (
            audit.map((a) => (
              <article className="audit" key={a.id}>
                <strong>{a.kind}</strong>
                <p>{a.reason}</p>
                <small>
                  {new Date(a.createdAt).toLocaleString("es-CO", {
                    timeZone: "America/Bogota",
                  })}{" "}
                  · Responsable {a.actorId.slice(0, 8)}
                </small>
                <details>
                  <summary>Ver antes y después</summary>
                  <pre>
                    {JSON.stringify(
                      { antes: a.before, despues: a.after },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </article>
            ))
          ) : (
            <p>
              Sin movimientos registrados desde la activación de trazabilidad.
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
function ProductEditor({
  product,
  save,
  close,
}: {
  product: Product | null;
  save: (v: ProductWrite) => Promise<void>;
  close: () => void;
}) {
  const [value, setValue] = useState<ProductWrite>({
      name: product?.name || "",
      category: product?.category || "Despensa",
      code: product?.code || "",
      supplier: product?.supplier || "",
      description: product?.description || "",
      photo: product?.photo || "",
      kind: product?.kind || "unit",
      weightUnit: product?.weightUnit || "kg",
      priceCop: product?.priceCop || 0,
      costCop: product?.costCop || 0,
      minimum: product?.minimum || 0,
      visible: product?.visible !== false,
      ...(product ? { version: product.version } : { initialStock: 0 }),
      presentations: product?.presentations || [
        { name: "Unidad", factor: 1, priceCop: 0 },
      ],
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [photoBusy, setPhotoBusy] = useState(false);
  const priceUnit = value.weightUnit || "kg";
  const field = (key: keyof ProductWrite, v: any) =>
    setValue((p) => {
      const next = { ...p, [key]: v };
      if (key === "priceCop" && next.kind === "unit")
        next.presentations = next.presentations.map((presentation) =>
          presentation.factor === 1
            ? { ...presentation, priceCop: Number(v) }
            : presentation,
        );
      if (key === "presentations" && next.kind === "unit")
        next.priceCop =
          next.presentations.find((presentation) => presentation.factor === 1)
            ?.priceCop ?? next.priceCop;
      return next;
    });
  return (
    <Modal title={product ? "Editar producto" : "Nuevo producto"} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || photoBusy) return;
          setBusy(true);
          save(value)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Nombre
          <Input
            required
            maxLength={120}
            spellCheck
            lang="es"
            value={value.name}
            onChange={(e) => field("name", e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Categoría
            <Input
              required
              maxLength={80}
              spellCheck
              lang="es"
              value={value.category}
              onChange={(e) => field("category", e.target.value)}
            />
          </label>
          <label>
            Código
            <Input
              maxLength={80}
              value={value.code}
              onChange={(e) => field("code", e.target.value)}
            />
          </label>
          <label>
            Proveedor
            <Input
              maxLength={150}
              spellCheck
              lang="es"
              value={value.supplier}
              onChange={(e) => field("supplier", e.target.value)}
            />
          </label>
        </div>
        <label>
          Tipo
          <Select
            disabled={!!product}
            value={value.kind}
            onChange={(e) =>
              setValue((v) => ({
                ...v,
                kind: e.target.value as "unit" | "weight",
                presentations:
                  e.target.value === "unit"
                    ? [{ name: "Unidad", factor: 1, priceCop: v.priceCop }]
                    : [],
              }))
            }
          >
            <option value="unit">Por unidades / presentaciones</option>
            <option value="weight">Por peso</option>
          </Select>
        </label>
        {value.kind === "weight" && (
          <label>
            Medida del producto
            <Select
              value={priceUnit}
              onChange={(e) => field("weightUnit", e.target.value)}
            >
              <option value="kg">Kilo</option>
              <option value="lb">Libra</option>
            </Select>
          </label>
        )}
        <div className="form-grid">
          {(
            [
              "priceCop",
              "costCop",
              "minimum",
              ...(!product ? ["initialStock"] : []),
            ] as const
          ).map((key) => (
            <label key={key}>
              {
                (
                  {
                    priceCop: `Precio por ${value.kind === "weight" ? (priceUnit === "lb" ? "libra" : "kilo") : "unidad"} (COP)`,
                    costCop: `Costo por ${value.kind === "weight" ? (priceUnit === "lb" ? "libra" : "kilo") : "unidad"} (COP)`,
                    minimum:
                      value.kind === "weight"
                        ? `Mínimo de alerta (${priceUnit === "lb" ? "libras" : "kilos"})`
                        : "Mínimo de alerta (unidades)",
                    initialStock:
                      value.kind === "weight"
                        ? `Existencias iniciales (${priceUnit === "lb" ? "libras" : "kilos"})`
                        : "Existencias iniciales (unidades)",
                  } as any
                )[key]
              }
              <Input
                type="number"
                required
                min="0"
                step={
                  value.kind === "weight" &&
                  (key === "minimum" || key === "initialStock")
                    ? priceUnit === "lb"
                      ? "0.002"
                      : "0.001"
                    : "1"
                }
                max="100000000"
                clearZero
                value={
                  ((value as any)[key] || 0) /
                  (value.kind === "weight"
                    ? key === "minimum" || key === "initialStock"
                      ? weightFactor(priceUnit)
                      : priceUnit === "lb"
                        ? 2
                        : 1
                    : 1)
                }
                onChange={(e) =>
                  field(
                    key as keyof ProductWrite,
                    Number(e.target.value) *
                      (value.kind === "weight"
                        ? key === "minimum" || key === "initialStock"
                          ? weightFactor(priceUnit)
                          : priceUnit === "lb"
                            ? 2
                            : 1
                        : 1),
                  )
                }
              />
            </label>
          ))}
        </div>
        <label>
          Descripción
          <Textarea
            spellCheck
            lang="es"
            value={value.description}
            maxLength={1000}
            onChange={(e) => field("description", e.target.value)}
          />
        </label>
        <ProductPhoto
          photo={value.photo}
          onChange={(photo) => field("photo", photo)}
          onBusy={setPhotoBusy}
        />
        <label className="check">
          <Input
            type="checkbox"
            checked={value.visible}
            onChange={(e) => field("visible", e.target.checked)}
          />
          Visible para compradores
        </label>
        {value.kind === "unit" && (
          <fieldset>
            <legend>Presentaciones y precios independientes</legend>
            <small>
              Debe existir una presentación factor 1. Los factores 15 y 30
              comparten las mismas existencias.
            </small>
            {value.presentations.map((p, i) => (
              <div className="presentation-row" key={i}>
                <label>
                  Nombre
                  <Input
                    required
                    spellCheck
                    lang="es"
                    value={p.name}
                    onChange={(e) =>
                      field(
                        "presentations",
                        value.presentations.map((v, j) =>
                          j === i ? { ...v, name: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Unidades por presentación
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={p.factor}
                    onChange={(e) =>
                      field(
                        "presentations",
                        value.presentations.map((v, j) =>
                          j === i
                            ? { ...v, factor: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Precio COP
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    required
                    clearZero
                    value={p.priceCop}
                    onChange={(e) =>
                      field(
                        "presentations",
                        value.presentations.map((v, j) =>
                          j === i
                            ? { ...v, priceCop: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  tone="error"
                  type="button"
                  onClick={() =>
                    field(
                      "presentations",
                      value.presentations.filter((_, j) => i !== j),
                    )
                  }
                >
                  Quitar presentación
                </Button>
              </div>
            ))}
            <Button
              type="button"
              onClick={() =>
                field("presentations", [
                  ...value.presentations,
                  { name: "Nueva presentación", factor: 15, priceCop: 0 },
                ])
              }
            >
              + Presentación
            </Button>
          </fieldset>
        )}
        <p role="alert">{error}</p>
        <Button className="primary" disabled={busy || photoBusy}>
          Guardar producto
        </Button>
        <Button tone="secondary" type="button" onClick={close}>
          Cancelar
        </Button>
      </form>
    </Modal>
  );
}
export function Settings({
  api,
  schedule,
  reload,
}: {
  api: Api;
  schedule: Schedule | null;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Schedule | null>(schedule),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(schedule);
  }, [schedule, dirty]);
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">TU TIENDA, A TU MANERA</p>
          <h1>Ajustes</h1>
          <p>Horario de atención y personal autorizado.</p>
        </div>
      </div>
      <TextSizeSettings />
      {draft ? (
        <section className="panel">
          <h2>Horario · Bogotá</h2>
          <p>
            El modo manual se mantiene hasta volver a automático. Los pedidos
            existentes se pueden gestionar con la tienda cerrada.
          </p>
          <form
            onChange={() => setDirty(true)}
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void api("/settings", {
                method: "PUT",
                headers: { "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({ ...draft, overrideDate: bogotaDate() }),
              })
                .then(() => {
                  setDirty(false);
                  return reload();
                })
                .then(() => setMessage("Horario guardado"))
                .catch((e) => setMessage(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Modo de atención
              <Select
                value={draft.override}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    override: e.target.value as Schedule["override"],
                    overrideDate: bogotaDate(),
                  })
                }
              >
                <option value="auto">Según horario</option>
                <option value="open">Abrir manualmente</option>
                <option value="closed">Cerrar manualmente</option>
              </Select>
            </label>
            <Button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  days: draft.days.map(() => ({ ...draft.days[1]! })),
                })
              }
            >
              Aplicar horario del lunes a todos los días
            </Button>
            {[1, 2, 3, 4, 5, 6, 0].map((i) => {
              const d = draft.days[i]!;
              return (
                <div className="schedule-day" key={i}>
                  <strong>
                    {
                      [
                        "Domingo",
                        "Lunes",
                        "Martes",
                        "Miércoles",
                        "Jueves",
                        "Viernes",
                        "Sábado",
                      ][i]
                    }
                  </strong>
                  <label className="check">
                    <Input
                      type="checkbox"
                      checked={!d.closed}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          days: draft.days.map((v, j) =>
                            j === i ? { ...v, closed: !e.target.checked } : v,
                          ),
                        })
                      }
                    />
                    Abierto
                  </label>
                  <label>
                    Apertura
                    <Input
                      type="time"
                      disabled={d.closed}
                      required
                      value={d.open}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          days: draft.days.map((v, j) =>
                            j === i ? { ...v, open: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Cierre
                    <Input
                      type="time"
                      disabled={d.closed}
                      required
                      value={d.close}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          days: draft.days.map((v, j) =>
                            j === i ? { ...v, close: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              );
            })}
            <Button className="primary" disabled={busy}>
              Guardar horario
            </Button>
            <p role="status">{message}</p>
          </form>
        </section>
      ) : (
        <section className="panel">
          <p>No fue posible consultar el horario.</p>
          <Button
            onClick={() =>
              void reload().catch(() =>
                setMessage("La tienda no respondió. Reintenta en un momento."),
              )
            }
          >
            Volver a consultar horario
          </Button>
          <p role="alert">{message}</p>
        </section>
      )}
      <StaffUsers embedded />
      <Clients api={api} />
      <AuditSettings api={api} />
    </>
  );
}
function Clients({ api }: { api: Api }) {
  const [contacts, setContacts] = useState<
    { id: string; name: string; contact: string }[]
  >([]);
  const [accounts, setAccounts] = useState<
    {
      id: string;
      email: string | null;
      phone: string | null;
      active: boolean;
      creditEnabled: boolean;
    }[]
  >([]);
  const [message, setMessage] = useState("Consultando clientes…");
  useEffect(() => {
    let active = true;
    void Promise.all([api("/clients"), api("/auth/customers")])
      .then(([list, users]) => {
        if (active) {
          setContacts(list);
          setAccounts(users);
          setMessage("");
        }
      })
      .catch(() => {
        if (active) setMessage("No se pudieron consultar los clientes.");
      });
    return () => {
      active = false;
    };
  }, []);
  const [editing, setEditing] = useState<any>(null),
    [saving, setSaving] = useState(false),
    [editError, setEditError] = useState("");
  return (
    <section className="panel staff-users">
      <h2>Clientes</h2>
      <p>Consulta de clientes registrados y contactos de la tienda.</p>
      {message === "Consultando clientes…" ? (
        <LoadingMark label={message} />
      ) : (
        message && <p role="status">{message}</p>
      )}
      <h3>Cuentas de compradores</h3>
      {!message && !accounts.length && <p>No hay compradores registrados.</p>}
      <ul className="customer-list">
        {[...accounts]
          .sort((a, b) =>
            (a.email || a.phone || "").localeCompare(
              b.email || b.phone || "",
              "es",
            ),
          )
          .map((c) => (
            <li className="compact-customer" key={c.id}>
              <div>
                <strong>{c.email || c.phone || "Cliente"}</strong>
                <small>
                  {c.active ? "Activa" : "Desactivada"} · Crédito{" "}
                  {c.creditEnabled ? "habilitado" : "deshabilitado"}
                </small>
              </div>
              <Button
                tone="secondary"
                type="button"
                onClick={() => (
                  setEditError(""),
                  setEditing({ ...c, creditEnabled: !!c.creditEnabled })
                )}
              >
                Editar
              </Button>
            </li>
          ))}
      </ul>
      {editing && (
        <Modal
          title="Editar cliente"
          close={() => {
            if (!saving) setEditing(null);
          }}
        >
          <p>
            El cambio conserva sus pedidos, deuda y la cuenta de Google
            vinculada.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              void api("/auth/users/" + editing.id + "/credit", {
                method: "POST",
                body: JSON.stringify({
                  creditEnabled: editing.creditEnabled,
                  email: editing.email,
                }),
              })
                .then(() => {
                  setAccounts((list) =>
                    list.map((c) =>
                      c.id === editing.id
                        ? {
                            ...c,
                            creditEnabled: editing.creditEnabled,
                            email: editing.email.trim().toLowerCase(),
                          }
                        : c,
                    ),
                  );
                  setEditing(null);
                })
                .catch(() =>
                  setEditError(
                    "No se pudo guardar el cliente. Verifica que el correo no esté en uso.",
                  ),
                )
                .finally(() => setSaving(false));
            }}
          >
            <label>
              Correo electrónico
              <Input
                type="email"
                required
                autoComplete="off"
                spellCheck={false}
                value={editing.email || ""}
                onChange={(e) =>
                  setEditing({ ...editing, email: e.target.value })
                }
              />
            </label>
            <label className="check">
              <Input
                type="checkbox"
                checked={!!editing.creditEnabled}
                onChange={(e) =>
                  setEditing({ ...editing, creditEnabled: e.target.checked })
                }
              />
              Permitir compras a crédito
            </label>
            <p>
              Deshabilitarlo impide nuevos créditos y conserva la deuda y los
              abonos anteriores.
            </p>
            {editError && <p role="alert">{editError}</p>}
            <Button type="submit" disabled={saving}>
              Guardar cliente
            </Button>
          </form>
        </Modal>
      )}
      <h3>Contactos guardados</h3>
      {!message && !contacts.length && <p>No hay contactos guardados.</p>}
      <ul className="customer-list">
        {[...contacts]
          .sort((a, b) => a.name.localeCompare(b.name, "es"))
          .map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>
              {c.contact && <small>{c.contact}</small>}
            </li>
          ))}
      </ul>
    </section>
  );
}
function AuditSettings({ api }: { api: Api }) {
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  async function load() {
    try {
      setRows(await api("/audit"));
    } catch {
      setError("No se pudo consultar la trazabilidad");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel">
      <h2>Ajustes de inventario y trazabilidad</h2>
      <p>
        Cada cambio conserva motivo, responsable y antes/después. Últimos 200
        movimientos.
      </p>
      <Button tone="secondary" onClick={() => void load()}>
        Actualizar movimientos
      </Button>
      {rows.map((r) => (
        <article className="audit" key={r.id}>
          <strong>
            {r.kind === "account.credit"
              ? "Permiso de crédito"
              : r.kind === "account.role"
                ? "Cuenta y rol"
                : r.kind === "stock.adjusted"
                  ? "Ajuste de existencias y precios"
                  : r.kind === "sale"
                    ? "Venta de caja"
                    : r.kind === "product.created"
                      ? "Producto creado"
                      : r.kind === "product.updated"
                        ? "Producto editado"
                        : r.kind === "schedule"
                          ? "Horario actualizado"
                          : r.kind}
          </strong>
          <p>{r.reason}</p>
          {r.kind === "sale.removed" && (
            <Button
              type="button"
              onClick={() =>
                void api("/sales/" + r.entityId + "/removal", {
                  method: "POST",
                  headers: { "Idempotency-Key": crypto.randomUUID() },
                  body: JSON.stringify({
                    removed: false,
                    reason:
                      "Restauración de registro de venta retirado; inventario sin cambios",
                  }),
                })
                  .then(load)
                  .catch(() =>
                    setError(
                      "No se pudo restaurar. Puede que el registro ya esté restaurado.",
                    ),
                  )
              }
            >
              Restaurar registro de venta
            </Button>
          )}

          <small>
            {new Date(r.createdAt).toLocaleString("es-CO", {
              timeZone: "America/Bogota",
            })}{" "}
            · Responsable {r.actorId.slice(0, 8)}
          </small>
          <details>
            <summary>Ver antes y después</summary>
            <pre>
              {JSON.stringify({ antes: r.before, despues: r.after }, null, 2)}
            </pre>
          </details>
        </article>
      ))}
      {!rows.length && <p className="empty">Sin movimientos registrados.</p>}
      <p role="alert">{error}</p>
    </section>
  );
}
