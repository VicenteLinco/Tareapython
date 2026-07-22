// frontend/src/pages/recepciones/components/item-card.tsx
import { useState } from "react";
import { Trash2, ChevronDown, ChevronUp, Plus, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductoImage } from "@/components/ui/producto-image";
import { formatCantidad, APP_LOCALE } from "@/lib/utils";
import type { Area, Presentacion, ControlLote } from "@/types";
import { isCardComplete } from "./item-card-utils";

// ─── Interfaces públicas ──────────────────────────────────────────────────────

export interface LoteLineUI {
  id: string;
  codigo_lote: string;
  fecha_vencimiento: string;
  cantidad_presentacion: number;
  incluir_etiqueta: boolean;
  cantidad_etiquetas: number;
  alerta_vencimiento?: boolean;
  desperdicio_proyectado?: string | number;
}

export interface DetalleLineUI {
  id: string;
  producto_id: string;
  producto_nombre: string;
  codigo_interno: string;
  presentacion_id: number | null;
  presentacion_nombre: string;
  presentacion_nombre_plural: string;
  factor_conversion: number;
  unidad_base_nombre: string;
  unidad_base_nombre_plural: string;
  area_destino_id: number | null;
  area_destino_nombre: string;
  presentaciones: Presentacion[];
  precio_unitario: string;
  precio_anterior?: string;
  precio_base?: string;
  imagen_url?: string | null;
  cantidad_solicitada?: number | null;
  lotes: LoteLineUI[];
  collapsed: boolean;
  control_lote: ControlLote;
  estado_catalogo?: "pendiente_aprobacion" | "aprobado";
}

interface Props {
  detalle: DetalleLineUI;
  areas: Area[];
  onChange: (id: string, patch: Partial<Omit<DetalleLineUI, "lotes">>) => void;
  onChangeLote: (
    detalleId: string,
    loteId: string,
    patch: Partial<LoteLineUI>,
  ) => void;
  onAddLote: (detalleId: string) => void;
  onRemoveLote: (detalleId: string, loteId: string) => void;
  onRemove: (id: string) => void;
  monedaSimbolo?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrecioDisplay(raw: string, simbolo: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return `${simbolo}${Number(digits).toLocaleString(APP_LOCALE)}`;
}

// ─── Sub-componente: fila de lote ─────────────────────────────────────────────

interface LoteRowProps {
  lote: LoteLineUI;
  index: number;
  presentacion_nombre: string;
  presentacion_nombre_plural: string;
  unidad_base_nombre: string;
  unidad_base_nombre_plural: string;
  canDelete: boolean;
  control_lote: ControlLote;
  onChange: (patch: Partial<LoteLineUI>) => void;
  onDelete: () => void;
  onAddLote?: () => void;
}

function LoteRow({
  lote,
  index,
  presentacion_nombre,
  presentacion_nombre_plural,
  unidad_base_nombre,
  unidad_base_nombre_plural,
  canDelete,
  control_lote,
  onChange,
  onDelete,
  onAddLote,
}: LoteRowProps) {
  const [modoMes, setModoMes] = useState(false);

  const unitLabel =
    lote.cantidad_presentacion === 1
      ? presentacion_nombre || unidad_base_nombre
      : presentacion_nombre_plural ||
        unidad_base_nombre_plural ||
        presentacion_nombre ||
        unidad_base_nombre;

  const handleFechaChange = (value: string) => {
    if (modoMes) {
      // value es YYYY-MM; almacenar como último día del mes
      const [y, m] = value.split("-").map(Number);
      if (!y || !m) return;
      const lastDay = new Date(y, m, 0).getDate();
      onChange({
        fecha_vencimiento: `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      });
    } else {
      onChange({ fecha_vencimiento: value });
    }
  };

  const fechaDisplayValue = modoMes
    ? lote.fecha_vencimiento
      ? lote.fecha_vencimiento.slice(0, 7)
      : ""
    : lote.fecha_vencimiento;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center gap-2">
        <span className="text-xs opacity-30 w-4 text-right shrink-0">
          {index + 1}
        </span>
        {control_lote !== "simple" && (
          <>
            <input
              className={`input input-sm input-bordered w-28 shrink-0 font-mono ${!lote.codigo_lote ? "input-warning" : ""}`}
              placeholder="Nº lote"
              value={lote.codigo_lote}
              onChange={(e) => onChange({ codigo_lote: e.target.value })}
            />
            <div className="flex items-center gap-1 w-44 shrink-0">
              {modoMes ? (
                <input
                  type="month"
                  className={`input input-sm input-bordered flex-1 min-w-0 ${!lote.fecha_vencimiento ? "input-warning" : ""}`}
                  value={fechaDisplayValue}
                  onChange={(e) => handleFechaChange(e.target.value)}
                />
              ) : (
                <input
                  type="date"
                  className={`input input-sm input-bordered flex-1 min-w-0 ${!lote.fecha_vencimiento ? "input-warning" : ""}`}
                  value={fechaDisplayValue}
                  onChange={(e) => handleFechaChange(e.target.value)}
                />
              )}
              <button
                type="button"
                className={`btn btn-xs btn-ghost px-1.5 shrink-0 gap-0.5 ${modoMes ? "text-primary" : "opacity-35 hover:opacity-70"}`}
                title={
                  modoMes
                    ? "Cambiar a fecha exacta (D/M/A)"
                    : "Ingresar solo mes/año"
                }
                onClick={() => setModoMes((v) => !v)}
              >
                <Calendar className="h-3 w-3" />
                <span className="text-[10px] font-bold leading-none">
                  {modoMes ? "M/A" : "D"}
                </span>
              </button>
            </div>
          </>
        )}
        <input
          type="number"
          min={1}
          className="input input-sm input-bordered w-16 shrink-0"
          value={lote.cantidad_presentacion}
          onChange={(e) =>
            onChange({ cantidad_presentacion: Number(e.target.value) || 1 })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddLote?.();
            }
          }}
        />
        <span
          className="text-xs opacity-50 flex-1 min-w-0 truncate"
          title={unitLabel}
        >
          {unitLabel}
        </span>
        {canDelete && control_lote !== "simple" ? (
          <button
            className="btn btn-ghost btn-xs btn-circle shrink-0"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3 text-error" />
          </button>
        ) : (
          <div className="w-6 shrink-0" />
        )}
      </div>

      {lote.alerta_vencimiento && (
        <div className="ml-6 mr-6 p-2 rounded-lg bg-warning/10 border border-warning/20 text-warning text-[11px] leading-normal flex items-start gap-1.5 animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-warning mt-1.5 shrink-0 animate-pulse" />
          <div>
            <span className="font-semibold">Advertencia de vencimiento: </span>
            <span>
              Este lote vencerá antes de consumirse por completo. Desperdicio estimado:{" "}
              {typeof lote.desperdicio_proyectado === "string"
                ? parseFloat(lote.desperdicio_proyectado).toFixed(1)
                : Number(lote.desperdicio_proyectado || 0).toFixed(1)}
              %.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function ReceptionItemCard({
  detalle: d,
  areas,
  onChange,
  onChangeLote,
  onAddLote,
  onRemoveLote,
  onRemove,
  monedaSimbolo = "$",
}: Props) {
  const [precioFocus, setPrecioFocus] = useState(false);

  const complete = isCardComplete(d);
  const totalCantidad = d.lotes.reduce(
    (s, l) => s + l.cantidad_presentacion,
    0,
  );
  const rawPrecio = d.precio_unitario.replace(/\D/g, "");

  const unidadResumen = formatCantidad(
    totalCantidad,
    d.presentacion_nombre || d.unidad_base_nombre,
    d.presentacion_nombre_plural || d.unidad_base_nombre_plural,
  );

  // Tooltip de advertencia con campos faltantes
  const missingFields: string[] = [];
  if (!d.area_destino_id) missingFields.push("área");
  if (d.lotes.some((l) => !l.codigo_lote)) missingFields.push("nº lote");
  if (d.lotes.some((l) => !l.fecha_vencimiento))
    missingFields.push("vencimiento");
  const badgeTooltip = missingFields.length
    ? `Falta: ${missingFields.join(", ")}`
    : "Completo";

  // Resumen colapsado: mostrar número de lote cuando hay uno solo
  const resumenLotes =
    d.lotes.length === 1
      ? d.lotes[0].codigo_lote
        ? `Lote ${d.lotes[0].codigo_lote}`
        : "1 lote"
      : `${d.lotes.length} lotes`;

  // Progreso vs cantidad solicitada
  const hasSolicitud =
    d.cantidad_solicitada != null && d.cantidad_solicitada > 0;
  const progresoOk = hasSolicitud && totalCantidad >= d.cantidad_solicitada!;

  return (
    <div
      className={`card bg-base-100 border transition-colors ${
        complete ? "border-success/40" : "border-warning/40"
      }`}
    >
      {/* ── Header (siempre visible) ── */}
      <div className="flex items-center gap-3 p-4 group">
        <ProductoImage src={d.imagen_url} size="md" className="shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-sm truncate">
              {d.producto_nombre}
            </p>
            {d.estado_catalogo === "pendiente_aprobacion" && (
              <span className="badge badge-sm badge-warning font-semibold gap-1 text-[10px]">
                ⚠️ En cuarentena (Pendiente de aprobación)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            {d.codigo_interno && (
              <span className="text-xs opacity-50 font-mono">
                {d.codigo_interno}
              </span>
            )}
            {d.area_destino_id ? (
              <span className="badge badge-sm badge-ghost">
                {d.area_destino_nombre}
              </span>
            ) : (
              <span className="badge badge-sm badge-warning">⚠ Sin área</span>
            )}
            {hasSolicitud && (
              <span
                className={`text-xs font-mono tabular-nums ${progresoOk ? "text-success" : "text-info"}`}
              >
                {totalCantidad}/{d.cantidad_solicitada}{" "}
                {totalCantidad === 1
                  ? d.presentacion_nombre || d.unidad_base_nombre
                  : d.presentacion_nombre_plural || d.unidad_base_nombre_plural}
              </span>
            )}
          </div>
          {/* Resumen colapsado */}
          {d.collapsed && (
            <p className="text-xs opacity-50 mt-0.5">
              {resumenLotes}
              {" · "}
              {unidadResumen}
              {rawPrecio
                ? ` · ${formatPrecioDisplay(rawPrecio, monedaSimbolo)}`
                : ""}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span
            className={`badge badge-xs ${complete ? "badge-success" : "badge-warning"}`}
            title={badgeTooltip}
          >
            {complete ? "✓ Listo" : "⚠"}
          </span>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={() => onChange(d.id, { collapsed: !d.collapsed })}
            aria-label={d.collapsed ? "Expandir" : "Colapsar"}
          >
            {d.collapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="opacity-60 hover:opacity-100 transition-opacity"
            title="Quitar producto"
            onClick={() => onRemove(d.id)}
          >
            <Trash2 className="h-4 w-4 text-error" />
          </Button>
        </div>
      </div>

      {/* ── Contenido expandido ── */}
      {!d.collapsed && (
        <div className="border-t border-base-200 px-4 py-3 space-y-3 animate-in fade-in-0 duration-150">
          {/* Selector de área — siempre en el cuerpo expandido */}
          <div className="flex items-center gap-2">
            <label className="text-xs opacity-60 shrink-0 w-20">
              Área destino:
            </label>
            <select
              className={`select select-bordered select-xs flex-1 ${!d.area_destino_id ? "select-warning" : ""}`}
              value={d.area_destino_id ?? ""}
              onChange={(e) => {
                const aid = Number(e.target.value);
                if (!aid) return;
                const nombre = areas.find((a) => a.id === aid)?.nombre ?? "";
                onChange(d.id, {
                  area_destino_id: aid,
                  area_destino_nombre: nombre,
                });
              }}
            >
              <option value="">Seleccionar área…</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de presentación (solo si hay más de una) */}
          {d.presentaciones.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-xs opacity-60 shrink-0 w-20">
                Presentación:
              </label>
              <select
                className="select select-bordered select-xs flex-1"
                value={d.presentacion_id ?? ""}
                onChange={(e) => {
                  const pid = Number(e.target.value);
                  const pres = d.presentaciones.find((p) => p.id === pid);
                  if (!pres) return;
                  onChange(d.id, {
                    presentacion_id: pres.id,
                    presentacion_nombre: pres.nombre,
                    presentacion_nombre_plural: pres.nombre_plural ?? "",
                    factor_conversion: Number(pres.factor_conversion),
                  });
                }}
              >
                {d.presentaciones.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Cabecera de columnas */}
          <div className="flex items-center gap-2 text-xs opacity-40 pb-0.5">
            <span className="w-4 shrink-0" />
            {d.control_lote !== "simple" && (
              <>
                <span className="w-28 shrink-0">Lote</span>
                <span className="w-44 shrink-0">Vencimiento</span>
              </>
            )}
            <span className="w-16 shrink-0">Cantidad</span>
            <span className="flex-1 min-w-0">Unidad</span>
            <span className="w-6 shrink-0" />
          </div>

          {/* Filas de lotes */}
          <div className="space-y-2">
            {d.lotes.map((l, i) => (
              <LoteRow
                key={l.id}
                lote={l}
                index={i}
                presentacion_nombre={d.presentacion_nombre}
                presentacion_nombre_plural={d.presentacion_nombre_plural}
                unidad_base_nombre={d.unidad_base_nombre}
                unidad_base_nombre_plural={d.unidad_base_nombre_plural}
                canDelete={d.lotes.length > 1}
                control_lote={d.control_lote}
                onChange={(patch) => onChangeLote(d.id, l.id, patch)}
                onDelete={() => onRemoveLote(d.id, l.id)}
                onAddLote={() => onAddLote(d.id)}
              />
            ))}
          </div>

          {/* Agregar lote */}
          {d.control_lote !== "simple" && (
            <button
              className="btn btn-sm btn-ghost btn-outline w-full border-dashed text-xs gap-1"
              onClick={() => onAddLote(d.id)}
            >
              <Plus className="h-3 w-3" />
              Agregar otro lote
            </button>
          )}

          {/* Precio unitario */}
          <div className="flex items-center gap-2 pt-2 border-t border-base-200 flex-wrap">
            <label className="text-xs opacity-60 shrink-0">Precio unit.:</label>
            <input
              type="text"
              inputMode="numeric"
              className="input input-sm input-bordered w-36 font-mono"
              placeholder={`${monedaSimbolo}0`}
              value={
                precioFocus
                  ? rawPrecio
                  : rawPrecio
                    ? formatPrecioDisplay(rawPrecio, monedaSimbolo)
                    : ""
              }
              onFocus={() => setPrecioFocus(true)}
              onBlur={() => setPrecioFocus(false)}
              onChange={(e) =>
                onChange(d.id, {
                  precio_unitario: e.target.value.replace(/\D/g, ""),
                })
              }
            />
            {d.precio_anterior &&
              (d.precio_unitario === d.precio_anterior ? (
                <span className="text-xs text-success font-medium flex items-center gap-1.5 bg-success/5 px-2 py-0.5 rounded border border-success/10">
                  <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
                  Precio anterior
                </span>
              ) : (
                <span
                  className="text-xs text-warning font-medium flex items-center gap-1.5 bg-warning/5 px-2 py-0.5 rounded border border-warning/10"
                  title={`Precio anterior: ${formatPrecioDisplay(d.precio_anterior, monedaSimbolo)}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse"></span>
                  Modificado (Anterior:{" "}
                  {formatPrecioDisplay(d.precio_anterior, monedaSimbolo)})
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
