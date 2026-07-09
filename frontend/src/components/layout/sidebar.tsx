import { useState } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  ArrowDownToLine,
  Trash2,
  History,
  ShoppingCart,
  ShoppingBag,
  Settings,
  SlidersHorizontal,
  Users,
  FileText,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Sun,
  Moon,
  ClipboardCheck,
  BarChart3,
  Tag,
} from "lucide-react";
import { useAuthStore, useCanOperate } from "@/hooks/use-auth-store";

type NavItem = {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  operativo?: boolean;
  adminOnly?: boolean;
};

const navGroups: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [{ to: "/", icon: LayoutDashboard, label: "Dashboard" }],
  },
  {
    label: "Principal",
    items: [
      {
        to: "/consumos",
        icon: ClipboardList,
        label: "Consumos",
        operativo: true,
      },
      { to: "/recepciones", icon: ArrowDownToLine, label: "Recepciones" },
      {
        to: "/creador-productos",
        icon: Settings,
        label: "Creador de Productos",
        adminOnly: true,
      },
    ],
  },
  {
    label: "Inventario",
    items: [
      { to: "/stock", icon: Package, label: "Inventario" },
      { to: "/movimientos", icon: History, label: "Movimientos" },
      { to: "/conteo", icon: ClipboardCheck, label: "Conteo", operativo: true },
      { to: "/descartes", icon: Trash2, label: "Descartes", operativo: true },
      { to: "/reportes", icon: BarChart3, label: "Reportes", adminOnly: true },
    ],
  },
  {
    label: "Compras",
    items: [
      { to: "/solicitudes-compra", icon: ShoppingCart, label: "Solicitudes" },
      {
        to: "/ordenes-compra",
        icon: ShoppingBag,
        label: "Adquisiciones",
        adminOnly: true,
      },
    ],
  },
  {
    label: "Herramientas",
    items: [
      { to: "/etiquetas", icon: Tag, label: "Etiquetas" },
    ],
  },
  {
    label: "Sistema",
    items: [
      { to: "/usuarios", icon: Users, label: "Usuarios", adminOnly: true },
      {
        to: "/configuracion",
        icon: SlidersHorizontal,
        label: "Configuración",
        adminOnly: true,
      },
      { to: "/areas", icon: Settings, label: "Áreas", adminOnly: true },
      { to: "/audit-log", icon: FileText, label: "Audit Log", adminOnly: true },
    ],
  },
];

interface SidebarProps {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({
  expanded,
  onExpandedChange,
  mobileOpen,
  onMobileClose,
}: SidebarProps) {
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute("data-theme") === "dark",
  );
  const usuario = useAuthStore((s) => s.usuario);
  const isAdmin = usuario?.rol === "admin";
  const canOperate = useCanOperate();

  const effectiveExpanded = expanded || mobileOpen;

  const toggleTheme = () => {
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("lab-theme", next);
    setIsDark(!isDark);
  };

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onMobileClose}
        />
      )}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen flex-col overflow-hidden border-r border-base-200 bg-base-100 transition-all duration-300 ease-out",
          // Desktop: siempre visible, ancho por expanded
          "md:translate-x-0",
          effectiveExpanded ? "md:w-56" : "md:w-[60px]",
          // Mobile: drawer full-width, translate según mobileOpen
          "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        onMouseEnter={() => {
          if (window.innerWidth >= 768) onExpandedChange(true);
        }}
        onMouseLeave={() => {
          if (window.innerWidth >= 768) onExpandedChange(false);
        }}
      >
        {/* Logo */}
        <div className="flex h-[60px] items-center gap-2.5 px-4 border-b border-base-200">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <FlaskConical className="h-4.5 w-4.5 text-primary-content" />
          </div>
          <span
            className={cn(
              "font-semibold text-sm tracking-tight whitespace-nowrap transition-all duration-300",
              effectiveExpanded
                ? "opacity-100 translate-x-0"
                : "opacity-0 -translate-x-2 w-0 overflow-hidden",
            )}
          >
            Lab Inventario
          </span>
        </div>

        {/* Navigation */}
        <nav
          className={cn(
            "flex-1 min-h-0 px-2 py-[clamp(0.25rem,1vh,0.5rem)] overflow-y-auto overflow-x-hidden transition-all duration-300",
          )}
        >
          {navGroups.map((group, i) => {
            // consulta (solo lectura) no ve mutaciones de stock; no-admin no ve ítems adminOnly.
            const items = group.items.filter(
              (item) =>
                (canOperate || !item.operativo) && (isAdmin || !item.adminOnly),
            );
            if (items.length === 0) return null;
            return (
              <div key={i}>
                {i > 0 && (
                  <div className="mx-2 my-[clamp(0.375rem,1.4vh,0.75rem)] h-px bg-base-200" />
                )}
                {group.label && (
                  <p
                    className={cn(
                      "px-3 mb-[clamp(0.125rem,0.5vh,0.25rem)] text-[10px] font-semibold uppercase tracking-widest opacity-40 transition-all duration-300",
                      effectiveExpanded ? "opacity-40" : "opacity-0",
                    )}
                  >
                    {group.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => (
                    <SidebarLink
                      key={item.to}
                      {...item}
                      expanded={effectiveExpanded}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="shrink-0 border-t border-base-200 p-2 space-y-0.5">
          <button
            onClick={toggleTheme}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm opacity-50 hover:opacity-100 hover:bg-base-200 transition-all cursor-pointer"
          >
            {isDark ? (
              <Sun className="h-[18px] w-[18px] shrink-0" />
            ) : (
              <Moon className="h-[18px] w-[18px] shrink-0" />
            )}
            <span
              className={cn(
                "whitespace-nowrap transition-all duration-300",
                effectiveExpanded
                  ? "opacity-100"
                  : "opacity-0 w-0 overflow-hidden",
              )}
            >
              {isDark ? "Modo claro" : "Modo oscuro"}
            </span>
          </button>
          <button
            onClick={() => onExpandedChange(!expanded)}
            className="hidden md:flex h-9 w-full items-center justify-center rounded-lg opacity-30 hover:opacity-70 hover:bg-base-200 transition-all cursor-pointer"
          >
            {expanded ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  expanded,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  expanded: boolean;
}) {
  const tooltipId = `tooltip-nav-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <Tooltip open={!expanded ? undefined : false}>
      <span className="relative block">
        <TooltipTrigger asChild>
          <NavLink
            to={to}
            end={to === "/"}
            aria-describedby={!expanded ? tooltipId : undefined}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-lg px-3 h-9 text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-primary text-primary-content sidebar-link-active"
                  : "opacity-60 hover:opacity-100 hover:bg-base-200",
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span
              className={cn(
                "whitespace-nowrap transition-all duration-300",
                expanded
                  ? "opacity-100 translate-x-0"
                  : "opacity-0 -translate-x-2 w-0 overflow-hidden",
              )}
            >
              {label}
            </span>
          </NavLink>
        </TooltipTrigger>
        <TooltipContent id={tooltipId} side="right" className="font-medium">
          {label}
        </TooltipContent>
      </span>
    </Tooltip>
  );
}
