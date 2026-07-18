import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import { v4 as uuidv4 } from "uuid";
import { useAuthStore } from "@/hooks/use-auth-store";

interface IdempotentRequestConfig extends InternalAxiosRequestConfig {
  _idempotencyKey?: string;
  _retry?: boolean;
}

const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

let refreshPromise: Promise<string> | null = null;

export async function refreshAccessToken() {
  if (!refreshPromise) {
    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) {
      return Promise.reject(new Error("No refresh token available"));
    }

    refreshPromise = axios
      .post("/api/v1/auth/refresh", {
        refresh_token: refreshToken,
      })
      .then((res) => {
        const { access_token, refresh_token } = res.data;
        useAuthStore.getState().setTokens(access_token, refresh_token);
        return access_token as string;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

api.interceptors.request.use((config: IdempotentRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Idempotency centralizada para mutaciones (excepto auth)
  const method = config.method?.toLowerCase() || "";
  const url = config.url || "";
  if (["post", "put", "patch"].includes(method) && !url.includes("/auth/")) {
    if (
      !config._idempotencyKey &&
      !config.headers["X-Idempotency-Key"] &&
      !config.headers["x-idempotency-key"]
    ) {
      config._idempotencyKey = uuidv4();
    }
    const key =
      config._idempotencyKey ||
      config.headers["X-Idempotency-Key"] ||
      config.headers["x-idempotency-key"];
    config.headers["X-Idempotency-Key"] = key;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as IdempotentRequestConfig | undefined;
    if (!original) return Promise.reject(error);
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const accessToken = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().logout();
        window.location.href = "/login";
      }
    }
    if (error.response?.status === 409) {
      const data = error.response?.data;
      const message =
        typeof data === "object" && data !== null && "message" in data
          ? (data as { message: string }).message
          : "El registro ha sido modificado por otro usuario.";
      const { toast } = await import("sonner");
      toast.error(message, {
        id: "concurrency-conflict",
        duration: 8000,
        action: {
          label: "Recargar",
          onClick: () => {
            window.location.reload();
          },
        },
      });
    }
    return Promise.reject(error);
  },
);

export default api;
