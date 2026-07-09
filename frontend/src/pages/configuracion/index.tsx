import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Save,
  X,
  Building2,
  Brain,
  Rocket,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { PageLoading } from "@/components/ui/page-state";

interface Configuracion {
  nombre_laboratorio: string;
  logo_base64: string;
  login_imagen_base64: string;
  conteo_ciego: boolean;
  dias_autonomia_objetivo: number;
  lead_time_default: number;
  moneda_codigo: string;
  moneda_simbolo: string;
  conteo_periodo_dias: number;
  factor_historial_corto: number;
  ventana_consumo_dias?: number;
  periodo_revision_dias?: number;
  ia_proveedor: string;
  ia_modelo: string;
  ia_api_url: string;
  ia_api_key: string;
  whatsapp_api_url: string;
  whatsapp_api_key: string;
  whatsapp_webhook_secret: string;
  whatsapp_bot_phone: string;
  vencimiento_alerta_activa: boolean;
  vencimiento_vida_util_minima_dias: number;
  vencimiento_margen_tolerancia_pct: number;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 mb-4">
      {children}
    </p>
  );
}

function Divider() {
  return <hr className="border-base-200 my-8" />;
}

export default function ConfiguracionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const loginImgRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["configuracion"],
    queryFn: () => api.get<Configuracion>("/configuracion").then((r) => r.data),
  });

  const [nombre, setNombre] = useState("");
  const [logo, setLogo] = useState("");
  const [preview, setPreview] = useState("");
  const [loginImagen, setLoginImagen] = useState("");
  const [loginPreview, setLoginPreview] = useState("");
  const [conteoCiego, setConteoCiego] = useState(false);
  const [diasAutonomia, setDiasAutonomia] = useState(15);
  const [leadTime, setLeadTime] = useState(3);
  const [monedaCodigo, setMonedaCodigo] = useState("CLP");
  const [monedaSimbolo, setMonedaSimbolo] = useState("$");
  const [conteoPeriodoDias, setConteoPeriodoDias] = useState(30);
  const [factorHistorialCorto, setFactorHistorialCorto] = useState(0.35);
  const [ventanaConsumoDias, setVentanaConsumoDias] = useState(90);
  const [periodoRevisionDias, setPeriodoRevisionDias] = useState(30);
  const [iaProveedor, setIaProveedor] = useState("gemini");
  const [iaModelo, setIaModelo] = useState("gemini-2.5-flash");
  const [iaApiUrl, setIaApiUrl] = useState("");
  const [iaApiKey, setIaApiKey] = useState("");
  const [whatsappApiUrl, setWhatsappApiUrl] = useState("");
  const [whatsappApiKey, setWhatsappApiKey] = useState("");
  const [whatsappWebhookSecret, setWhatsappWebhookSecret] = useState("");
  const [whatsappBotPhone, setWhatsappBotPhone] = useState("");
  const [vencimientoAlertaActiva, setVencimientoAlertaActiva] = useState(true);
  const [vencimientoVidaUtilMinimaDias, setVencimientoVidaUtilMinimaDias] = useState(30);
  const [vencimientoMargenToleranciaPct, setVencimientoMargenToleranciaPct] = useState(10);

  const [isCustomModel, setIsCustomModel] = useState(false);
  const [modelosDisponibles, setModelosDisponibles] = useState<string[]>([]);
  const [cargandoModelos, setCargandoModelos] = useState(false);

  const fetchModelosDisponibles = async () => {
    setCargandoModelos(true);
    try {
      const res = await api.get("/configuracion/ia-modelos");
      setModelosDisponibles(res.data);
      notify.success("Lista de modelos actualizada correctamente");
      
      if (res.data.length > 0 && !res.data.includes(iaModelo) && !isCustomModel) {
        setIaModelo(res.data[0]);
      }
    } catch (err) {
      console.error(err);
      notify.error(parseApiError(err) || "No se pudieron obtener los modelos. Verifique su API Key.");
    } finally {
      setCargandoModelos(false);
    }
  };

  useEffect(() => {
    if (data && (data.ia_api_key || iaApiKey)) {
      api.get("/configuracion/ia-modelos")
        .then(res => {
          setModelosDisponibles(res.data);
        })
        .catch(err => {
          console.warn("Failed to auto-fetch models on load:", err);
        });
    }
  }, [data]);

  useEffect(() => {
    if (!data) return;
    setNombre(data.nombre_laboratorio);
    setLogo(data.logo_base64);
    setPreview(data.logo_base64);
    setLoginImagen(data.login_imagen_base64 || "");
    setLoginPreview(data.login_imagen_base64 || "");
    setConteoCiego(!!data.conteo_ciego);
    setDiasAutonomia(data.dias_autonomia_objetivo || 15);
    setLeadTime(data.lead_time_default || 3);
    setMonedaCodigo(data.moneda_codigo || "CLP");
    setMonedaSimbolo(data.moneda_simbolo || "$");
    setConteoPeriodoDias(data.conteo_periodo_dias || 30);
    setFactorHistorialCorto(data.factor_historial_corto ?? 0.35);
    if (data.ventana_consumo_dias != null)
      setVentanaConsumoDias(data.ventana_consumo_dias);
    if (data.periodo_revision_dias != null)
      setPeriodoRevisionDias(data.periodo_revision_dias);
    setIaProveedor(data.ia_proveedor || "gemini");
    const currentModel = data.ia_modelo || "gemini-2.5-flash";
    setIaModelo(currentModel);
    if ((data.ia_proveedor || "gemini") === "gemini") {
      setIsCustomModel(
        ![
          "gemini-2.5-flash",
          "gemini-2.5-pro",
          "gemini-1.5-flash",
          "gemini-1.5-pro",
          "gemini-1.0-pro",
        ].includes(currentModel),
      );
    } else {
      setIsCustomModel(true);
    }
    setIaApiUrl(data.ia_api_url || "");
    setIaApiKey(data.ia_api_key || "");
    setWhatsappApiUrl(data.whatsapp_api_url || "");
    setWhatsappApiKey(data.whatsapp_api_key || "");
    setWhatsappWebhookSecret(data.whatsapp_webhook_secret || "");
    setWhatsappBotPhone(data.whatsapp_bot_phone || "");
    setVencimientoAlertaActiva(data.vencimiento_alerta_activa !== false);
    setVencimientoVidaUtilMinimaDias(data.vencimiento_vida_util_minima_dias ?? 30);
    setVencimientoMargenToleranciaPct(data.vencimiento_margen_tolerancia_pct ?? 10);
  }, [data]);

  const mutation = useMutation({
    mutationFn: (payload: {
      nombre_laboratorio: string;
      logo_base64: string;
      login_imagen_base64: string;
      conteo_ciego: boolean;
      dias_autonomia_objetivo: number;
      lead_time_default: number;
      moneda_codigo: string;
      moneda_simbolo: string;
      conteo_periodo_dias: number;
      factor_historial_corto: number;
      ventana_consumo_dias: number;
      periodo_revision_dias: number;
      ia_proveedor: string;
      ia_modelo: string;
      ia_api_url: string;
      ia_api_key: string;
      whatsapp_api_url: string;
      whatsapp_api_key: string;
      whatsapp_webhook_secret: string;
      whatsapp_bot_phone: string;
      vencimiento_alerta_activa: boolean;
      vencimiento_vida_util_minima_dias: number;
      vencimiento_margen_tolerancia_pct: number;
    }) => api.put<Configuracion>("/configuracion", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["configuracion"] });
      notify.success("Configuración guardada");
    },
    onError: () => notify.error("Error al guardar configuración"),
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      notify.error("El logo no puede superar 512 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target?.result as string;
      setLogo(b64);
      setPreview(b64);
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveLogo() {
    setLogo("");
    setPreview("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleLoginImg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notify.error("La imagen de login no puede superar 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target?.result as string;
      setLoginImagen(b64);
      setLoginPreview(b64);
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveLoginImg() {
    setLoginImagen("");
    setLoginPreview("");
    if (loginImgRef.current) loginImgRef.current.value = "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      notify.error("El nombre del laboratorio es requerido");
      return;
    }
    if (vencimientoVidaUtilMinimaDias < 0) {
      notify.error("La vida útil mínima debe ser mayor o igual a 0");
      return;
    }
    if (vencimientoMargenToleranciaPct < 0 || vencimientoMargenToleranciaPct > 100) {
      notify.error("El margen de tolerancia debe estar entre 0 y 100");
      return;
    }
    mutation.mutate({
      nombre_laboratorio: nombre.trim(),
      logo_base64: logo,
      login_imagen_base64: loginImagen,
      conteo_ciego: conteoCiego,
      dias_autonomia_objetivo: diasAutonomia,
      lead_time_default: leadTime,
      moneda_codigo: monedaCodigo,
      moneda_simbolo: monedaSimbolo,
      conteo_periodo_dias: conteoPeriodoDias,
      factor_historial_corto: factorHistorialCorto,
      ventana_consumo_dias: ventanaConsumoDias,
      periodo_revision_dias: periodoRevisionDias,
      ia_proveedor: iaProveedor,
      ia_modelo: iaModelo,
      ia_api_url: iaApiUrl,
      ia_api_key: iaApiKey,
      whatsapp_api_url: whatsappApiUrl,
      whatsapp_api_key: whatsappApiKey,
      whatsapp_webhook_secret: whatsappWebhookSecret,
      whatsapp_bot_phone: whatsappBotPhone,
      vencimiento_alerta_activa: vencimientoAlertaActiva,
      vencimiento_vida_util_minima_dias: vencimientoVidaUtilMinimaDias,
      vencimiento_margen_tolerancia_pct: vencimientoMargenToleranciaPct,
    });
  }

  if (isLoading) return <PageLoading label="Cargando configuración..." />;

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="t-h1 tracking-tight">Configuración</h1>
        <p className="text-sm text-base-content/50 mt-1">
          Ajustes generales del sistema de inventario
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* ── LABORATORIO ── */}
        <SectionTitle>Laboratorio</SectionTitle>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nombre</label>
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
            <p className="text-xs text-base-content/50">
              Aparece en el encabezado de los reportes PDF.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Logo</label>
            <p className="text-xs text-base-content/50">
              PNG o JPG, máx. 512 KB. Se mostrará junto al nombre en los
              reportes.
            </p>

            {preview ? (
              <div className="relative inline-block mt-1">
                <img
                  src={preview}
                  alt="Logo"
                  className="h-20 w-auto rounded-lg border border-base-300 object-contain bg-base-200 p-2"
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
                className="flex items-center gap-3 h-16 px-4 border border-dashed border-base-300 rounded-lg cursor-pointer hover:border-primary hover:bg-base-200/50 transition-colors mt-1"
              >
                <Upload className="h-4 w-4 opacity-40" />
                <span className="text-sm text-base-content/40">
                  Haz clic para subir una imagen
                </span>
              </div>
            )}

            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleFile}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Imagen de login</label>
            <p className="text-xs text-base-content/50">
              PNG o JPG, máx. 2 MB. Se muestra como fondo de la pantalla de
              inicio de sesión.
            </p>

            {loginPreview ? (
              <div className="relative inline-block mt-1">
                <img
                  src={loginPreview}
                  alt="Imagen de login"
                  className="h-28 w-auto rounded-lg border border-base-300 object-cover bg-base-200"
                />
                <button
                  type="button"
                  onClick={handleRemoveLoginImg}
                  className="btn btn-circle btn-xs btn-error absolute -top-2 -right-2"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => loginImgRef.current?.click()}
                className="flex items-center gap-3 h-16 px-4 border border-dashed border-base-300 rounded-lg cursor-pointer hover:border-primary hover:bg-base-200/50 transition-colors mt-1"
              >
                <Upload className="h-4 w-4 opacity-40" />
                <span className="text-sm text-base-content/40">
                  Haz clic para subir una imagen
                </span>
              </div>
            )}

            <input
              ref={loginImgRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={handleLoginImg}
            />
          </div>
        </div>

        <Divider />

        {/* ── MONEDA ── */}
        <SectionTitle>Moneda</SectionTitle>

        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Moneda</label>
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
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Símbolo</label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={monedaSimbolo}
              onChange={(e) => setMonedaSimbolo(e.target.value)}
              placeholder="$"
              maxLength={5}
            />
            <p className="text-xs text-base-content/50">
              Aparece en precios, solicitudes y PDF.
            </p>
          </div>
        </div>

        <Divider />

        {/* ── CONTEO ── */}
        <SectionTitle>Conteo</SectionTitle>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Intervalo entre conteos
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="number"
                className="input input-bordered w-24"
                value={conteoPeriodoDias}
                onChange={(e) =>
                  setConteoPeriodoDias(parseInt(e.target.value) || 30)
                }
                min={1}
                max={365}
              />
              <span className="text-sm text-base-content/50">días</span>
              <div className="flex gap-1.5">
                {([7, 14, 30, 90] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setConteoPeriodoDias(d)}
                    className={`btn btn-xs rounded-full ${
                      conteoPeriodoDias === d
                        ? "btn-primary"
                        : "btn-ghost border border-base-300"
                    }`}
                  >
                    {d === 7
                      ? "Semanal"
                      : d === 14
                        ? "Quincenal"
                        : d === 30
                          ? "Mensual"
                          : "Trimestral"}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-base-content/50">
              Frecuencia global. Cada área puede tener la suya propia en el
              catálogo de áreas.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Conteo ciego</label>
              <p className="text-xs text-base-content/50 max-w-sm leading-relaxed">
                Oculta el stock esperado al contar, para que el personal
                registre lo que ve sin verse influenciado por el sistema.
              </p>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary mt-0.5 shrink-0"
              checked={conteoCiego}
              onChange={(e) => setConteoCiego(e.target.checked)}
            />
          </div>
        </div>

        <Divider />

        {/* ── PREDICCIÓN DE DEMANDA ── */}
        <SectionTitle>Predicción de demanda</SectionTitle>

        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-base-content/40" />
            <p className="text-xs text-base-content/50">
              Parámetros que usa el sistema para calcular cuánto pedir y cuándo
              alertar.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cobertura mínima</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="input input-bordered w-24"
                  value={diasAutonomia}
                  onChange={(e) => setDiasAutonomia(Number(e.target.value))}
                  min={1}
                  max={365}
                />
                <span className="text-sm text-base-content/50">días</span>
              </div>
              <p className="text-xs text-base-content/50 leading-relaxed">
                El sistema alerta cuando el stock cae por debajo de este margen
                de seguridad.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Tiempo de entrega habitual
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="input input-bordered w-24"
                  value={leadTime}
                  onChange={(e) => setLeadTime(Number(e.target.value))}
                  min={0}
                  max={90}
                />
                <span className="text-sm text-base-content/50">días</span>
              </div>
              <p className="text-xs text-base-content/50 leading-relaxed">
                Días desde el pedido hasta la entrega. Se usa cuando el
                proveedor no tiene uno definido.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Reacción a cambios de consumo
            </label>
            <div className="flex items-center gap-4">
              <span className="text-xs text-base-content/40 w-12 text-right shrink-0">
                Estable
              </span>
              <input
                type="range"
                className="range range-primary range-sm flex-1"
                value={factorHistorialCorto}
                onChange={(e) =>
                  setFactorHistorialCorto(Number(e.target.value))
                }
                min={0}
                max={1}
                step={0.05}
              />
              <span className="text-xs text-base-content/40 w-12 shrink-0">
                Sensible
              </span>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-base-content/50 leading-relaxed">
                {factorHistorialCorto <= 0.25
                  ? "Conservador — prioriza el historial largo. Ideal si el consumo es muy regular."
                  : factorHistorialCorto <= 0.55
                    ? "Moderado — equilibrio entre historial y consumo reciente. Valor recomendado."
                    : factorHistorialCorto <= 0.8
                      ? "Dinámico — el consumo reciente pesa más. Útil si hay variaciones frecuentes."
                      : "Agresivo — se basa casi solo en los últimos días de consumo."}
              </p>
              <span className="text-xs font-mono text-base-content/30 ml-4 shrink-0">
                {factorHistorialCorto.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Ventana de demanda</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="input input-bordered w-24"
                  value={ventanaConsumoDias}
                  onChange={(e) =>
                    setVentanaConsumoDias(Number(e.target.value))
                  }
                  min={7}
                  max={365}
                />
                <span className="text-sm text-base-content/50">días</span>
              </div>
              <p className="text-xs text-base-content/50 leading-relaxed">
                Período de historial que se usa para calcular el consumo
                promedio.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Período de revisión</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  className="input input-bordered w-24"
                  value={periodoRevisionDias}
                  onChange={(e) =>
                    setPeriodoRevisionDias(Number(e.target.value))
                  }
                  min={1}
                  max={90}
                />
                <span className="text-sm text-base-content/50">días</span>
              </div>
              <p className="text-xs text-base-content/50 leading-relaxed">
                Frecuencia esperada de reposición. Afecta el stock de seguridad.
              </p>
            </div>
          </div>
        </div>

        <Divider />

        {/* ── ALERTAS DE VENCIMIENTO ── */}
        <SectionTitle>Alertas de Vencimiento</SectionTitle>

        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Activar alertas de vencimiento</label>
              <p className="text-xs text-base-content/50 max-w-sm leading-relaxed">
                Habilita advertencias visuales en la recepción si un lote ingresado vencerá antes de consumirse o tiene vida útil muy corta.
              </p>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary mt-0.5 shrink-0"
              checked={vencimientoAlertaActiva}
              onChange={(e) => setVencimientoAlertaActiva(e.target.checked)}
            />
          </div>

          {vencimientoAlertaActiva && (
            <div className="grid grid-cols-2 gap-5 animate-fade-in">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Vida útil mínima</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input input-bordered w-24"
                    value={vencimientoVidaUtilMinimaDias}
                    onChange={(e) => setVencimientoVidaUtilMinimaDias(Number(e.target.value))}
                    min={0}
                    max={365}
                  />
                  <span className="text-sm text-base-content/50">días</span>
                </div>
                <p className="text-xs text-base-content/50 leading-relaxed">
                  Lotes con menos días de vida útil desde hoy generarán una advertencia inmediata.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Margen de tolerancia</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input input-bordered w-24"
                    value={vencimientoMargenToleranciaPct}
                    onChange={(e) => setVencimientoMargenToleranciaPct(Number(e.target.value))}
                    min={0}
                    max={100}
                  />
                  <span className="text-sm text-base-content/50">%</span>
                </div>
                <p className="text-xs text-base-content/50 leading-relaxed">
                  Porcentaje máximo permitido de desperdicio proyectado sobre la cantidad recibida antes de alertar.
                </p>
              </div>
            </div>
          )}
        </div>

        <Divider />

        {/* ── ASISTENTE DE IA Y WHATSAPP ── */}
        <SectionTitle>Asistente de IA y WhatsApp</SectionTitle>

        <div className="space-y-6">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-4 h-4 text-base-content/40" />
            <p className="text-xs text-base-content/50">
              Configura el proveedor de IA y las credenciales para el bot de
              WhatsApp.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Proveedor de IA</label>
              <select
                className="select select-bordered w-full"
                value={iaProveedor}
                onChange={(e) => {
                  const val = e.target.value;
                  setIaProveedor(val);
                  if (val === "gemini") {
                    setIsCustomModel(false);
                    setIaModelo("gemini-2.5-flash");
                  } else {
                    setIsCustomModel(true);
                    setIaModelo("llama3");
                  }
                }}
              >
                <option value="gemini">Google Gemini</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>

            <div className="space-y-1.5 flex flex-col justify-end">
              <label className="text-sm font-medium mb-1.5">Modelo de IA</label>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  {iaProveedor === "gemini" || modelosDisponibles.length > 0 ? (
                    <select
                      className="select select-bordered flex-1"
                      value={isCustomModel ? "custom" : iaModelo}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "custom") {
                          setIsCustomModel(true);
                          setIaModelo("");
                        } else {
                          setIsCustomModel(false);
                          setIaModelo(val);
                        }
                      }}
                    >
                      {modelosDisponibles.length > 0 ? (
                        modelosDisponibles.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="gemini-2.5-flash">
                            gemini-2.5-flash (Recomendado - Rápido)
                          </option>
                          <option value="gemini-2.5-pro">
                            gemini-2.5-pro (Avanzado - Razonamiento)
                          </option>
                          <option value="gemini-1.5-flash">
                            gemini-1.5-flash (Básico)
                          </option>
                          <option value="gemini-1.5-pro">
                            gemini-1.5-pro (Básico - Avanzado)
                          </option>
                        </>
                      )}
                      <option value="custom">Otro (ingresar manualmente)</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="input input-bordered flex-1"
                      value={iaModelo}
                      onChange={(e) => setIaModelo(e.target.value)}
                      placeholder="Ej: llama3"
                    />
                  )}
                  <button
                    type="button"
                    className="btn btn-outline btn-square"
                    onClick={fetchModelosDisponibles}
                    disabled={cargandoModelos}
                    title="Obtener modelos disponibles de la API"
                  >
                    <RefreshCw className={`h-4 w-4 ${cargandoModelos ? "animate-spin" : ""}`} />
                  </button>
                </div>
                {isCustomModel && (
                  <input
                    type="text"
                    className="input input-bordered w-full text-sm"
                    value={iaModelo}
                    onChange={(e) => setIaModelo(e.target.value)}
                    placeholder={iaProveedor === "gemini" ? "Ej: gemini-2.0-flash-exp" : "Ej: llama3"}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">IA API URL (Ollama)</label>
              <input
                type="text"
                className="input input-bordered w-full"
                value={iaApiUrl}
                onChange={(e) => setIaApiUrl(e.target.value)}
                placeholder="Ej: http://localhost:11434"
                disabled={iaProveedor !== "ollama"}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">IA API Key (Gemini)</label>
              <input
                type="password"
                className="input input-bordered w-full"
                value={iaApiKey}
                onChange={(e) => setIaApiKey(e.target.value)}
                placeholder={iaApiKey === "***" ? "••••••••" : "API Key"}
                disabled={iaProveedor !== "gemini"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">WhatsApp API URL</label>
              <input
                type="text"
                className="input input-bordered w-full"
                value={whatsappApiUrl}
                onChange={(e) => setWhatsappApiUrl(e.target.value)}
                placeholder="Ej: http://localhost:8008"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">WhatsApp API Key</label>
              <input
                type="password"
                className="input input-bordered w-full"
                value={whatsappApiKey}
                onChange={(e) => setWhatsappApiKey(e.target.value)}
                placeholder={whatsappApiKey === "***" ? "••••••••" : "API Key"}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Webhook Secret</label>
              <input
                type="text"
                className="input input-bordered w-full"
                value={whatsappWebhookSecret}
                onChange={(e) => setWhatsappWebhookSecret(e.target.value)}
                placeholder="Secreto para validar firma"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Teléfono del Bot</label>
              <input
                type="text"
                className="input input-bordered w-full"
                value={whatsappBotPhone}
                onChange={(e) => setWhatsappBotPhone(e.target.value)}
                placeholder="Ej: +56912345678"
              />
            </div>
          </div>
        </div>

        <Divider />

        <button
          type="submit"
          className="btn btn-primary"
          disabled={mutation.isPending}
        >
          {mutation.isPending ? (
            <span className="loading loading-spinner loading-sm" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Guardar cambios
        </button>
      </form>

      <Divider />

      {/* ── CARGA INICIAL ── */}
      <SectionTitle>Carga inicial</SectionTitle>

      <button
        type="button"
        onClick={() => navigate("/setup")}
        className="flex w-full items-center gap-4 rounded-xl border border-base-200 bg-base-100 p-4 text-left transition-colors hover:border-base-300 hover:bg-base-200/40"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Rocket className="h-5 w-5" />
        </span>
        <span className="grow">
          <span className="block text-sm font-medium">
            Carga inicial de productos
          </span>
          <span className="block text-xs text-base-content/50">
            Importá productos y stock en lote para arrancar el inventario.
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-base-content/30" />
      </button>
    </div>
  );
}
