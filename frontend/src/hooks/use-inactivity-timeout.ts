// frontend/src/hooks/use-inactivity-timeout.ts
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { notify } from "@/lib/notify";
import { useAuthStore } from "@/hooks/use-auth-store";
import {
  INACTIVITY_TIMEOUT_MS,
  INACTIVITY_WARNING_MS,
} from "@/lib/auth-config";

const WARNING_DURATION_MS = INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS; // 2 min = 120_000 ms

export function useInactivityTimeout() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(WARNING_DURATION_MS / 1000),
  );

  const navigate = useNavigate();
  const logoutFn = useAuthStore.getState().logout; // getState() evita re-render en cambios del store

  // Toda la lógica de timers vive en refs para evitar dependencias en useEffect
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const warningDeadlineRef = useRef<number | null>(null);
  const logoutDeadlineRef = useRef<number | null>(null);
  const dialogOpenRef = useRef(false); // ref espejo de dialogOpen para closures

  function clearAllTimers() {
    console.log("[InactivityTimeout] clearAllTimers called");
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }

  function doLogout() {
    console.log("[InactivityTimeout] doLogout called");
    clearAllTimers();
    // No cambiamos dialogOpenRef.current a false para evitar que eventos durante la
    // transición de desmonte llamen a resetTimer()
    setDialogOpen(false);
    console.log("[InactivityTimeout] calling logoutFn");
    logoutFn();
    console.log("[InactivityTimeout] logoutFn finished, calling navigate");
    notify.info("Sesión cerrada por inactividad");
    navigate("/login", { replace: true });
  }

  function updateCountdown() {
    const deadline = logoutDeadlineRef.current;
    if (!deadline) return;

    const remainingMs = Math.max(0, deadline - Date.now());
    console.log(
      "[InactivityTimeout] updateCountdown remainingMs:",
      remainingMs,
    );
    setSecondsLeft(Math.ceil(remainingMs / 1000));

    if (remainingMs <= 0) {
      console.log("[InactivityTimeout] remainingMs <= 0, calling doLogout");
      doLogout();
    }
  }

  function startLogoutCountdown(remainingMs = WARNING_DURATION_MS) {
    console.log(
      "[InactivityTimeout] startLogoutCountdown called with remainingMs:",
      remainingMs,
    );
    logoutDeadlineRef.current = Date.now() + remainingMs;
    warningDeadlineRef.current = null;
    setSecondsLeft(Math.ceil(remainingMs / 1000));
    dialogOpenRef.current = true;
    setDialogOpen(true);

    logoutTimerRef.current = setTimeout(() => {
      console.log("[InactivityTimeout] logoutTimeout fired");
      doLogout();
    }, remainingMs);
    countdownIntervalRef.current = setInterval(updateCountdown, 1000);
  }

  function startWarningTimer(delayMs: number) {
    console.log(
      "[InactivityTimeout] startWarningTimer called with delayMs:",
      delayMs,
    );
    warningDeadlineRef.current = Date.now() + delayMs;
    logoutDeadlineRef.current = null;
    warningTimerRef.current = setTimeout(() => {
      console.log("[InactivityTimeout] warningTimeout fired");
      startLogoutCountdown();
    }, delayMs);
  }

  function resetTimer() {
    console.log("[InactivityTimeout] resetTimer called");
    clearAllTimers();
    dialogOpenRef.current = false;
    setDialogOpen(false);
    startWarningTimer(INACTIVITY_WARNING_MS);
  }

  const onContinue = () => {
    console.log("[InactivityTimeout] onContinue clicked");
    resetTimer();
  };

  // Montar una sola vez: event listeners de actividad + timer inicial
  useEffect(() => {
    const ACTIVITY_EVENTS = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ] as const;

    const handleActivity = () => {
      // Usar ref (no estado) para evitar closure stale
      // Solo resetear si el diálogo no está abierto y el usuario sigue autenticado
      if (!dialogOpenRef.current && useAuthStore.getState().accessToken) {
        resetTimer();
      }
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, handleActivity, { passive: true }),
    );
    startWarningTimer(INACTIVITY_WARNING_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) =>
        window.removeEventListener(e, handleActivity),
      );
      clearAllTimers();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Visibility API — montar una sola vez
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        clearAllTimers();
      } else {
        const now = Date.now();

        if (dialogOpenRef.current) {
          // Estaba mostrando el dialog — descontar tiempo transcurrido del countdown
          const deadline = logoutDeadlineRef.current;
          if (!deadline || now >= deadline) {
            doLogout();
          } else {
            startLogoutCountdown(deadline - now);
          }
        } else {
          // Estaba en el timer de warning — descontar tiempo transcurrido
          const warningDeadline = warningDeadlineRef.current;
          if (!warningDeadline) {
            startLogoutCountdown();
          } else if (now >= warningDeadline) {
            // Warning ya disparó — calcular cuánto queda del countdown de logout
            const logoutDeadline = warningDeadline + WARNING_DURATION_MS;
            if (now >= logoutDeadline) {
              doLogout();
            } else {
              startLogoutCountdown(logoutDeadline - now);
            }
          } else {
            startWarningTimer(warningDeadline - now);
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { dialogOpen, secondsLeft, onContinue };
}
