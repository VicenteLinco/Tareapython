import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Save, X, Building2, Lock, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { PageLoading } from '@/components/ui/page-state'

interface Configuracion {
  nombre_laboratorio: string
  logo_base64: string
  pin_kiosko: string
  conteo_ciego: boolean
  dias_autonomia_objetivo: number
  lead_time_default: number
  moneda_codigo: string
  moneda_simbolo: string
  conteo_periodo_dias: number
  factor_historial_corto: number
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
  const [pinKiosko, setPinKiosko] = useState('')
  const [conteoCiego, setConteoCiego] = useState(false)
  const [diasAutonomia, setDiasAutonomia] = useState(15)
  const [leadTime, setLeadTime] = useState(3)
  const [monedaCodigo, setMonedaCodigo] = useState('CLP')
  const [monedaSimbolo, setMonedaSimbolo] = useState('$')
  const [conteoPeriodoDias, setConteoPeriodoDias] = useState(30)
  const [factorHistorialCorto, setFactorHistorialCorto] = useState(0.35)
  const [showPin, setShowPin] = useState(false)
  const [pinOrigenConfigurado, setPinOrigenConfigurado] = useState(false)

  // Sync con datos cargados
  const initialized = useRef(false)
  if (data && !initialized.current) {
    setNombre(data.nombre_laboratorio)
    setLogo(data.logo_base64)
    setPreview(data.logo_base64)
    setPinKiosko(data.pin_kiosko || '')
    setPinOrigenConfigurado(!!(data.pin_kiosko))
    setConteoCiego(!!data.conteo_ciego)
    setDiasAutonomia(data.dias_autonomia_objetivo || 15)
    setLeadTime(data.lead_time_default || 3)
    setMonedaCodigo(data.moneda_codigo || 'CLP')
    setMonedaSimbolo(data.moneda_simbolo || '$')
    setConteoPeriodoDias(data.conteo_periodo_dias || 30)
    setFactorHistorialCorto(data.factor_historial_corto ?? 0.35)
    initialized.current = true
  }

  const mutation = useMutation({
    mutationFn: (payload: {
      nombre_laboratorio: string;
      logo_base64: string;
      pin_kiosko: string;
      conteo_ciego: boolean;
      dias_autonomia_objetivo: number;
      lead_time_default: number;
      moneda_codigo: string;
      moneda_simbolo: string;
      conteo_periodo_dias: number;
      factor_historial_corto: number;
    }) =>
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
    mutation.mutate({
      nombre_laboratorio: nombre.trim(),
      logo_base64: logo,
      pin_kiosko: pinKiosko.trim(),
      conteo_ciego: conteoCiego,
      dias_autonomia_objetivo: diasAutonomia,
      lead_time_default: leadTime,
      moneda_codigo: monedaCodigo,
      moneda_simbolo: monedaSimbolo,
      conteo_periodo_dias: conteoPeriodoDias,
      factor_historial_corto: factorHistorialCorto,
    })
  }

  if (isLoading) {
    return (
      <PageLoading label="Cargando configuración..." />
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

        {/* Seguridad Kiosko */}
        <div className="card bg-base-100 shadow-sm border border-base-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Lock className="h-4 w-4 opacity-60" /> Seguridad Kiosko
            </h3>
            {pinOrigenConfigurado || pinKiosko.trim() ? (
              <span className="text-[11px] font-bold text-success flex items-center gap-1">
                ✓ PIN configurado
              </span>
            ) : (
              <span className="text-[11px] font-bold text-warning flex items-center gap-1">
                ⚠ PIN no configurado
              </span>
            )}
          </div>
          <p className="text-xs opacity-50">
            Este PIN se pide al salir del modo kiosko o QR. Si lo olvidas, un admin puede resetearlo desde aquí.
            Deja vacío para salir sin PIN.
          </p>
          <label className="input input-bordered flex items-center gap-2 w-full max-w-xs">
            <Lock className="h-4 w-4 opacity-40 shrink-0" />
            <input
              type={showPin ? 'text' : 'password'}
              className="grow font-mono"
              placeholder="Ej: 1234"
              maxLength={8}
              value={pinKiosko}
              onChange={(e) => setPinKiosko(e.target.value.replace(/\D/g, ''))}
            />
            <button
              type="button"
              className="opacity-40 hover:opacity-80"
              onClick={() => setShowPin((v) => !v)}
            >
              {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </label>
        </div>

        {/* Moneda */}
        <div className="card bg-base-100 shadow-sm border border-base-200 p-6">
          <h3 className="font-semibold text-base mb-4 flex items-center gap-2">
            <span>💱</span> Moneda del Sistema
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium opacity-70 mb-1 block">Código ISO</label>
              <select
                className="select select-bordered w-full"
                value={monedaCodigo}
                onChange={(e) => setMonedaCodigo(e.target.value)}
              >
                <option value="CLP">CLP — Peso Chileno</option>
                <option value="USD">USD — Dólar Estadounidense</option>
                <option value="PEN">PEN — Sol Peruano</option>
                <option value="COP">COP — Peso Colombiano</option>
                <option value="MXN">MXN — Peso Mexicano</option>
                <option value="ARS">ARS — Peso Argentino</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium opacity-70 mb-1 block">Símbolo</label>
              <input
                type="text"
                className="input input-bordered w-full"
                value={monedaSimbolo}
                onChange={(e) => setMonedaSimbolo(e.target.value)}
                placeholder="$"
                maxLength={5}
              />
              <p className="text-xs opacity-50 mt-1">Aparece en precios, solicitudes y PDF</p>
            </div>
          </div>

        </div>

        {/* Período de Conteo */}
        <div className="card bg-base-100 shadow-sm border border-base-200 p-6">
          <h3 className="font-semibold text-base mb-4 flex items-center gap-2">
            <span>📋</span> Período de Conteo
          </h3>
          <div>
            <label className="text-sm font-medium opacity-70 mb-1 block">
              Días máximos entre conteos (global)
            </label>
            <input
              type="number"
              className="input input-bordered w-40"
              value={conteoPeriodoDias}
              onChange={(e) => setConteoPeriodoDias(parseInt(e.target.value) || 30)}
              min={1}
              max={365}
            />
            <p className="text-xs opacity-50 mt-1">
              Cada área puede tener su propio período. Este valor aplica si no tiene uno configurado.
            </p>
          </div>
        </div>

        {/* Inteligencia de Inventario */}
        <div className="space-y-4 p-6 bg-primary/5 rounded-[2rem] border border-primary/10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-primary/10 rounded-xl text-primary">
              <Save className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm">Inteligencia de Inventario</h3>
              <p className="text-[10px] opacity-50">Configura cómo el sistema predice tus necesidades</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold opacity-60 ml-1">Días de Autonomía Objetivo</label>
              <input 
                type="number"
                className="input input-bordered w-full h-11 rounded-xl font-bold"
                value={diasAutonomia}
                onChange={e => setDiasAutonomia(Number(e.target.value))}
                min={1}
                max={365}
              />
              <p className="text-[9px] opacity-40 px-1">Días de stock que deseas tener siempre protegidos.</p>
            </div>
            
            <div className="space-y-1.5">
              <label className="text-xs font-bold opacity-60 ml-1">Lead Time por Defecto (Días)</label>
              <input 
                type="number"
                className="input input-bordered w-full h-11 rounded-xl font-bold"
                value={leadTime}
                onChange={e => setLeadTime(Number(e.target.value))}
                min={0}
                max={90}
              />
              <p className="text-[9px] opacity-40 px-1">Días que tardan los proveedores si no se especifica en el producto.</p>
            </div>
            <div className="space-y-1.5 col-span-2">
              <label className="text-xs font-bold opacity-60 ml-1">Factor Historial Corto</label>
              <input
                type="number"
                className="input input-bordered w-full h-11 rounded-xl font-bold"
                value={factorHistorialCorto}
                onChange={e => setFactorHistorialCorto(Number(e.target.value))}
                min={0}
                max={1}
                step={0.05}
              />
              <p className="text-[9px] opacity-40 px-1">
                Pondera el ritmo reciente cuando hay 2 a 13 dias con consumo. 0.35 = prudente; 1.00 = agresivo.
              </p>
            </div>
          </div>
        </div>

        {/* Conteo Ciego */}
        <div className="flex flex-col gap-1 p-4 bg-base-200/50 rounded-xl border border-base-200">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-bold flex items-center gap-2">
                Conteo Ciego
                <div className="badge badge-outline badge-xs opacity-50">Logística</div>
              </label>
              <p className="text-[11px] opacity-60 leading-relaxed max-w-xs mt-1">
                Oculta el stock esperado durante el proceso de conteo para garantizar que el personal cuente físicamente cada ítem sin sesgos.
              </p>
            </div>
            <input 
              type="checkbox" 
              className="toggle toggle-primary" 
              checked={conteoCiego}
              onChange={(e) => setConteoCiego(e.target.checked)}
            />
          </div>
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
