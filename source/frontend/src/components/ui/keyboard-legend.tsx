import { useState } from "react";
import { Keyboard, X } from "lucide-react";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";

interface Shortcut {
  keys: string[];
  description: string;
}

interface KeyboardLegendProps {
  shortcuts: Shortcut[];
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="kbd kbd-sm text-xs min-w-6 text-center">{children}</kbd>
  );
}

export function KeyboardLegend({ shortcuts }: KeyboardLegendProps) {
  const [open, setOpen] = useState(false);

  useKeyboardShortcut({
    key: "?",
    onKeyDown: (e) => {
      e.preventDefault();
      setOpen((o) => !o);
    },
  });

  useKeyboardShortcut({
    key: "Escape",
    ignoreInputs: false,
    onKeyDown: () => setOpen(false),
  });

  return (
    <>
      <button
        className="btn btn-ghost btn-xs gap-1 text-base-content/40 hover:text-base-content"
        onClick={() => setOpen((o) => !o)}
        title="Atajos de teclado (?)"
      >
        <Keyboard className="size-3.5" />
        <span className="hidden sm:inline">Atajos</span>
      </button>

      {open && (
        <div className="modal modal-open z-50">
          <div className="modal-box max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold flex items-center gap-2">
                <Keyboard className="size-4" /> Atajos de teclado
              </h3>
              <button
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-base-200">
                {shortcuts.map((s) => (
                  <tr key={s.description}>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1">
                        {s.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 text-base-content/70">
                      {s.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-backdrop" onClick={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
