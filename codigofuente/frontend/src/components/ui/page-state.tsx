import type { ReactNode } from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface PageLoadingProps {
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function PageLoading({
  label = "Cargando...",
  className,
  size = "lg",
}: PageLoadingProps) {
  const spinnerSize =
    size === "sm" ? "loading-sm" : size === "md" ? "loading-md" : "loading-lg";

  return (
    <div
      className={cn(
        "flex min-h-[240px] flex-col items-center justify-center gap-3 text-base-content/60",
        className,
      )}
    >
      <span
        className={cn("loading loading-spinner text-primary", spinnerSize)}
      />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-dashed border-base-300 bg-base-100 p-8 text-center",
        className,
      )}
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200 text-base-content/40">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="font-bold text-base-content">{title}</h3>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-sm text-base-content/50">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

interface InlineErrorProps {
  title?: string;
  message: string;
  className?: string;
}

export function InlineError({
  title = "No se pudo cargar",
  message,
  className,
}: InlineErrorProps) {
  return (
    <div className={cn("alert alert-error rounded-2xl", className)}>
      <AlertCircle className="h-5 w-5" />
      <div>
        <h3 className="font-bold">{title}</h3>
        <p className="text-sm opacity-80">{message}</p>
      </div>
    </div>
  );
}

interface RetryPanelProps extends InlineErrorProps {
  onRetry?: () => void;
  retryLabel?: string;
}

export function RetryPanel({
  onRetry,
  retryLabel = "Reintentar",
  ...props
}: RetryPanelProps) {
  return (
    <div className="rounded-3xl border border-error/20 bg-error/5 p-6">
      <InlineError
        {...props}
        className="border-none bg-transparent p-0 shadow-none"
      />
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="mt-4">
          <RefreshCw className="h-4 w-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
