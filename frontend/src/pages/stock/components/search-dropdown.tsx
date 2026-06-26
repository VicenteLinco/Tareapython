import { cn } from "@/lib/utils";
import type { StockItem } from "@/types";

type GroupedEntry =
  | { type: "header"; letter: string }
  | { type: "item"; item: StockItem; idx: number };

interface SearchDropdownProps {
  groupedItems: GroupedEntry[];
  activeIndex: number;
  itemRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onSelect: (name: string) => void;
  setActiveIndex: (i: number) => void;
}

export function SearchDropdown({
  groupedItems,
  activeIndex,
  itemRefs,
  onSelect,
  setActiveIndex,
}: SearchDropdownProps) {
  return (
    <div
      className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-72"
      role="listbox"
    >
      {groupedItems.map((entry) =>
        entry.type === "header" ? (
          <div
            key={`h-${entry.letter}`}
            className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-base-content/30 bg-base-200/40 sticky top-0"
          >
            {entry.letter}
          </div>
        ) : (
          <div
            key={entry.item.producto_id}
            ref={(el) => {
              itemRefs.current[entry.idx] = el;
            }}
            role="option"
            aria-selected={entry.idx === activeIndex}
            className={cn(
              "flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors",
              entry.idx === activeIndex
                ? "bg-primary/10 text-primary"
                : "hover:bg-base-200/60",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(entry.item.producto_nombre);
              setActiveIndex(-1);
            }}
          >
            <span className="font-medium truncate">
              {entry.item.producto_nombre}
            </span>
            {entry.item.codigo_interno && (
              <span className="text-[10px] font-mono opacity-40 shrink-0 ml-2">
                #{entry.item.codigo_interno}
              </span>
            )}
          </div>
        ),
      )}
    </div>
  );
}
