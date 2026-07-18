import { useState, useCallback } from "react";

export interface DialogState {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  toggle: () => void;
}

/**
 * Estado abierto/cerrado para modales, drawers y popovers.
 * Reemplaza el patrón `useState(false)` + handlers manuales.
 */
export function useDialogState(initial = false): DialogState {
  const [open, setOpen] = useState(initial);
  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return { open, onOpen, onClose, toggle };
}
