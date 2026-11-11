import React, { useEffect, useState } from "react";
import {
  type Product,
  type ProductWrite,
  type Schedule,
  bogotaDate,
} from "@playita/shared";
import { Modal, money } from "./ui.js";
import { StaffUsers } from "./staff.js";
export type Api = (path: string, init?: RequestInit) => Promise<any>;
export function Inventory({
  products,
  admin,
  api,
  reload,
  ordersCount = 0,
  salesTotal = 0,
  onNavigate = () => {},
}: {
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
            Existencias en unidades base o gramos. Reservas compartidas entre
            presentaciones.
          </p>
        </div>
        {admin && (
          <button className="primary" onClick={() => setEdit(null)}>
            + Nuevo producto
          </button>
        )}
      </div>
      <div className="stats">
        <button className="stat" onClick={() => setFilter("all")}>
          Productos<b>{products.length}</b>
        </button>
        <button className="stat" onClick={() => setFilter("low")}>
          Por reponer
          <b>
            {
              products.filter(
                (p) => p.available > 0 && p.available <= (p.minimum || 0),
              ).length
            }
          </b>
        </button>
        <button className="stat" onClick={() => setFilter("out")}>
          Agotados<b>{products.filter((p) => p.available <= 0).length}</b>
        </button>
        <button className="stat" onClick={() => onNavigate("orders")}>
          Pedidos por entregar<b>{ordersCount}</b>
        </button>
        <button className="stat" onClick={() => onNavigate("history")}>
          Ventas registradas<b>{money(salesTotal)}</b>
        </button>
      </div>
      <div className="toolbar">
        <input
          aria-label="Buscar inventario"
          placeholder="Buscar producto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
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
        </select>
        <select
          aria-label="Filtrar inventario"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">Todos</option>
          <option value="low">Por reponer</option>
          <option value="out">Agotados</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Físico</th>
              <th>Reservado</th>
              <th>Disponible</th>
              <th>Precio base</th>
              {admin && (
                <>
                  <th>Costo base</th>
                  <th>Acciones</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {listed.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.name}</strong>
                  <small>
                    {p.category || "Despensa"} · {p.code}
                  </small>
                  <small>
                    {p.kind === "weight"
                      ? "Gramos · precio por kilo"
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
                <td>{p.stock}</td>
                <td>{p.reserved}</td>
                <td>
                  <span
                    className={
                      "tag " + (p.available <= (p.minimum || 0) ? "warn" : "")
                    }
                  >
                    {p.available}
                  </span>
                </td>
                <td>{money(p.priceCop)}</td>
                {admin && (
                  <>
                    <td>{money(p.costCop || 0)}</td>
                    <td>
                      <button onClick={() => setEdit(p)}>Editar</button>
                      <button
                        onClick={() => {
                          setAdjust(p);
                          setDelta("0");
                          setChangePrice(false);
                          setPrices(
                            p.kind === "weight"
                              ? { kilo: String(p.priceCop) }
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
                      </button>
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
            Físico: {adjust.stock}. Reservado: {adjust.reserved}.{" "}
            {adjust.kind === "weight"
              ? "Ingresa gramos enteros."
              : "Ingresa unidades base."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void api("/inventory/" + adjust.id + "/adjustments", {
                method: "POST",
                headers: { "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify({
                  delta: Number(delta),
                  reason,
                  version: adjust.version,
                  ...(changePrice
                    ? adjust.kind === "weight"
                      ? { priceCop: Number(prices.kilo) }
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
              <input
                type="number"
                step="1"
                value={delta}
                required
                onChange={(e) => setDelta(e.target.value)}
              />
            </label>
            <label>
              <input
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
                  ? [{ id: "kilo", name: "Precio por kilo" }]
                  : adjust.presentations
                ).map((v) => (
                  <label key={v.id}>
                    {v.name} (COP)
                    <input
                      type="number"
                      min="0"
                      max="100000000"
                      step="1"
                      required
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
              <input
                value={reason}
                minLength={3}
                maxLength={200}
                required
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p role="alert">{error}</p>
            <button className="primary" disabled={busy}>
              Guardar ajuste
            </button>
            <button type="button" onClick={() => setAdjust(null)}>
              Cancelar
            </button>
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
    [priceUnit, setPriceUnit] = useState("kg");
  const field = (key: keyof ProductWrite, v: any) =>
    setValue((p) => ({ ...p, [key]: v }));
  return (
    <Modal title={product ? "Editar producto" : "Nuevo producto"} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          save(value)
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Nombre
          <input
            required
            maxLength={120}
            value={value.name}
            onChange={(e) => field("name", e.target.value)}
          />
        </label>
        <div className="form-grid">
          <label>
            Categoría
            <input
              required
              maxLength={80}
              value={value.category}
              onChange={(e) => field("category", e.target.value)}
            />
          </label>
          <label>
            Código
            <input
              maxLength={80}
              value={value.code}
              onChange={(e) => field("code", e.target.value)}
            />
          </label>
          <label>
            Proveedor
            <input
              maxLength={150}
              value={value.supplier}
              onChange={(e) => field("supplier", e.target.value)}
            />
          </label>
        </div>
        <label>
          Tipo
          <select
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
            <option value="weight">Por peso (gramos)</option>
          </select>
        </label>
        {value.kind === "weight" && (
          <label>
            Unidad del precio y costo
            <select
              value={priceUnit}
              onChange={(e) => setPriceUnit(e.target.value)}
            >
              <option value="kg">Kilo</option>
              <option value="lb">Libra · 500 g</option>
            </select>
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
                    priceCop: "Precio por kilo / unidad base (COP)",
                    costCop: "Costo por kilo / unidad base (COP)",
                    minimum:
                      value.kind === "weight"
                        ? "Mínimo de alerta (kilos)"
                        : "Mínimo de alerta (unidades)",
                    initialStock:
                      value.kind === "weight"
                        ? "Existencias iniciales (kilos)"
                        : "Existencias iniciales (unidades)",
                  } as any
                )[key]
              }
              <input
                type="number"
                required
                min="0"
                step="1"
                max="100000000"
                value={
                  ((value as any)[key] || 0) /
                  (value.kind === "weight"
                    ? key === "minimum" || key === "initialStock"
                      ? 1000
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
                          ? 1000
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
          <textarea
            value={value.description}
            maxLength={1000}
            onChange={(e) => field("description", e.target.value)}
          />
        </label>
        <label>
          Foto opcional (máximo 2 MB)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 2000000) {
                setError("Elige una imagen de menos de 2 MB");
                return;
              }
              void (async () => {
                try {
                  const bitmap = await createImageBitmap(file),
                    scale = Math.min(
                      1,
                      640 / Math.max(bitmap.width, bitmap.height),
                    ),
                    canvas = document.createElement("canvas");
                  canvas.width = Math.round(bitmap.width * scale);
                  canvas.height = Math.round(bitmap.height * scale);
                  canvas
                    .getContext("2d")!
                    .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                  const photo = canvas.toDataURL("image/jpeg", 0.75);
                  bitmap.close();
                  if (photo.length > 300000)
                    throw Error("La imagen comprimida es demasiado grande");
                  field("photo", photo);
                } catch {
                  setError("No fue posible preparar la imagen");
                }
              })();
            }}
          />
        </label>
        {value.photo && (
          <img
            className="photo-preview"
            src={value.photo}
            alt="Vista previa del producto"
          />
        )}
        <label className="check">
          <input
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
                  <input
                    required
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
                  <input
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
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
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
                <button
                  type="button"
                  onClick={() =>
                    field(
                      "presentations",
                      value.presentations.filter((_, j) => i !== j),
                    )
                  }
                >
                  Quitar presentación
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                field("presentations", [
                  ...value.presentations,
                  { name: "Nueva presentación", factor: 15, priceCop: 0 },
                ])
              }
            >
              + Presentación
            </button>
          </fieldset>
        )}
        <p role="alert">{error}</p>
        <button className="primary" disabled={busy}>
          Guardar producto
        </button>
        <button type="button" onClick={close}>
          Cancelar
        </button>
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
              <select
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
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  days: draft.days.map(() => ({ ...draft.days[1]! })),
                })
              }
            >
              Aplicar horario del lunes a todos los días
            </button>
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
                    <input
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
                    <input
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
                    <input
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
            <button className="primary" disabled={busy}>
              Guardar horario
            </button>
            <p role="status">{message}</p>
          </form>
        </section>
      ) : (
        <section className="panel">
          <p>No fue posible consultar el horario.</p>
          <button
            onClick={() =>
              void reload().catch(() =>
                setMessage("La tienda no respondió. Reintenta en un momento."),
              )
            }
          >
            Volver a consultar horario
          </button>
          <p role="alert">{message}</p>
        </section>
      )}
      <StaffUsers embedded />
      <Clients api={api} reload={reload} />
      <AuditSettings api={api} />
    </>
  );
}
function Clients({ api, reload }: { api: Api; reload: () => Promise<void> }) {
  const [list, setList] = useState<
      { id: string; name: string; contact: string; version: number }[]
    >([]),
    [edit, setEdit] = useState<{
      id?: string;
      name: string;
      contact: string;
      version?: number;
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setList(await api("/clients"));
  }
  useEffect(() => {
    void load().catch(() => setMessage("No se pudieron consultar clientes"));
  }, []);
  return (
    <section className="panel">
      <h2>Clientes</h2>
      <p>
        Nombre y referencia opcional. Las ventas conservan el nombre registrado
        aunque lo edites después.
      </p>
      {list.map((c) => (
        <div className="cartline" key={c.id}>
          <div>
            <strong>{c.name}</strong>
            <small>{c.contact}</small>
          </div>
          <button onClick={() => setEdit(c)}>Editar</button>
        </div>
      ))}
      <button onClick={() => setEdit({ name: "", contact: "" })}>
        + Nuevo cliente
      </button>
      <p role="status">{message}</p>
      {edit && (
        <Modal
          title={edit.id ? "Editar cliente" : "Nuevo cliente"}
          close={() => setEdit(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              const { id, ...data } = edit;
              void api(id ? "/clients/" + id : "/clients", {
                method: id ? "PUT" : "POST",
                headers: { "Idempotency-Key": crypto.randomUUID() },
                body: JSON.stringify(data),
              })
                .then(load)
                .then(reload)
                .then(() => setEdit(null))
                .catch((e) => setMessage(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Nombre
              <input
                required
                maxLength={100}
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              Referencia / contacto (opcional)
              <input
                maxLength={100}
                value={edit.contact}
                onChange={(e) => setEdit({ ...edit, contact: e.target.value })}
              />
            </label>
            <p role="alert">{message}</p>
            <button className="primary" disabled={busy}>
              Guardar cliente
            </button>
            <button type="button" onClick={() => setEdit(null)}>
              Cancelar
            </button>
          </form>
        </Modal>
      )}
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
      <button onClick={() => void load()}>Actualizar movimientos</button>
      {rows.map((r) => (
        <article className="audit" key={r.id}>
          <strong>
            {r.kind === "stock.adjusted"
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
