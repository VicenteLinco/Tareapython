import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Save, X, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'

interface Configuracion {
  nombre_laboratorio: string
  logo_base64: string
}

export default function ConfiguracionPage() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<Configuracion>('/configuracion').then((r) => r.data),
  })

  const [nombre, setNombre] = useState('')
  const [logo, setLogo] = useState('')
  const [preview, setPreview] = useState('')

  // Sync con datos cargados
  const initialized = useRef(false)
  if (data && !initialized.current) {
    setNombre(data.nombre_laboratorio)
    setLogo(data.logo_base64)
    setPreview(data.logo_base64)
    initialized.current = true
  }

  const mutation = useMutation({
    mutationFn: (payload: { nombre_laboratorio: string; logo_base64: string }) =>
      api.put<Configuracion>('/configuracion', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuracion'] })
      toast.success('Configuración guardada')
    },
    onError: () => toast.error('Error al guardar configuración'),
  })

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 512 * 1024) {
      toast.error('El logo no puede superar 512 KB')
      return
    }
    const reader = new FileReader()
    reader.onload = (ev) => {
      const b64 = ev.target?.result as string
      setLogo(b64)
      setPreview(b64)
    }
    reader.readAsDataURL(file)
  }

  function handleRemoveLogo() {
    setLogo('')
    setPreview('')
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) {
      toast.error('El nombre del laboratorio es requerido')
      return
    }
    mutation.mutate({ nombre_laboratorio: nombre.trim(), logo_base64: logo })
  }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-xl">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-40 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración del sistema</h1>
        <p className="text-sm opacity-50 mt-0.5">Datos que aparecen en los reportes PDF</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Nombre del laboratorio */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Nombre del laboratorio</label>
          <label className="input input-bordered flex items-center gap-2 w-full">
            <Building2 className="h-4 w-4 opacity-40 shrink-0" />
            <input
              type="text"
              className="grow"
              placeholder="Laboratorio Clínico"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </label>
        </div>

        {/* Logo */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Logo del laboratorio</label>
          <p className="text-xs opacity-50">PNG o JPG, máx. 512 KB. Se mostrará en el encabezado del PDF.</p>

          {preview ? (
            <div className="relative inline-block">
              <img
                src={preview}
                alt="Logo"
                className="h-24 w-auto rounded-lg border border-base-300 object-contain bg-base-200 p-2"
              />
              <button
                type="button"
                onClick={handleRemoveLogo}
                className="btn btn-circle btn-xs btn-error absolute -top-2 -right-2"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 h-28 w-full border-2 border-dashed border-base-300 rounded-xl cursor-pointer hover:border-primary transition-colors"
            >
              <Upload className="h-6 w-6 opacity-30" />
              <span className="text-xs opacity-40">Haz clic para subir</span>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleFile}
          />

          {!preview && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Seleccionar imagen
            </button>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Guardar cambios
        </button>
      </form>
    </div>
  )
}
