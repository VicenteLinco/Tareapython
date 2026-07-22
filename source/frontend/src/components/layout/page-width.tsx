import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

interface PageWidthContextValue {
  fullWidth: boolean;
  setFullWidth: (value: boolean) => void;
}

const PageWidthContext = createContext<PageWidthContextValue | null>(null);

export function PageWidthProvider({ children }: { children: ReactNode }) {
  const [fullWidth, setFullWidth] = useState(false);
  return (
    <PageWidthContext.Provider value={{ fullWidth, setFullWidth }}>
      {children}
    </PageWidthContext.Provider>
  );
}

/** Read the current layout width state. Used by the layout shell. */
export function usePageWidth(): PageWidthContextValue {
  const ctx = useContext(PageWidthContext);
  if (!ctx)
    throw new Error("usePageWidth must be used within a PageWidthProvider");
  return ctx;
}

/**
 * Opt a page out of the default centered max-width so dense content
 * (data tables, wide grids) can use the full available width.
 * The constraint is restored automatically when the page unmounts.
 */
export function useFullWidthPage() {
  const { setFullWidth } = usePageWidth();
  useLayoutEffect(() => {
    setFullWidth(true);
    return () => setFullWidth(false);
  }, [setFullWidth]);
}
