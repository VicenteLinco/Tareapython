// frontend/src/hooks/use-inactivity-timeout.ts
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/hooks/use-auth-store'
import { INACTIVITY_TIMEOUT_MS, INACTIVITY_WARNING_MS } from '@/lib/auth-config'

const WARNING_DURATION_MS = INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS // 2 min = 120_000 ms

export function useInactivityTimeout() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(WARNING_DURATION_MS / 1000))

  const navigate = useNavigate()
  const logoutFn = useAuthStore.getState().logout  // getState() evita re-render en cambios del store

  // Toda la lógica de timers vive en refs para evitar dependencias en useEffect
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hiddenAtRef = useRef<number | null>(null)
  const remainingWarningRef = useRef(INACTIVITY_WARNING_MS)
  const remainingLogoutRef = useRef(WARNING_DURATION_MS)
  const dialogOpenRef = useRef(false)  // ref espejo de dialogOpen para closures

  function clearAllTimers() {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null }
    if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null }
  }

  function doLogout() {
    clearAllTimers()
    dialogOpenRef.current = false
    setDialogOpen(false)
    logoutFn()
    toast.info('Sesión cerrada por inactividad')
    navigate('/login', { replace: true })
  }

  function startLogoutCountdown(remainingMs: number) {
    remainingLogoutRef.current = remainingMs
    setSecondsLeft(Math.ceil(remainingMs / 1000))
    dialogOpenRef.current = true
    setDialogOpen(true)

    logoutTimerRef.current = setTimeout(doLogout, remainingMs)
    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
  }

  function startWarningTimer(delayMs: number) {
    remainingWarningRef.current = delayMs
    warningTimerRef.current = setTimeout(() => {
      startLogoutCountdown(WARNING_DURATION_MS)
    }, delayMs)
  }

  function resetTimer() {
    clearAllTimers()
    dialogOpenRef.current = false
    setDialogOpen(false)
    startWarningTimer(INACTIVITY_WARNING_MS)
  }

  const onContinue = () => resetTimer()

  // Montar una sola vez: event listeners de actividad + timer inicial
  useEffect(() => {
    const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

    const handleActivity = () => {
      // Usar ref (no estado) para evitar closure stale
      if (!dialogOpenRef.current) resetTimer()
    }

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }))
    startWarningTimer(INACTIVITY_WARNING_MS)

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, handleActivity))
      clearAllTimers()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Visibility API — montar una sola vez
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        clearAllTimers()
      } else {
        if (hiddenAtRef.current === null) return
        const elapsed = Date.now() - hiddenAtRef.current
        hiddenAtRef.current = null

        if (dialogOpenRef.current) {
          // Estaba mostrando el dialog — descontar tiempo transcurrido del countdown
          const newRemaining = Math.max(0, remainingLogoutRef.current - elapsed)
          if (newRemaining <= 0) {
            doLogout()
          } else {
            startLogoutCountdown(newRemaining)
          }
        } else {
          // Estaba en el timer de warning — descontar tiempo transcurrido
          const newRemaining = Math.max(0, remainingWarningRef.current - elapsed)
          if (newRemaining <= 0) {
            startLogoutCountdown(WARNING_DURATION_MS)
          } else {
            startWarningTimer(newRemaining)
          }
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { dialogOpen, secondsLeft, onContinue }
}
