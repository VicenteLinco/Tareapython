// frontend/src/pages/recepciones/components/labels-section.tsx
import { useState, type CSSProperties } from "react";
import {
  Printer,
  ChevronDown,
  ChevronUp,
  Settings,
  ScrollText,
  FileText,
} from "lucide-react";
import { CantidadConUnidad } from "@/components/ui/cantidad";
import { Button } from "@/components/ui/button";
import { imprimirEtiquetas, type LoteParaEtiqueta } from "@/lib/label-print";
import { notify } from "@/lib/notify";
import type { DetalleLineUI } from "./item-card";
import { isLoteComplete } from "./item-card-utils";

interface Props {
  // Fase 1: durante el llenado del formulario
  detalles?: DetalleLineUI[];
  onToggleEtiqueta?: (
    detalleId: string,
    loteId: string,
    incluir: boolean,
  ) => void;
  onCantidadEtiqueta?: (
    detalleId: string,
    loteId: string,
    cant: number,
  ) => void;
  // Fase 2: tras confirmar — imprime con los lotes reales del servidor
  lotesConfirmados?: LoteParaEtiqueta[];
  onAfterPrint?: () => void;
}

export function LabelsSection({
  detalles,
  onToggleEtiqueta,
  onCantidadEtiqueta,
  lotesConfirmados,
  onAfterPrint,
}: Props) {
  const [imprimiendo, setImprimiendo] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // ── Fase post-confirmación (Estados de Configuración) ─────────────────────
  const [formato, setFormato] = useState<"rollo" | "hoja">("rollo");
  const [rolloTamano, setRolloTamano] = useState<
    "50x25" | "40x30" | "60x40" | "80x50" | "personalizado"
  >("50x25");
  const [rolloAnchoCustom, setRolloAnchoCustom] = useState(50);
  const [rolloAltoCustom, setRolloAltoCustom] = useState(25);

  const [hojaTamano, setHojaTamano] = useState<"carta" | "oficio" | "a4">(
    "carta",
  );
  const [hojaDiseno, setHojaDiseno] = useState<
    "3x10" | "3x8" | "4x10" | "personalizado"
  >("3x10");
  const [hojaColumnas, setHojaColumnas] = useState(3);
  const [hojaFilas, setHojaFilas] = useState(10);
  const [posicionInicial, setPosicionInicial] = useState(1);

  const [modoColor, setModoColor] = useState<"bn_termica" | "color">("bn_termica");
  const [mostrarBordes, setMostrarBordes] = useState(true);
  const [configAvanzada, setConfigAvanzada] = useState(false);

  // Márgenes avanzados (mm)
  const [margenY, setMargenY] = useState(10);
  const [margenX, setMargenX] = useState(10);
  const [espacioX, setEspacioX] = useState(2);
  const [espacioY, setEspacioY] = useState(2);

  // Cantidad de etiquetas por lote (editable). Se seedea una vez desde los lotes
  // confirmados (preset = cantidad recibida) y queda editable antes de imprimir.
  const [cantidades, setCantidades] = useState<number[]>(() =>
    (lotesConfirmados ?? []).map((l) =>
      Math.max(1, Math.round(l.cantidad_etiquetas)),
    ),
  );

  // ── Fase post-confirmación ────────────────────────────────────────────────
  if (lotesConfirmados) {
    const cantidadDe = (i: number) =>
      cantidades[i] ??
      Math.max(1, Math.round(lotesConfirmados[i].cantidad_etiquetas));
    const total = lotesConfirmados.reduce((s, _l, i) => s + cantidadDe(i), 0);

    const setCantidad = (i: number, val: number) => {
      const safe = Math.max(1, Math.min(999, Math.round(val) || 1));
      setCantidades((prev) => {
        const next = lotesConfirmados.map(
          (_l, idx) => prev[idx] ?? cantidadDe(idx),
        );
        next[i] = safe;
        return next;
      });
    };

    const handlePrint = async () => {
      setImprimiendo(true);
      try {
        await imprimirEtiquetas(
          lotesConfirmados.map((l, i) => ({
            ...l,
            cantidad_etiquetas: cantidadDe(i),
          })),
          {
            formato,
            rolloTamano,
            rolloAnchoCustom,
            rolloAltoCustom,
            hojaTamano,
            hojaDiseno,
            hojaColumnas,
            hojaFilas,
            posicionInicial,
            modoColor,
            mostrarBordes,
            margenY,
            margenX,
            espacioX,
            espacioY,
          },
        );
        onAfterPrint?.();
      } catch {
        notify.error("Error al generar etiquetas");
      } finally {
        setImprimiendo(false);
      }
    };

    // Cálculos para la vista previa
    const cols =
      hojaDiseno === "3x10"
        ? 3
        : hojaDiseno === "3x8"
          ? 3
          : hojaDiseno === "4x10"
            ? 4
            : hojaColumnas;
    const rows =
      hojaDiseno === "3x10"
        ? 10
        : hojaDiseno === "3x8"
          ? 8
          : hojaDiseno === "4x10"
            ? 10
            : hojaFilas;
    const totalSlots = cols * rows;
    const skipped = Math.min(totalSlots - 1, Math.max(0, posicionInicial - 1));
    const printed = total;

    const previewCells: ("skipped" | "printed" | "empty")[] = [];
    for (let i = 0; i < totalSlots; i++) {
      if (i < skipped) {
        previewCells.push("skipped");
      } else if (i < skipped + printed) {
        previewCells.push("printed");
      } else {
        previewCells.push("empty");
      }
    }

    const sheetWidth =
      hojaTamano === "carta" ? 215.9 : hojaTamano === "oficio" ? 216 : 210;
    const sheetHeight =
      hojaTamano === "carta" ? 279.4 : hojaTamano === "oficio" ? 330 : 297;
    const totalPages = Math.ceil((printed + skipped) / totalSlots);

    return (
      <div className="space-y-4">
        {/* Selector de Formato */}
        <div className="grid grid-cols-2 gap-2 bg-base-200 p-1 rounded-xl">
          <button
            type="button"
            className={`btn btn-sm border-none shadow-none rounded-lg text-xs font-bold transition-all gap-1.5 ${
              formato === "rollo"
                ? "bg-primary text-primary-content hover:bg-primary/95"
                : "bg-transparent text-base-content/60 hover:bg-base-300"
            }`}
            onClick={() => {
              setFormato("rollo");
              setMostrarBordes(true);
            }}
          >
            <ScrollText className="h-3.5 w-3.5" />
            Rollo de etiquetas
          </button>
          <button
            type="button"
            className={`btn btn-sm border-none shadow-none rounded-lg text-xs font-bold transition-all gap-1.5 ${
              formato === "hoja"
                ? "bg-primary text-primary-content hover:bg-primary/95"
                : "bg-transparent text-base-content/60 hover:bg-base-300"
            }`}
            onClick={() => {
              setFormato("hoja");
              setMostrarBordes(false); // Por defecto sin bordes para precortadas
            }}
          >
            <FileText className="h-3.5 w-3.5" />
            Hoja común
          </button>
        </div>

        {/* Selector de Modo de Impresora (B/N vs Color) */}
        <div className="flex items-center justify-between gap-2 p-2.5 bg-base-200/60 rounded-xl border border-base-200">
          <span className="text-xs font-bold text-base-content/80">Modo de Tinta / Impresora:</span>
          <div className="join">
            <button
              type="button"
              className={`join-item btn btn-xs font-bold ${modoColor === "bn_termica" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setModoColor("bn_termica")}
            >
              🖨️ B/N Térmica Chica (Alto Contraste)
            </button>
            <button
              type="button"
              className={`join-item btn btn-xs font-bold ${modoColor === "color" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setModoColor("color")}
            >
              🎨 Color Hojas PDF
            </button>
          </div>
        </div>

        {/* Panel de Configuración */}
        <div className="card bg-base-100 border border-base-200 p-4 space-y-4 shadow-sm">
          {formato === "rollo" ? (
            <div className="space-y-3">
              <p className="font-semibold text-xs text-base-content/50 uppercase tracking-wider">
                Configuración de Rollo
              </p>

              <div>
                <label className="label-text font-semibold text-xs text-base-content/80 mb-1 block">
                  Tamaño de etiqueta
                </label>
                <select
                  className="select select-sm select-bordered w-full text-xs rounded-lg"
                  value={rolloTamano}
                  onChange={(e) => setRolloTamano(e.target.value as any)}
                >
                  <option value="50x25">50 x 25 mm (Estándar)</option>
                  <option value="40x30">40 x 30 mm</option>
                  <option value="60x40">60 x 40 mm</option>
                  <option value="80x50">80 x 50 mm</option>
                  <option value="personalizado">Personalizado…</option>
                </select>
              </div>

              {rolloTamano === "personalizado" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                  <div>
                    <label className="label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block">
                      Ancho (mm)
                    </label>
                    <input
                      type="number"
                      min={20}
                      max={150}
                      className="input input-sm input-bordered w-full text-xs rounded-lg"
                      value={rolloAnchoCustom}
                      onChange={(e) =>
                        setRolloAnchoCustom(
                          Math.max(20, Number(e.target.value)),
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block">
                      Alto (mm)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={100}
                      className="input input-sm input-bordered w-full text-xs rounded-lg"
                      value={rolloAltoCustom}
                      onChange={(e) =>
                        setRolloAltoCustom(Math.max(15, Number(e.target.value)))
                      }
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer mt-1 select-none">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs checkbox-primary rounded"
                  checked={mostrarBordes}
                  onChange={(e) => setMostrarBordes(e.target.checked)}
                />
                <span className="text-xs text-base-content/85">
                  Mostrar contorno de etiqueta
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-semibold text-xs text-base-content/50 uppercase tracking-wider">
                Configuración de Hoja
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                <div>
                  <label className="label-text font-semibold text-xs text-base-content/80 mb-1 block">
                    Tamaño de papel
                  </label>
                  <select
                    className="select select-sm select-bordered w-full text-xs rounded-lg"
                    value={hojaTamano}
                    onChange={(e) => setHojaTamano(e.target.value as any)}
                  >
                    <option value="carta">Carta / Letter</option>
                    <option value="oficio">Oficio (216 x 330 mm)</option>
                    <option value="a4">A4</option>
                  </select>
                </div>
                <div>
                  <label className="label-text font-semibold text-xs text-base-content/80 mb-1 block">
                    Distribución (Grilla)
                  </label>
                  <select
                    className="select select-sm select-bordered w-full text-xs rounded-lg"
                    value={hojaDiseno}
                    onChange={(e) => {
                      const val = e.target.value as any;
                      setHojaDiseno(val);
                      // Resetear posición inicial si es mayor que la nueva grilla
                      const newCols =
                        val === "3x10"
                          ? 3
                          : val === "3x8"
                            ? 3
                            : val === "4x10"
                              ? 4
                              : hojaColumnas;
                      const newRows =
                        val === "3x10"
                          ? 10
                          : val === "3x8"
                            ? 8
                            : val === "4x10"
                              ? 10
                              : hojaFilas;
                      setPosicionInicial((p) => Math.min(newCols * newRows, p));
                    }}
                  >
                    <option value="3x10">3 x 10 (30 etiq. Avery)</option>
                    <option value="3x8">3 x 8 (24 etiq. Avery)</option>
                    <option value="4x10">4 x 10 (40 etiq.)</option>
                    <option value="personalizado">Personalizado…</option>
                  </select>
                </div>
              </div>

              {hojaDiseno === "personalizado" && (
                <div className="grid grid-cols-2 gap-2 bg-base-200/50 p-2 rounded-lg">
                  <div>
                    <label className="label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block">
                      Columnas
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      className="input input-sm input-bordered w-full text-xs rounded-lg"
                      value={hojaColumnas}
                      onChange={(e) => {
                        const c = Math.max(1, Number(e.target.value));
                        setHojaColumnas(c);
                        setPosicionInicial((p) => Math.min(c * rows, p));
                      }}
                    />
                  </div>
                  <div>
                    <label className="label-text font-semibold text-[10px] text-base-content/70 mb-0.5 block">
                      Filas
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      className="input input-sm input-bordered w-full text-xs rounded-lg"
                      value={hojaFilas}
                      onChange={(e) => {
                        const r = Math.max(1, Number(e.target.value));
                        setHojaFilas(r);
                        setPosicionInicial((p) => Math.min(cols * r, p));
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 items-end">
                <div>
                  <label
                    className="label-text font-semibold text-xs text-base-content/80 mb-1 block"
                    title="Omitir las primeras N etiquetas si ya fueron usadas"
                  >
                    📍 Iniciar en posición
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={totalSlots}
                    className="input input-sm input-bordered w-full text-xs rounded-lg font-semibold text-center"
                    value={posicionInicial}
                    onChange={(e) =>
                      setPosicionInicial(
                        Math.min(
                          totalSlots,
                          Math.max(1, Number(e.target.value)),
                        ),
                      )
                    }
                  />
                </div>
                <div className="pb-1">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary rounded"
                      checked={mostrarBordes}
                      onChange={(e) => setMostrarBordes(e.target.checked)}
                    />
                    <span className="text-xs text-base-content/85">
                      Líneas guía de corte
                    </span>
                  </label>
                </div>
              </div>

              {/* Ajustes avanzados de márgenes */}
              <div className="border-t border-base-200 pt-2">
                <button
                  type="button"
                  onClick={() => setConfigAvanzada(!configAvanzada)}
                  className="flex items-center gap-1 text-xs font-bold text-primary hover:underline cursor-pointer"
                >
                  <Settings className="h-3 w-3" />
                  {configAvanzada
                    ? "Ocultar márgenes avanzados"
                    : "Configurar márgenes avanzados (mm)"}
                </button>

                {configAvanzada && (
                  <div className="grid grid-cols-4 gap-1.5 mt-2 bg-base-200/40 p-2 rounded-lg text-[10px]">
                    <div>
                      <span className="opacity-75 block mb-0.5">
                        Marg. Vert.
                      </span>
                      <input
                        type="number"
                        step={0.5}
                        className="input input-xs input-bordered w-full text-center text-base-content"
                        value={margenY}
                        onChange={(e) => setMargenY(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <span className="opacity-75 block mb-0.5">
                        Marg. Horiz.
                      </span>
                      <input
                        type="number"
                        step={0.5}
                        className="input input-xs input-bordered w-full text-center text-base-content"
                        value={margenX}
                        onChange={(e) => setMargenX(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <span className="opacity-75 block mb-0.5">Espacio X</span>
                      <input
                        type="number"
                        step={0.5}
                        className="input input-xs input-bordered w-full text-center text-base-content"
                        value={espacioX}
                        onChange={(e) => setEspacioX(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <span className="opacity-75 block mb-0.5">Espacio Y</span>
                      <input
                        type="number"
                        step={0.5}
                        className="input input-xs input-bordered w-full text-center text-base-content"
                        value={espacioY}
                        onChange={(e) => setEspacioY(Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Vista previa visual (Solo en formato Hoja) */}
        {formato === "hoja" && (
          <div className="border border-base-200 rounded-xl p-3 bg-base-50 flex flex-col items-center shadow-inner">
            <p className="text-xs font-bold mb-2 text-base-content/60 uppercase tracking-wider">
              Vista previa: Primera Hoja ({cols}x{rows})
            </p>
            <div
              className="bg-white border border-base-300 shadow-md rounded overflow-hidden relative"
              style={{
                width: "180px",
                aspectRatio: `${sheetWidth} / ${sheetHeight}`,
                padding: `${(margenY / sheetHeight) * 180}px ${(margenX / sheetWidth) * 180}px`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, 1fr)`,
                gridTemplateRows: `repeat(${rows}, 1fr)`,
                gap: `${(espacioY / sheetHeight) * 180}px ${(espacioX / sheetWidth) * 180}px`,
                boxSizing: "border-box",
              }}
            >
              {previewCells.map((type, idx) => {
                let cellStyle: CSSProperties = {
                  width: "100%",
                  height: "100%",
                  boxSizing: "border-box",
                  borderRadius: "1px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                };

                if (type === "skipped") {
                  cellStyle = {
                    ...cellStyle,
                    background:
                      "repeating-linear-gradient(45deg, #f3f4f6, #f3f4f6 3px, #e5e7eb 3px, #e5e7eb 6px)",
                    border: "0.5px solid #d1d5db",
                  };
                } else if (type === "printed") {
                  cellStyle = {
                    ...cellStyle,
                    backgroundColor: "rgba(59, 130, 246, 0.15)",
                    border: "0.5px solid rgba(59, 130, 246, 0.5)",
                  };
                } else {
                  cellStyle = {
                    ...cellStyle,
                    backgroundColor: "#fff",
                    border: "0.5px dashed #e5e7eb",
                  };
                }

                return (
                  <div
                    key={idx}
                    style={cellStyle}
                    title={`Posición ${idx + 1}: ${
                      type === "skipped"
                        ? "Usada/Omitida"
                        : type === "printed"
                          ? "Etiqueta"
                          : "Vacía"
                    }`}
                  >
                    {type === "printed" && (
                      <span className="text-[8px] scale-75 leading-none opacity-80">
                        🏷️
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-base-content/50 mt-2 font-medium">
              Se{" "}
              {totalPages === 1 ? "usará 1 hoja" : `usarán ${totalPages} hojas`}{" "}
              en total. ({printed} etiquetas).
            </p>
          </div>
        )}

        {/* Resumen editable: cantidad de etiquetas por lote */}
        <div className="bg-base-200/50 rounded-xl p-3 text-xs space-y-1.5 border border-base-200">
          <p className="font-semibold text-base-content/80 mb-2">
            🏷️ Etiquetas a imprimir:
          </p>
          <div className="max-h-48 overflow-y-auto divide-y divide-base-200/80 pr-1">
            {lotesConfirmados.map((l, i) => (
              <div
                key={`${l.lote_id}-${i}`}
                className="flex items-center gap-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-base-content/80">
                    {l.producto_nombre}
                  </p>
                  <p className="font-mono text-[10px] text-base-content/50 truncate">
                    Lote: {l.numero_lote}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    className="btn btn-xs btn-circle btn-ghost"
                    aria-label="Quitar una etiqueta"
                    onClick={() => setCantidad(i, cantidadDe(i) - 1)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={999}
                    className="input input-xs input-bordered w-14 text-center font-semibold"
                    value={cantidadDe(i)}
                    onChange={(e) => setCantidad(i, Number(e.target.value))}
                  />
                  <button
                    type="button"
                    className="btn btn-xs btn-circle btn-ghost"
                    aria-label="Agregar una etiqueta"
                    onClick={() => setCantidad(i, cantidadDe(i) + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Botón de Impresión */}
        <Button
          className="w-full btn-md text-sm font-bold shadow-lg"
          onClick={handlePrint}
          disabled={imprimiendo}
        >
          <Printer className="h-4 w-4 mr-2" />
          {imprimiendo ? (
            "Generando etiquetas…"
          ) : (
            <span>
              Imprimir{" "}
              <CantidadConUnidad
                qty={total}
                unidad="etiqueta"
                pluralUnidad="etiquetas"
              />
            </span>
          )}
        </Button>
      </div>
    );
  }

  // ── Fase pre-confirmación ─────────────────────────────────────────────────
  if (!detalles || detalles.length === 0) return null;

  // Aplanar lotes de todos los detalles
  const lotesCompletos = detalles.flatMap((d) =>
    d.lotes
      .filter((l) => isLoteComplete(l) && d.area_destino_id)
      .map((l) => ({
        ...l,
        detalleId: d.id,
        producto_nombre: d.producto_nombre,
        area_destino_nombre: d.area_destino_nombre,
      })),
  );

  const lotesIncompletos = detalles.flatMap((d) =>
    d.lotes
      .filter((l) => !isLoteComplete(l) || !d.area_destino_id)
      .map((l) => ({
        ...l,
        detalleId: d.id,
        producto_nombre: d.producto_nombre,
      })),
  );

  if (lotesCompletos.length === 0) return null;

  const totalEtiquetas = lotesCompletos
    .filter((l) => l.incluir_etiqueta)
    .reduce((s, l) => s + l.cantidad_etiquetas, 0);

  return (
    <div className="card bg-base-100 border border-dashed p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-sm">🏷️ Configurar etiquetas</p>
        <button
          className="btn btn-ghost btn-xs btn-circle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expandir" : "Colapsar"}
        >
          {collapsed ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronUp className="h-4 w-4" />
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-2">
          {lotesCompletos.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200 text-sm"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={l.incluir_etiqueta}
                onChange={(e) =>
                  onToggleEtiqueta?.(l.detalleId, l.id, e.target.checked)
                }
              />
              <span className="flex-1 truncate text-xs">
                {l.producto_nombre}
              </span>
              <span className="text-xs opacity-50 font-mono truncate">
                {l.codigo_lote}
                {l.fecha_vencimiento ? ` · ${l.fecha_vencimiento}` : ""}
                {l.area_destino_nombre ? ` · ${l.area_destino_nombre}` : ""}
              </span>
              {l.incluir_etiqueta && (
                <input
                  type="number"
                  min={1}
                  max={99}
                  className="input input-xs input-bordered w-14 text-center"
                  value={l.cantidad_etiquetas}
                  onChange={(e) =>
                    onCantidadEtiqueta?.(
                      l.detalleId,
                      l.id,
                      Math.max(1, Number(e.target.value)),
                    )
                  }
                />
              )}
            </div>
          ))}

          {lotesIncompletos.map((l) => (
            <div
              key={l.id}
              className="opacity-40 cursor-not-allowed flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                disabled
              />
              <span className="flex-1 text-sm">{l.producto_nombre}</span>
              <span className="badge badge-xs badge-ghost">
                Datos incompletos
              </span>
            </div>
          ))}
        </div>
      )}

      {totalEtiquetas > 0 && (
        <p className="text-xs opacity-50 mt-2 text-right">
          <CantidadConUnidad
            qty={totalEtiquetas}
            unidad="etiqueta"
            pluralUnidad="etiquetas"
          />{" "}
          se imprimirán al confirmar
        </p>
      )}
    </div>
  );
}
