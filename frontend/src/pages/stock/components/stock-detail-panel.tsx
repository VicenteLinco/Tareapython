import { ChevronRight, Package } from "lucide-react";
import { StockDetail } from "../stock-detail";
import type { StockItem } from "@/types";

interface StockDetailPanelProps {
  selectedId: string;
  selectedItem: StockItem | undefined;
  areaId: number | null;
  onClose: () => void;
  onClearFilters: () => void;
}

export function StockDetailPanel({
  selectedId,
  selectedItem,
  areaId,
  onClose,
  onClearFilters,
}: StockDetailPanelProps) {
  return (
    <div className="col-span-1 lg:col-span-5 lg:sticky lg:top-24 animate-in slide-in-from-right-4 duration-300">
      <div className="bg-base-100 border border-base-200 rounded-[2.5rem] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-6 bg-base-200/30 border-b border-base-200">
          {/* Volver solo en móvil */}
          <button
            className="flex items-center gap-1.5 text-sm font-bold text-base-content/60 hover:text-base-content transition-colors lg:hidden"
            onClick={onClose}
          >
            <ChevronRight className="w-4 h-4 rotate-180" /> Volver
          </button>
          <h2 className="font-bold text-lg hidden lg:block">
            {selectedId === "new" ? "Nuevo Producto" : "Detalle de Inventario"}
          </h2>
          <button
            className="btn btn-sm btn-ghost btn-circle hidden lg:flex"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="p-6 custom-scrollbar max-h-[calc(100vh-250px)] overflow-y-auto">
          {selectedId === "new" ? (
            <p className="text-sm opacity-50 p-10 text-center italic">
              Formulario de creación pendiente...
            </p>
          ) : selectedItem ? (
            <StockDetail item={selectedItem} areaId={areaId} />
          ) : (
            <div className="py-12 text-center space-y-3">
              <Package className="w-8 h-8 mx-auto opacity-20" />
              <p className="text-sm font-medium opacity-40">
                Producto no visible con los filtros actuales
              </p>
              <button
                className="btn btn-ghost btn-sm rounded-xl text-primary"
                onClick={onClearFilters}
              >
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
