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
  Sliders,
  Bell,
  Cpu,
} from "lucide-react";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { PageLoading } from "@/components/ui/page-state";
import { cn } from "@/lib/utils";

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
  ia_api_key_gemini?: string;
  ia_api_key_openai?: string;
  ia_api_key_deepseek?: string;
  ia_api_key_github?: string;
  ia_api_url_openai?: string;
  ia_api_url_deepseek?: string;
  ia_api_url_github?: string;
  ia_api_url_ollama?: string;
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

  const [activeTab, setActiveTab] = useState<"general" | "operaciones" | "vencimientos" | "integraciones">("general");
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
  const [iaApiKeyGemini, setIaApiKeyGemini] = useState("");
  const [iaApiKeyOpenai, setIaApiKeyOpenai] = useState("");
  const [iaApiKeyDeepseek, setIaApiKeyDeepseek] = useState("");
  const [iaApiKeyGithub, setIaApiKeyGithub] = useState("");
  const [iaApiUrlOpenai, setIaApiUrlOpenai] = useState("");
  const [iaApiUrlDeepseek, setIaApiUrlDeepseek] = useState("");
  const [iaApiUrlGithub, setIaApiUrlGithub] = useState("");
  const [iaApiUrlOllama, setIaApiUrlOllama] = useState("");
  const [vencimientoAlertaActiva, setVencimientoAlertaActiva] = useState(true);
  const [vencimientoVidaUtilMinimaDias, setVencimientoVidaUtilMinimaDias] = useState(30);
  const [vencimientoMargenToleranciaPct, setVencimientoMargenToleranciaPct] = useState(10);

  const [isCustomModel, setIsCustomModel] = useState(false);
  const [modelosDisponibles, setModelosDisponibles] = useState<string[]>([]);
  const [cargandoModelos, setCargandoModelos] = useState(false);

  const fetchModelosDisponibles = async () => {
    setCargandoModelos(true);
    try {
      const activeKey =
        iaProveedor === "gemini"
          ? iaApiKeyGemini
          : iaProveedor === "openai"
          ? iaApiKeyOpenai
          : iaProveedor === "deepseek"
          ? iaApiKeyDeepseek
          : iaProveedor === "github"
          ? iaApiKeyGithub
          : "";

      const activeUrl =
        iaProveedor === "openai"
          ? iaApiUrlOpenai
          : iaProveedor === "deepseek"
          ? iaApiUrlDeepseek
          : iaProveedor === "github"
          ? iaApiUrlGithub
          : iaProveedor === "ollama"
          ? iaApiUrlOllama
          : "";

      const res = await api.get("/configuracion/ia-modelos", {
        params: {
          provider: iaProveedor,
          api_key: activeKey,
          api_url: activeUrl,
        },
      });
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
    setIaApiKeyGemini(data.ia_api_key_gemini || "");
    setIaApiKeyOpenai(data.ia_api_key_openai || "");
    setIaApiKeyDeepseek(data.ia_api_key_deepseek || "");
    setIaApiKeyGithub(data.ia_api_key_github || "");
    setIaApiUrlOpenai(data.ia_api_url_openai || "");
    setIaApiUrlDeepseek(data.ia_api_url_deepseek || "");
    setIaApiUrlGithub(data.ia_api_url_github || "");
    setIaApiUrlOllama(data.ia_api_url_ollama || "");
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
      ia_api_key_gemini?: string;
      ia_api_key_openai?: string;
      ia_api_key_deepseek?: string;
      ia_api_key_github?: string;
      ia_api_url_openai?: string;
      ia_api_url_deepseek?: string;
      ia_api_url_github?: string;
      ia_api_url_ollama?: string;
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
      ia_api_key_gemini: iaApiKeyGemini,
      ia_api_key_openai: iaApiKeyOpenai,
      ia_api_key_deepseek: iaApiKeyDeepseek,
      ia_api_key_github: iaApiKeyGithub,
      ia_api_url_openai: iaApiUrlOpenai,
      ia_api_url_deepseek: iaApiUrlDeepseek,
      ia_api_url_github: iaApiUrlGithub,
      ia_api_url_ollama: iaApiUrlOllama,
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

      <div className="tabs tabs-boxed w-full bg-base-200 p-1 rounded-xl mb-6 flex overflow-x-auto gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={cn(
            "tab tab-sm md:tab-md flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-all py-2.5",
            activeTab === "general"
              ? "bg-base-100 text-primary shadow-sm"
              : "text-base-content/60 hover:text-base-content"
          )}
        >
          <Building2 className="h-4 w-4" />
          <span className="hidden sm:inline">Laboratorio y Marca</span>
          <span className="sm:hidden">Marca</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("operaciones")}
          className={cn(
            "tab tab-sm md:tab-md flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-all py-2.5",
            activeTab === "operaciones"
              ? "bg-base-100 text-primary shadow-sm"
              : "text-base-content/60 hover:text-base-content"
          )}
        >
          <Sliders className="h-4 w-4" />
          <span className="hidden sm:inline">Inventario y Demanda</span>
          <span className="sm:hidden">Operaciones</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("vencimientos")}
          className={cn(
            "tab tab-sm md:tab-md flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-all py-2.5",
            activeTab === "vencimientos"
              ? "bg-base-100 text-primary shadow-sm"
              : "text-base-content/60 hover:text-base-content"
          )}
        >
          <Bell className="h-4 w-4" />
          <span className="hidden sm:inline">Vencimientos</span>
          <span className="sm:hidden">Alertas</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("integraciones")}
          className={cn(
            "tab tab-sm md:tab-md flex-1 flex items-center justify-center gap-2 rounded-lg font-medium transition-all py-2.5",
            activeTab === "integraciones"
              ? "bg-base-100 text-primary shadow-sm"
              : "text-base-content/60 hover:text-base-content"
          )}
        >
          <Cpu className="h-4 w-4" />
          <span className="hidden sm:inline">Integraciones (IA/WA)</span>
          <span className="sm:hidden">Integraciones</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="card bg-base-100 border border-base-200 shadow-sm p-6 rounded-2xl mb-6">
        {/* ── TAB 1: GENERAL ── */}
        {activeTab === "general" && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <SectionTitle>Marca del Laboratorio</SectionTitle>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Logo corporativo</label>
                    <p className="text-xs text-base-content/50">
                      PNG o JPG, máx. 512 KB. Para reportes y PDF.
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
                          Sube el logo del laboratorio
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
                      PNG o JPG, máx. 2 MB. Fondo de la pantalla de inicio.
                    </p>

                    {loginPreview ? (
                      <div className="relative inline-block mt-1">
                        <img
                          src={loginPreview}
                          alt="Imagen de login"
                          className="h-20 w-auto rounded-lg border border-base-300 object-cover bg-base-200"
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
                          Sube la imagen de fondo
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
              </div>
            </div>

            <Divider />

            <div>
              <SectionTitle>Moneda Local</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Moneda del sistema</label>
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
                    Aparece en los precios del catálogo, solicitudes y reportes.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: OPERACIONES ── */}
        {activeTab === "operaciones" && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <SectionTitle>Frecuencia de Conteos</SectionTitle>
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Intervalo predeterminado de conteo</label>
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
                    Frecuencia global de conteo. Cada área puede sobreescribir este valor.
                  </p>
                </div>

                <div className="flex items-start justify-between gap-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Conteo ciego</label>
                    <p className="text-xs text-base-content/50 max-w-sm leading-relaxed">
                      Oculta el stock teórico esperado al realizar inventario, forzando al usuario a registrar los valores reales del anaquel.
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
            </div>

            <Divider />

            <div>
              <SectionTitle>Parámetros de Demanda</SectionTitle>
              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="w-4 h-4 text-base-content/40" />
                  <p className="text-xs text-base-content/50">
                    Algoritmo de cálculo de stock de seguridad y sugerencias de compra.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Cobertura mínima de seguridad</label>
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
                      Días de autonomía objetivo. Al caer bajo este número de días de stock, se generan alertas.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Tiempo de entrega habitual (Lead Time)</label>
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
                      Demora promedio en recibir un pedido (si el proveedor no tiene uno configurado).
                    </p>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <label className="text-sm font-medium">Reacción a variaciones de consumo</label>
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
                    <p className="text-xs text-base-content/50 leading-relaxed max-w-md">
                      {factorHistorialCorto <= 0.25
                        ? "Conservador — Prioriza el historial de consumo largo. Ideal si es muy predecible."
                        : factorHistorialCorto <= 0.55
                          ? "Moderado — Equilibrio recomendado entre consumo reciente e histórico."
                          : factorHistorialCorto <= 0.8
                            ? "Dinámico — Prioriza el consumo reciente. Reacciona rápido ante subidas."
                            : "Agresivo — Solo considera los consumos de los últimos días."}
                    </p>
                    <span className="text-xs font-mono text-base-content/30 ml-4 shrink-0 bg-base-200 px-2 py-0.5 rounded">
                      {factorHistorialCorto.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
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
                      Días de historial hacia atrás evaluados para calcular el consumo promedio diario (CPD).
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
                      Frecuencia planificada en la cual se revisa y repone stock de esta categoría.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: VENCIMIENTOS ── */}
        {activeTab === "vencimientos" && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <SectionTitle>Reglas de Vencimiento de Lotes</SectionTitle>
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Activar alertas de vencimiento</label>
                    <p className="text-xs text-base-content/50 max-w-sm leading-relaxed">
                      Habilita advertencias y bloqueos visuales en la recepción si un lote ingresado vencerá antes de consumirse o tiene vida útil muy corta.
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-4 rounded-xl bg-base-200/50 border border-base-200 animate-fade-in">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Vida útil mínima permitida</label>
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
                        Lotes con menos días de vigencia desde hoy alertarán inmediatamente al recibirse.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">Margen de tolerancia al desperdicio</label>
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
                        Porcentaje máximo permitido de merma estimada del lote recibido (por no usarse a tiempo) antes de alertar.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 4: INTEGRACIONES (IA / WHATSAPP) ── */}
        {activeTab === "integraciones" && (
          <div className="space-y-8 animate-fade-in">
            {/* IA PROVIDERS TABLE */}
            <div className="p-4 rounded-xl bg-base-200/30 border border-base-200">
              <div className="flex items-center gap-2 mb-4">
                <Brain className="w-5 h-5 text-primary" />
                <h3 className="text-sm font-semibold">Proveedores de Inteligencia Artificial (IA)</h3>
              </div>
              
              <div className="overflow-x-auto w-full">
                <table className="table w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-base-200">
                      <th className="text-[10px] uppercase font-bold text-base-content/50 py-3 w-16 text-center">Activo</th>
                      <th className="text-[10px] uppercase font-bold text-base-content/50 py-3">Proveedor</th>
                      <th className="text-[10px] uppercase font-bold text-base-content/50 py-3">Modelo Predeterminado / Selección</th>
                      <th className="text-[10px] uppercase font-bold text-base-content/50 py-3">Endpoint API URL</th>
                      <th className="text-[10px] uppercase font-bold text-base-content/50 py-3">Clave de API / Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Google Gemini */}
                    <tr className={cn("border-b border-base-100 hover:bg-base-200/30", iaProveedor === "gemini" && "bg-primary/5")}>
                      <td className="text-center py-4">
                        <input
                          type="radio"
                          name="ia_proveedor"
                          className="radio radio-primary radio-xs"
                          checked={iaProveedor === "gemini"}
                          onChange={() => {
                            setIaProveedor("gemini");
                            setIsCustomModel(false);
                            setIaModelo("gemini-2.5-flash");
                          }}
                        />
                      </td>
                      <td className="font-semibold py-4">
                        Google Gemini
                      </td>
                      <td className="py-4">
                        {iaProveedor === "gemini" ? (
                          <div className="flex flex-col gap-1 w-48">
                            <select
                              className="select select-bordered select-xs w-full font-medium"
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
                                  <option value="gemini-2.5-flash">gemini-2.5-flash (Rápido)</option>
                                  <option value="gemini-2.5-pro">gemini-2.5-pro (Avanzado)</option>
                                  <option value="gemini-1.5-flash">gemini-1.5-flash (Básico)</option>
                                  <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                                </>
                              )}
                              <option value="custom">Otro...</option>
                            </select>
                            {isCustomModel && (
                              <input
                                type="text"
                                className="input input-bordered input-xs w-full mt-1"
                                placeholder="Modelo personalizado"
                                value={iaModelo}
                                onChange={(e) => setIaModelo(e.target.value)}
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-base-content/40 font-mono">gemini-2.5-flash</span>
                        )}
                      </td>
                      <td className="text-base-content/40 py-4 italic">
                        Estándar (Google Cloud)
                      </td>
                      <td className="py-4">
                        <div className="flex flex-col gap-1 w-44">
                          <div className="flex justify-between items-center h-4">
                            {iaApiKeyGemini === "***" ? (
                              <span className="text-[9px] text-success font-semibold">Configurada</span>
                            ) : iaApiKeyGemini ? (
                              <span className="text-[9px] text-warning font-semibold">Modificada</span>
                            ) : (
                              <span className="text-[9px] text-base-content/40">No configurada</span>
                            )}
                          </div>
                          <input
                            type="password"
                            className="input input-bordered input-xs w-full"
                            value={iaApiKeyGemini}
                            onChange={(e) => setIaApiKeyGemini(e.target.value)}
                            placeholder={iaApiKeyGemini === "***" ? "••••••••" : "API Key"}
                          />
                        </div>
                      </td>
                    </tr>

                    {/* OpenAI */}
                    <tr className={cn("border-b border-base-100 hover:bg-base-200/30", iaProveedor === "openai" && "bg-primary/5")}>
                      <td className="text-center py-4">
                        <input
                          type="radio"
                          name="ia_proveedor"
                          className="radio radio-primary radio-xs"
                          checked={iaProveedor === "openai"}
                          onChange={() => {
                            setIaProveedor("openai");
                            setIsCustomModel(false);
                            setIaModelo("gpt-4o-mini");
                          }}
                        />
                      </td>
                      <td className="font-semibold py-4">
                        OpenAI (ChatGPT)
                      </td>
                      <td className="py-4">
                        {iaProveedor === "openai" ? (
                          <div className="flex flex-col gap-1 w-48">
                            <select
                              className="select select-bordered select-xs w-full font-medium"
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
                                  <option value="gpt-4o-mini">gpt-4o-mini (Rápido)</option>
                                  <option value="gpt-4o">gpt-4o (Avanzado)</option>
                                </>
                              )}
                              <option value="custom">Otro...</option>
                            </select>
                            {isCustomModel && (
                              <input
                                type="text"
                                className="input input-bordered input-xs w-full mt-1"
                                placeholder="Modelo personalizado"
                                value={iaModelo}
                                onChange={(e) => setIaModelo(e.target.value)}
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-base-content/40 font-mono">gpt-4o-mini</span>
                        )}
                      </td>
                      <td className="py-4">
                        <input
                          type="text"
                          className="input input-bordered input-xs w-48 font-mono"
                          placeholder="https://api.openai.com/v1"
                          value={iaApiUrlOpenai}
                          onChange={(e) => setIaApiUrlOpenai(e.target.value)}
                        />
                      </td>
                      <td className="py-4">
                        <div className="flex flex-col gap-1 w-44">
                          <div className="flex justify-between items-center h-4">
                            {iaApiKeyOpenai === "***" ? (
                              <span className="text-[9px] text-success font-semibold">Configurada</span>
                            ) : iaApiKeyOpenai ? (
                              <span className="text-[9px] text-warning font-semibold">Modificada</span>
                            ) : (
                              <span className="text-[9px] text-base-content/40">No configurada</span>
                            )}
                          </div>
                          <input
                            type="password"
                            className="input input-bordered input-xs w-full"
                            value={iaApiKeyOpenai}
                            onChange={(e) => setIaApiKeyOpenai(e.target.value)}
                            placeholder={iaApiKeyOpenai === "***" ? "••••••••" : "API Key"}
                          />
                        </div>
                      </td>
                    </tr>

                    {/* DeepSeek */}
                    <tr className={cn("border-b border-base-100 hover:bg-base-200/30", iaProveedor === "deepseek" && "bg-primary/5")}>
                      <td className="text-center py-4">
                        <input
                          type="radio"
                          name="ia_proveedor"
                          className="radio radio-primary radio-xs"
                          checked={iaProveedor === "deepseek"}
                          onChange={() => {
                            setIaProveedor("deepseek");
                            setIsCustomModel(false);
                            setIaModelo("deepseek-chat");
                          }}
                        />
                      </td>
                      <td className="font-semibold py-4">
                        DeepSeek (IA China)
                      </td>
                      <td className="py-4">
                        {iaProveedor === "deepseek" ? (
                          <div className="flex flex-col gap-1 w-48">
                            <select
                              className="select select-bordered select-xs w-full font-medium"
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
                                  <option value="deepseek-chat">deepseek-chat (Recomendado)</option>
                                  <option value="deepseek-reasoner">deepseek-reasoner (R1)</option>
                                </>
                              )}
                              <option value="custom">Otro...</option>
                            </select>
                            {isCustomModel && (
                              <input
                                type="text"
                                className="input input-bordered input-xs w-full mt-1"
                                placeholder="Modelo personalizado"
                                value={iaModelo}
                                onChange={(e) => setIaModelo(e.target.value)}
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-base-content/40 font-mono">deepseek-chat</span>
                        )}
                      </td>
                      <td className="py-4">
                        <input
                          type="text"
                          className="input input-bordered input-xs w-48 font-mono"
                          placeholder="https://api.deepseek.com"
                          value={iaApiUrlDeepseek}
                          onChange={(e) => setIaApiUrlDeepseek(e.target.value)}
                        />
                      </td>
                      <td className="py-4">
                        <div className="flex flex-col gap-1 w-44">
                          <div className="flex justify-between items-center h-4">
                            {iaApiKeyDeepseek === "***" ? (
                              <span className="text-[9px] text-success font-semibold">Configurada</span>
                            ) : iaApiKeyDeepseek ? (
                              <span className="text-[9px] text-warning font-semibold">Modificada</span>
                            ) : (
                              <span className="text-[9px] text-base-content/40">No configurada</span>
                            )}
                          </div>
                          <input
                            type="password"
                            className="input input-bordered input-xs w-full"
                            value={iaApiKeyDeepseek}
                            onChange={(e) => setIaApiKeyDeepseek(e.target.value)}
                            placeholder={iaApiKeyDeepseek === "***" ? "••••••••" : "API Key"}
                          />
                        </div>
                      </td>
                    </tr>

                    {/* GitHub Models */}
                    <tr className={cn("border-b border-base-100 hover:bg-base-200/30", iaProveedor === "github" && "bg-primary/5")}>
                      <td className="text-center py-4">
                        <input
                          type="radio"
                          name="ia_proveedor"
                          className="radio radio-primary radio-xs"
                          checked={iaProveedor === "github"}
                          onChange={() => {
                            setIaProveedor("github");
                            setIsCustomModel(false);
                            setIaModelo("gpt-4o-mini");
                          }}
                        />
                      </td>
                      <td className="font-semibold py-4">
                        GitHub Models (Gratuito)
                      </td>
                      <td className="py-4">
                        {iaProveedor === "github" ? (
                          <div className="flex flex-col gap-1 w-48">
                            <select
                              className="select select-bordered select-xs w-full font-medium"
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
                                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                                  <option value="gpt-4o">gpt-4o</option>
                                  <option value="meta-llama-3.1-405b-instruct">Llama 3.1 405B</option>
                                  <option value="cohere-command-r-plus">Cohere Command R+</option>
                                </>
                              )}
                              <option value="custom">Otro...</option>
                            </select>
                            {isCustomModel && (
                              <input
                                type="text"
                                className="input input-bordered input-xs w-full mt-1"
                                placeholder="Modelo personalizado"
                                value={iaModelo}
                                onChange={(e) => setIaModelo(e.target.value)}
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-base-content/40 font-mono">gpt-4o-mini</span>
                        )}
                      </td>
                      <td className="py-4">
                        <input
                          type="text"
                          className="input input-bordered input-xs w-48 font-mono"
                          placeholder="https://models.inference.ai.azure.com"
                          value={iaApiUrlGithub}
                          onChange={(e) => setIaApiUrlGithub(e.target.value)}
                        />
                      </td>
                      <td className="py-4">
                        <div className="flex flex-col gap-1 w-44">
                          <div className="flex justify-between items-center h-4">
                            {iaApiKeyGithub === "***" ? (
                              <span className="text-[9px] text-success font-semibold">Configurada</span>
                            ) : iaApiKeyGithub ? (
                              <span className="text-[9px] text-warning font-semibold">Modificada</span>
                            ) : (
                              <span className="text-[9px] text-base-content/40">No configurada</span>
                            )}
                          </div>
                          <input
                            type="password"
                            className="input input-bordered input-xs w-full"
                            value={iaApiKeyGithub}
                            onChange={(e) => setIaApiKeyGithub(e.target.value)}
                            placeholder={iaApiKeyGithub === "***" ? "••••••••" : "Token / PAT"}
                          />
                        </div>
                      </td>
                    </tr>

                    {/* Ollama */}
                    <tr className={cn("hover:bg-base-200/30", iaProveedor === "ollama" && "bg-primary/5")}>
                      <td className="text-center py-4">
                        <input
                          type="radio"
                          name="ia_proveedor"
                          className="radio radio-primary radio-xs"
                          checked={iaProveedor === "ollama"}
                          onChange={() => {
                            setIaProveedor("ollama");
                            setIsCustomModel(true);
                            setIaModelo("llama3");
                          }}
                        />
                      </td>
                      <td className="font-semibold py-4">
                        Ollama (Servidor Local)
                      </td>
                      <td className="py-4">
                        {iaProveedor === "ollama" ? (
                          <div className="flex flex-col gap-1 w-48">
                            <input
                              type="text"
                              className="input input-bordered input-xs w-full"
                              placeholder="Ej: llama3"
                              value={iaModelo}
                              onChange={(e) => setIaModelo(e.target.value)}
                            />
                          </div>
                        ) : (
                          <span className="text-base-content/40 font-mono">llama3</span>
                        )}
                      </td>
                      <td className="py-4">
                        <input
                          type="text"
                          className="input input-bordered input-xs w-48 font-mono"
                          placeholder="Ej: http://localhost:11434"
                          value={iaApiUrlOllama}
                          onChange={(e) => setIaApiUrlOllama(e.target.value)}
                        />
                      </td>
                      <td className="py-4 text-base-content/30 italic">
                        No requiere API Key
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              {iaProveedor !== "ollama" && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    className="btn btn-outline btn-xs flex items-center gap-1.5"
                    onClick={fetchModelosDisponibles}
                    disabled={cargandoModelos}
                  >
                    <RefreshCw className={cn("h-3 w-3", cargandoModelos && "animate-spin")} />
                    Consultar Modelos Disponibles de la API
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="border-t border-base-200 pt-5 mt-6 flex justify-end">
          <button
            type="submit"
            className="btn btn-primary px-8"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <span className="loading loading-spinner loading-sm" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Guardar cambios
          </button>
        </div>
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
