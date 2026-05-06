import { toast } from 'sonner'

const DURATION = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3500,
} as const

export const notify = {
  success: (message: string, description?: string) =>
    toast.success(message, { description, duration: DURATION.success }),

  error: (message: string, description?: string) =>
    toast.error(message, { description, duration: DURATION.error }),

  warning: (message: string, description?: string) =>
    toast.warning(message, { description, duration: DURATION.warning }),

  info: (message: string, description?: string) =>
    toast.info(message, { description, duration: DURATION.info }),

  promise: <T>(
    promise: Promise<T>,
    msgs: { loading: string; success: string; error: string }
  ) =>
    toast.promise(promise, msgs),
}
