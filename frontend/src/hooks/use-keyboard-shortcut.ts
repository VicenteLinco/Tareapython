import { useEffect } from 'react'

type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta'

interface ShortcutOptions {
  key: string
  modifiers?: ModifierKey[]
  /** No disparar si el foco está en un input/textarea/select */
  ignoreInputs?: boolean
  onKeyDown: (e: KeyboardEvent) => void
}

/**
 * Registra un atajo de teclado mientras el componente está montado.
 * Por defecto ignora eventos cuando el foco está en campos de texto.
 */
export function useKeyboardShortcut({
  key,
  modifiers = [],
  ignoreInputs = true,
  onKeyDown,
}: ShortcutOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (ignoreInputs) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return
        if ((e.target as HTMLElement)?.isContentEditable) return
      }

      const keyMatch = e.key.toLowerCase() === key.toLowerCase()
      const ctrlMatch  = !modifiers.includes('ctrl')  || e.ctrlKey  || e.metaKey
      const altMatch   = !modifiers.includes('alt')   || e.altKey
      const shiftMatch = !modifiers.includes('shift') || e.shiftKey
      const metaMatch  = !modifiers.includes('meta')  || e.metaKey

      if (keyMatch && ctrlMatch && altMatch && shiftMatch && metaMatch) {
        onKeyDown(e)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, modifiers, ignoreInputs, onKeyDown])
}
