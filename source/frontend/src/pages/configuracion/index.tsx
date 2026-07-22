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
  Sliders,
  Bell,
  Cpu,
  Database,
} from "lucide-react";
import LabCamposTab from "./lab-campos-tab";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import { PageLoading } from "@/components/ui/page-state";
import { cn } from "@/lib/utils";

interface Configuracion {
  nombre_laboratorio: string;
  logo_base64: string;
  login_imagen_base64: string;
  favicon_base64?: string;
  login_bg_color?: string;
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
  ia_api_key_groq?: string;
  ia_api_key_mistral?: string;
  ia_api_url_groq?: string;
  ia_api_url_mistral?: string;
  vencimiento_alerta_activa: boolean;
  vencimiento_vida_util_minima_dias: number;
  vencimiento_margen_tolerancia_pct: number;
  ia_modelos_configurados?: string;
  quarantine_default?: boolean;
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
  const faviconRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["configuracion"],
    queryFn: () => api.get<Configuracion>("/configuracion").then((r) => r.data),
  });

  const [activeTab, setActiveTab] = useState<"general" | "operaciones" | "vencimientos" | "integraciones" | "campos">("general");
  const [nombre, setNombre] = useState("");
  const [logo, setLogo] = useState("");
  const [preview, setPreview] = useState("");
  const [loginImagen, setLoginImagen] = useState("");
  const [loginPreview, setLoginPreview] = useState("");
  const [faviconBase64, setFaviconBase64] = useState("");
  const [loginBgColor, setLoginBgColor] = useState("#1a1a2e");
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
  const [iaModelo, setIaModelo] = useState("auto");
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
  const [iaApiKeyGroq, setIaApiKeyGroq] = useState("");
  const [iaApiKeyMistral, setIaApiKeyMistral] = useState("");
  const [iaApiUrlGroq, setIaApiUrlGroq] = useState("");
  const [iaApiUrlMistral, setIaApiUrlMistral] = useState("");
  const [iaModelosConfigurados, setIaModelosConfigurados] = useState("");
  const [vencimientoAlertaActiva, setVencimientoAlertaActiva] = useState(true);
  const [vencimientoVidaUtilMinimaDias, setVencimientoVidaUtilMinimaDias] = useState(30);
  const [vencimientoMargenToleranciaPct, setVencimientoMargenToleranciaPct] = useState(10);
  const [quarantineDefault, setQuarantineDefault] = useState(true);

  interface CustomModel {
    id: string;
    name: string;
    provider: string;
    model: string;
    api_url: string;
    api_key: string;
    active: boolean;
  }

  const [modelsList, setModelsList] = useState<CustomModel[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editModelId, setEditModelId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("gemini");
  const [formModel, setFormModel] = useState("auto");
  const [manualModelOverride, setManualModelOverride] = useState(false);
  const [formApiUrl, setFormApiUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [isDiscoveringModels, setIsDiscoveringModels] = useState(false);
  const [modelDiscoveryMessage, setModelDiscoveryMessage] = useState("");
  const discoveryAbortRef = useRef<AbortController | null>(null);

  async function handleDiscoverModels() {
    discoveryAbortRef.current?.abort();
    const controller = new AbortController();
    discoveryAbortRef.current = controller;
    setIsDiscoveringModels(true);
    setModelDiscoveryMessage("");
    try {
      const response = await api.post<string[]>(
        "/configuracion/ia-modelos",
        {
          provider: formProvider,
          api_key: formApiKey || undefined,
          api_url: formApiUrl || undefined,
        },
        { signal: controller.signal, timeout: 12_000 },
      );
      setDiscoveredModels(response.data);
      setModelDiscoveryMessage(
        response.data.length > 0
          ? `${response.data.length} modelo(s) compatible(s) detectado(s).`
          : "El proveedor no informó modelos multimodales compatibles.",
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setDiscoveredModels([]);
      const message = (error as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      setModelDiscoveryMessage(
        message || "No se pudo consultar el proveedor. Revise la credencial y el endpoint.",
      );
    } finally {
      if (discoveryAbortRef.current === controller) {
        discoveryAbortRef.current = null;
        setIsDiscoveringModels(false);
      }
    }
  }



  useEffect(() => {
    if (!data) return;
    setNombre(data.nombre_laboratorio);
    setLogo(data.logo_base64);
    setPreview(data.logo_base64);
    setLoginImagen(data.login_imagen_base64 || "");
    setLoginPreview(data.login_imagen_base64 || "");
    setFaviconBase64(data.favicon_base64 || "");
    setLoginBgColor(data.login_bg_color || "#1a1a2e");
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
    const currentModel = data.ia_modelo || "auto";
    setIaModelo(currentModel);
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
    setIaApiKeyGroq(data.ia_api_key_groq || "");
    setIaApiKeyMistral(data.ia_api_key_mistral || "");
    setIaApiUrlGroq(data.ia_api_url_groq || "");
    setIaApiUrlMistral(data.ia_api_url_mistral || "");
    setIaModelosConfigurados(data.ia_modelos_configurados || "");
    try {
      const parsed = JSON.parse(data.ia_modelos_configurados || "[]");
      setModelsList(Array.isArray(parsed) ? parsed : []);
    } catch {
      setModelsList([]);
    }
    setVencimientoAlertaActiva(data.vencimiento_alerta_activa !== false);
    setVencimientoVidaUtilMinimaDias(data.vencimiento_vida_util_minima_dias ?? 30);
    setVencimientoMargenToleranciaPct(data.vencimiento_margen_tolerancia_pct ?? 10);
    if (data.quarantine_default != null) setQuarantineDefault(data.quarantine_default);
  }, [data]);

  useEffect(() => () => discoveryAbortRef.current?.abort(), []);

  const mutation = useMutation({
    mutationFn: (payload: {
      nombre_laboratorio: string;
      logo_base64: string;
      login_imagen_base64: string;
      favicon_base64?: string;
      login_bg_color?: string;
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
      ia_api_key_groq?: string;
      ia_api_key_mistral?: string;
      ia_api_url_groq?: string;
      ia_api_url_mistral?: string;
      ia_modelos_configurados?: string;
      vencimiento_alerta_activa: boolean;
      vencimiento_vida_util_minima_dias: number;
      vencimiento_margen_tolerancia_pct: number;
      quarantine_default: boolean;
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

  function handleFavicon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024) {
      notify.error("El favicon no puede superar 50 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setFaviconBase64(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveFavicon() {
    setFaviconBase64("");
    if (faviconRef.current) faviconRef.current.value = "";
  }

  const handleSaveModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      notify.error("El nombre identificador es requerido");
      return;
    }
    const selectedModel = formModel.trim() || "auto";

    let updatedList: CustomModel[];
    if (editModelId) {
      updatedList = modelsList.map((m) =>
        m.id === editModelId
          ? {
              ...m,
              name: formName.trim(),
              provider: formProvider,
              model: selectedModel,
              api_url: formApiUrl.trim(),
              api_key: formApiKey.trim(),
            }
          : m
      );
      notify.success("Modelo modificado en la lista");
    } else {
      const newModel: CustomModel = {
        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7),
        name: formName.trim(),
        provider: formProvider,
        model: selectedModel,
        api_url: formApiUrl.trim(),
        api_key: formApiKey.trim(),
        active: modelsList.length === 0,
      };
      updatedList = [...modelsList, newModel];
      notify.success("Modelo agregado a la lista");
    }

    setModelsList(updatedList);
    setIaModelosConfigurados(JSON.stringify(updatedList));

    // Clear form
    setFormName("");
    setFormProvider("gemini");
    setFormModel("auto");
    setManualModelOverride(false);
    setFormApiUrl("");
    setFormApiKey("");
    setEditModelId(null);
    setIsFormOpen(false);
  };

  const handleEditModelClick = (model: CustomModel) => {
    setEditModelId(model.id);
    setFormName(model.name);
    setFormProvider(model.provider);
    setFormModel(model.model);
    setManualModelOverride(model.model !== "auto");
    setDiscoveredModels([]);
    setModelDiscoveryMessage("");
    setFormApiUrl(model.api_url);
    setFormApiKey(model.api_key);
    setIsFormOpen(true);
  };

  const handleDeleteModel = (id: string) => {
    const modelToDelete = modelsList.find((m) => m.id === id);
    const updatedList = modelsList.filter((m) => m.id !== id);
    
    if (modelToDelete?.active && updatedList.length > 0) {
      updatedList[0].active = true;
      activateModelConfig(updatedList[0]);
    } else if (updatedList.length === 0) {
      setIaProveedor("gemini");
      setIaModelo("auto");
      setIaApiUrl("");
      setIaApiKey("");
    }
    
    setModelsList(updatedList);
    setIaModelosConfigurados(JSON.stringify(updatedList));
    notify.success("Modelo eliminado");
  };

  const activateModelConfig = (model: CustomModel) => {
    setIaProveedor(model.provider);
    setIaModelo(model.model);
    setIaApiUrl(model.api_url);
    setIaApiKey(model.api_key);

    if (model.provider === "gemini") {
      setIaApiKeyGemini(model.api_key);
    } else if (model.provider === "openai") {
      setIaApiKeyOpenai(model.api_key);
      setIaApiUrlOpenai(model.api_url);
    } else if (model.provider === "deepseek") {
      setIaApiKeyDeepseek(model.api_key);
      setIaApiUrlDeepseek(model.api_url);
    } else if (model.provider === "github") {
      setIaApiKeyGithub(model.api_key);
      setIaApiUrlGithub(model.api_url);
    } else if (model.provider === "groq") {
      setIaApiKeyGroq(model.api_key);
      setIaApiUrlGroq(model.api_url);
    } else if (model.provider === "mistral") {
      setIaApiKeyMistral(model.api_key);
      setIaApiUrlMistral(model.api_url);
    } else if (model.provider === "ollama") {
      setIaApiUrlOllama(model.api_url);
    }
  };

  const handleToggleActiveModel = (id: string) => {
    const updatedList = modelsList.map((m) => {
      const active = m.id === id;
      if (active) {
        activateModelConfig(m);
      }
      return { ...m, active };
    });
    setModelsList(updatedList);
    setIaModelosConfigurados(JSON.stringify(updatedList));
    notify.success("Modelo activado como predeterminado");
  };

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
      favicon_base64: faviconBase64 || undefined,
      login_bg_color: loginBgColor || undefined,
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
      ia_api_key_groq: iaApiKeyGroq,
      ia_api_key_mistral: iaApiKeyMistral,
      ia_api_url_groq: iaApiUrlGroq,
      ia_api_url_mistral: iaApiUrlMistral,
      ia_modelos_configurados: iaModelosConfigurados,
      vencimiento_alerta_activa: vencimientoAlertaActiva,
      vencimiento_vida_util_minima_dias: vencimientoVidaUtilMinimaDias,
      vencimiento_margen_tolerancia_pct: vencimientoMargenToleranciaPct,
      quarantine_default: quarantineDefault,
    });
  }

  if (isLoading) return <PageLoading label="Cargando configuración..." />;

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="t-h1 tracking-tight">Configuración</h1>
        <p className="text-sm text-base-content/50 mt-1">
          Ajustes generales del sistema de inventario
        </p>
      </div>

      <div className="bg-base-200 p-1 rounded-xl mb-6 flex overflow-x-auto gap-1 scrollbar-hide">
        {([
          { key: "general" as const, icon: Building2, full: "Laboratorio y Marca", short: "Marca" },
          { key: "operaciones" as const, icon: Sliders, full: "Inventario y Demanda", short: "Operaciones" },
          { key: "vencimientos" as const, icon: Bell, full: "Vencimientos", short: "Alertas" },
          { key: "integraciones" as const, icon: Cpu, full: "Modelos de IA", short: "IA" },
          { key: "campos" as const, icon: Database, full: "Campos del Laboratorio", short: "Campos" },
        ]).map(({ key, icon: Icon, full, short }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={cn(
              "shrink-0 flex items-center justify-center gap-2 rounded-lg font-medium transition-all py-2 px-3 md:py-2.5 md:px-4 text-xs md:text-sm",
              activeTab === key
                ? "bg-base-100 text-primary shadow-sm"
                : "text-base-content/60 hover:text-base-content"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">{full}</span>
            <span className="sm:hidden">{short}</span>
          </button>
        ))}
      </div>
      <div className="card bg-base-100 border border-base-200 shadow-sm p-6 rounded-2xl mb-6">
        {activeTab === "campos" ? (
          <div className="animate-fade-in">
            <LabCamposTab />
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
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

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Favicon</label>
                  <p className="text-xs text-base-content/50">
                    Icono del navegador. Máx. 50 KB.
                  </p>
                  {faviconBase64 ? (
                    <div className="flex items-center gap-3 mt-1">
                      <img
                        src={faviconBase64}
                        alt="Favicon"
                        className="h-8 w-8 rounded border border-base-300"
                      />
                      <button
                        type="button"
                        onClick={handleRemoveFavicon}
                        className="btn btn-ghost btn-xs text-error"
                      >
                        <X className="h-3 w-3" /> Quitar
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => faviconRef.current?.click()}
                      className="flex items-center gap-3 h-12 px-4 border border-dashed border-base-300 rounded-lg cursor-pointer hover:border-primary hover:bg-base-200/50 transition-colors mt-1"
                    >
                      <Upload className="h-4 w-4 opacity-40" />
                      <span className="text-sm text-base-content/40">
                        Sube el favicon
                      </span>
                    </div>
                  )}
                  <input
                    ref={faviconRef}
                    type="file"
                    accept="image/x-icon,image/png,image/svg+xml"
                    className="hidden"
                    onChange={handleFavicon}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Color de fondo del login</label>
                  <p className="text-xs text-base-content/50">
                    Se usa cuando no hay imagen de login configurada.
                  </p>
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="color"
                      className="h-10 w-14 rounded border border-base-300 cursor-pointer"
                      value={loginBgColor}
                      onChange={(e) => setLoginBgColor(e.target.value)}
                    />
                    <input
                      type="text"
                      className="input input-bordered input-sm w-28 font-mono"
                      value={loginBgColor}
                      onChange={(e) => setLoginBgColor(e.target.value)}
                      placeholder="#1a1a2e"
                      maxLength={7}
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

            <Divider />

            <div>
              <SectionTitle>Importación con IA</SectionTitle>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 p-4 bg-base-200/40 rounded-xl border border-base-200">
                  <div className="space-y-1" title="Al recibir una guía de despacho con IA, los productos nuevos se crean en cuarentena (pendientes de aprobación) en lugar de activos directamente.">
                    <p className="text-sm font-medium">Cuarentena por defecto</p>
                    <p className="text-xs text-base-content/50">
                      Los productos nuevos importados desde guía de despacho con IA se crean en cuarentena por defecto.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-warning"
                    checked={quarantineDefault}
                    onChange={(e) => setQuarantineDefault(e.target.checked)}
                  />
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
            {/* IA MODELS LIST SECTION */}
            <div className="p-4 rounded-xl bg-base-200/30 border border-base-200">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-primary" />
                  <h3 className="text-sm font-semibold">Modelos de Inteligencia Artificial (IA)</h3>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-xs"
                  onClick={() => {
                    setEditModelId(null);
                    setFormName("");
                    setFormProvider("gemini");
                    setFormModel("auto");
                    setManualModelOverride(false);
                    setDiscoveredModels([]);
                    setModelDiscoveryMessage("");
                    setFormApiUrl("");
                    setFormApiKey("");
                    setIsFormOpen(true);
                  }}
                >
                  + Agregar Modelo
                </button>
              </div>

              {/* FORM TO ADD/EDIT MODEL */}
              {isFormOpen && (
                <div className="p-4 mb-6 rounded-xl bg-base-100 border border-base-200 shadow-sm animate-fade-in">
                  <h4 className="text-xs font-bold uppercase tracking-wider mb-4 text-base-content/75">
                    {editModelId ? "Editar Configuración de Modelo" : "Agregar Nuevo Modelo"}
                  </h4>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Nombre identificador</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full"
                          placeholder="Ej: Gemini Flash Productividad"
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Proveedor de IA</label>
                        <select
                          className="select select-bordered select-sm w-full"
                          value={formProvider}
                          onChange={(e) => {
                            const prov = e.target.value;
                            setFormProvider(prov);
                            setFormModel("auto");
                            setManualModelOverride(false);
                            setDiscoveredModels([]);
                            setModelDiscoveryMessage("");
                            if (prov === "gemini") {
                              setFormApiUrl("");
                            } else if (prov === "openai") {
                              setFormApiUrl("https://api.openai.com/v1");
                            } else if (prov === "deepseek") {
                              setFormApiUrl("https://api.deepseek.com");
                            } else if (prov === "github") {
                              setFormApiUrl("https://models.inference.ai.azure.com");
                            } else if (prov === "groq") {
                              setFormApiUrl("https://api.groq.com/openai");
                            } else if (prov === "mistral") {
                              setFormApiUrl("https://api.mistral.ai");
                            } else if (prov === "ollama") {
                              setFormApiUrl("http://localhost:11434");
                            }
                          }}
                        >
                          <option value="gemini">Google Gemini</option>
                          <option value="openai">OpenAI (ChatGPT)</option>
                          <option value="deepseek">DeepSeek</option>
                          <option value="github">GitHub Models</option>
                          <option value="groq">Groq Developer</option>
                          <option value="mistral">Mistral AI</option>
                          <option value="ollama">Ollama (Local)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5 md:col-span-1">
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-xs font-medium">Modelo multimodal</label>
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            onClick={() => {
                              setManualModelOverride((value) => !value);
                              setFormModel("auto");
                            }}
                          >
                            {manualModelOverride ? "Usar automático" : "Avanzado"}
                          </button>
                        </div>
                        {manualModelOverride ? (
                          <input
                            type="text"
                            className="input input-bordered input-sm w-full font-mono text-xs"
                            placeholder="Nombre exacto del modelo multimodal"
                            value={formModel === "auto" ? "" : formModel}
                            onChange={(e) => setFormModel(e.target.value)}
                          />
                        ) : (
                          <select
                            className="select select-bordered select-sm w-full font-mono text-xs"
                            value={discoveredModels.includes(formModel) ? formModel : "auto"}
                            onChange={(e) => setFormModel(e.target.value)}
                          >
                            <option value="auto">Automático (recomendado)</option>
                            {discoveredModels.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        )}
                        {!manualModelOverride && (
                          <button
                            type="button"
                            className="btn btn-outline btn-xs w-full"
                            onClick={handleDiscoverModels}
                            disabled={isDiscoveringModels}
                          >
                            {isDiscoveringModels ? "Consultando proveedor…" : "Actualizar modelos disponibles"}
                          </button>
                        )}
                        <span className="text-[10px] text-base-content/50">
                          {modelDiscoveryMessage || "Automático validará el mejor modelo al analizar."}
                        </span>
                      </div>

                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium">Endpoint API URL</label>
                        <input
                          type="text"
                          className="input input-bordered input-sm w-full font-mono text-xs"
                          placeholder={formProvider === "gemini" ? "Predeterminado" : "Ej: https://..."}
                          value={formApiUrl}
                          onChange={(e) => {
                            setFormApiUrl(e.target.value);
                            setDiscoveredModels([]);
                            setModelDiscoveryMessage("");
                          }}
                          disabled={formProvider === "gemini"}
                        />
                      </div>

                      <div className="space-y-1.5 md:col-span-1">
                        <label className="text-xs font-medium">Clave de API / Token</label>
                        <input
                          type="password"
                          className="input input-bordered input-sm w-full font-mono text-xs"
                          placeholder={formProvider === "ollama" ? "No requerido" : formApiKey === "***" ? "••••••••" : "API Key"}
                          value={formApiKey}
                          onChange={(e) => {
                            setFormApiKey(e.target.value);
                            setDiscoveredModels([]);
                            setModelDiscoveryMessage("");
                          }}
                          disabled={formProvider === "ollama"}
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setIsFormOpen(false);
                          setEditModelId(null);
                        }}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleSaveModel}
                      >
                        {editModelId ? "Guardar Cambios" : "Agregar a la Lista"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* LIST OF MODELS (GRID OF CARDS) */}
              <div className="w-full">
                {modelsList.length === 0 ? (
                  <div className="text-center py-8 text-base-content/40 bg-base-100 rounded-xl border border-dashed border-base-300">
                    <p className="text-sm">No tienes modelos de IA configurados.</p>
                    <p className="text-xs mt-1">Haz clic en "+ Agregar Modelo" para configurar tu primer modelo.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {modelsList.map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "p-4 rounded-xl border transition-all flex flex-col justify-between shadow-sm hover:shadow-md",
                          m.active
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "border-base-200 bg-base-100"
                        )}
                      >
                        <div>
                          <div className="flex justify-between items-start gap-2 mb-3">
                            <div className="font-semibold text-sm truncate max-w-[180px]" title={m.name}>
                              {m.name}
                            </div>
                            <span
                              className={cn(
                                "badge badge-xs text-[10px] px-2 py-1.5 font-bold text-white shrink-0",
                                m.provider === "gemini" ? "bg-blue-600 border-blue-600" :
                                m.provider === "openai" ? "bg-green-600 border-green-600" :
                                m.provider === "deepseek" ? "bg-sky-500 border-sky-500" :
                                m.provider === "github" ? "bg-gray-800 border-gray-800" :
                                m.provider === "groq" ? "bg-orange-500 border-orange-500" :
                                m.provider === "mistral" ? "bg-red-500 border-red-500" :
                                "bg-purple-600 border-purple-600"
                              )}
                            >
                              {m.provider === "gemini" ? "Gemini" :
                               m.provider === "openai" ? "OpenAI" :
                               m.provider === "deepseek" ? "DeepSeek" :
                               m.provider === "github" ? "GitHub" :
                               m.provider === "groq" ? "Groq" :
                               m.provider === "mistral" ? "Mistral" : "Ollama"}
                            </span>
                          </div>
                          <div className="text-xs text-base-content/70 space-y-1.5 font-sans">
                            <div className="flex justify-between gap-2">
                              <span className="text-base-content/50">Modelo:</span>
                              <code className="font-mono text-[11px] bg-base-200/50 px-1.5 py-0.5 rounded truncate max-w-[160px]">{m.model === "auto" ? "Automático" : m.model}</code>
                            </div>
                            {m.api_url && (
                              <div className="flex justify-between gap-2">
                                <span className="text-base-content/50">Endpoint:</span>
                                <span className="font-mono text-[11px] truncate max-w-[160px]" title={m.api_url}>
                                  {m.api_url}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between gap-2">
                              <span className="text-base-content/50">API Key:</span>
                              <span>
                                {m.provider === "ollama" ? (
                                  <span className="italic text-base-content/40">No requiere</span>
                                ) : m.api_key === "***" ? (
                                  <span className="text-success font-medium">Configurada</span>
                                ) : m.api_key ? (
                                  <span className="text-warning font-medium">Modificada</span>
                                ) : (
                                  <span className="text-base-content/40 italic">No configurada</span>
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center justify-between border-t border-base-200/60 pt-3">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="radio"
                              name="active_model"
                              className="radio radio-primary radio-xs"
                              checked={m.active}
                              onChange={() => handleToggleActiveModel(m.id)}
                            />
                            <span className="text-xs font-semibold">Activo</span>
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-primary font-semibold hover:bg-primary/10"
                              onClick={() => handleEditModelClick(m)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-error font-semibold hover:bg-error/10"
                              onClick={() => handleDeleteModel(m.id)}
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
        )}
      </div>

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
