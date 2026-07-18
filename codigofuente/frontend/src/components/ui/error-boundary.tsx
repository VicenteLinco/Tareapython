import { Component } from "react";
import type { ReactNode } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary capturó:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200">
        <div className="card bg-base-100 shadow-lg max-w-md w-full mx-4">
          <div className="card-body items-center text-center gap-4">
            <div className="p-4 bg-error/10 rounded-full">
              <AlertCircle className="w-8 h-8 text-error" />
            </div>
            <div>
              <h2 className="card-title justify-center">Algo salió mal</h2>
              <p className="text-base-content/60 text-sm mt-1">
                {this.props.fallbackMessage ??
                  "Ocurrió un error inesperado. Recarga la página para continuar."}
              </p>
            </div>
            {import.meta.env.DEV && (
              <div className="alert alert-error text-left w-full">
                <code className="text-xs break-all">
                  {this.state.error?.message}
                </code>
              </div>
            )}
            <button
              className="btn btn-primary btn-sm gap-2"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="w-4 h-4" />
              Recargar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
