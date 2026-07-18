// frontend/src/pages/solicitudes-compra/hooks/useSolicitudState.ts
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import { toDecimal, toNum } from "@/domain/parse";
import { getApiErrorCode, getApiStatus, parseApiError } from "@/lib/api-error";
import { useAuthStore } from "@/hooks/use-auth-store";
import type {
  PaginatedResponse,
  SolicitudResumen,
  SolicitudDetalle,
  SolicitudItem,
  ItemRecomendado,
  UpdateSolicitudRequest,
  RegistrarEnvioInput,
  CancelarEnvioInput,
  Producto,
  Proveedor,
} from "@/types";
import { calcularCantidad, fetchHorizonte } from "../solicitud-utils";


export function useSolicitudState() {
  useAuthStore();
  const queryClient = useQueryClient();
  const location = useLocation();

  const [view, setView] = useState<"crear" | "historial">("crear");
  const [proveedoresFiltro, setProveedoresFiltro] = useState<Proveedor[]>([]);
  const selectedProveedor =
    proveedoresFiltro[proveedoresFiltro.length - 1] ?? null;
  const [items, setItems] = useState<SolicitudItem[]>([]);
  const [solicitudId, setSolicitudId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [historialSearch, setHistorialSearch] = useState("");
  const [historialEstado, setHistorialEstado] = useState<string | null>(null);
  const [selectedSolicitudId, setSelectedSolicitudId] = useState<string | null>(
    null,
  );
  const [pdfFirmaLabel, setPdfFirmaLabel] = useState("");
  const [horizonteGlobal, setHorizonteGlobal] = useState<number>(30);
  const [tabIzquierdo, setTabIzquierdo] = useState<"quiebres" | "buscar">(
    "buscar",
  );
  const [popoverOpenId, setPopoverOpenId] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(true);
  const borradorCargado = useRef(false);

  const [diasVencimiento, setDiasVencimientoState] = useState<number>(() => {
    const v = localStorage.getItem("solicitud-dias-vencimiento");
    return v ? parseInt(v) : 30;
  });
  const setDiasVencimiento = (dias: number) => {
    setDiasVencimientoState(dias);
    localStorage.setItem("solicitud-dias-vencimiento", String(dias));
  };

  const [modoRevision, setModoRevision] = useState(
    () => localStorage.getItem("solicitud-modo") !== "avanzado",
  );
  const [descartados, setDescartados] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("solicitud-descartados") ?? "[]"),
      );
    } catch {
      return new Set();
    }
  });

  const setModo = (revision: boolean) => {
    setModoRevision(revision);
    localStorage.setItem("solicitud-modo", revision ? "revision" : "avanzado");
  };

  const handleDescartar = (productoId: string) => {
    setDescartados((prev) => {
      const next = new Set(prev);
      next.add(productoId);
      localStorage.setItem("solicitud-descartados", JSON.stringify([...next]));
      return next;
    });
  };

  const handleRestaurar = (productoId: string) => {
    setDescartados((prev) => {
      const next = new Set(prev);
      next.delete(productoId);
      localStorage.setItem("solicitud-descartados", JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => {
    if (location.state?.view) setView(location.state.view);
    if (location.state?.estado) setHistorialEstado(location.state.estado);
  }, [location.state]);

  useEffect(() => {
    if (!popoverOpenId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-popover-item]")) setPopoverOpenId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverOpenId]);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: proveedores, isLoading: isLoadingProveedores } = useQuery({
    queryKey: ["proveedores-activos"],
    queryFn: () => api.get<Proveedor[]>("/proveedores").then((r) => r.data),
    staleTime: 300_000,
  });

  const { data: recomendaciones, isLoading: isLoadingRecs } = useQuery({
    queryKey: ["solicitudes-recomendaciones"],
    queryFn: () =>
      api
        .get<{ data: ItemRecomendado[] }>("/solicitudes-compra/recomendaciones")
        .then((r) => r.data.data),
    enabled: view === "crear",
  });

  const { data: historial, isLoading: isLoadingHistorial } = useQuery({
    queryKey: ["solicitudes-historial", historialSearch, historialEstado],
    queryFn: () =>
      api
        .get<PaginatedResponse<SolicitudResumen>>("/solicitudes-compra", {
          params: {
            q: historialSearch || undefined,
            estado: historialEstado || undefined,
            per_page: 50,
          },
        })
        .then((r) => r.data),
    enabled: view === "historial",
  });

  const { data: configuracion } = useQuery({
    queryKey: ["configuracion"],
    queryFn: () =>
      api
        .get<{
          nombre_laboratorio: string;
          logo_base64: string;
          moneda_simbolo: string;
          moneda_codigo: string;
        }>("/configuracion")
        .then((r) => r.data),
    staleTime: 300_000,
  });

  const { data: vencimientoData } = useQuery({
    queryKey: ["lotes-por-vencer-por-proveedor", diasVencimiento],
    queryFn: () =>
      api
        .get<
          Array<{
            proveedor_id: number | null;
            lotes_por_vencer: number;
            productos_por_vencer: number;
          }>
        >("/lotes/por-vencer-por-proveedor", { params: { dias: diasVencimiento } })
        .then((r) => r.data),
    enabled: view === "crear" && proveedoresFiltro.length === 0,
    staleTime: 60_000,
  });

  const vencimientoByProveedor: Record<
    number,
    { lotes: number; productos: number }
  > = {};
  for (const item of vencimientoData ?? []) {
    if (item.proveedor_id != null) {
      vencimientoByProveedor[item.proveedor_id] = {
        lotes: Number(item.lotes_por_vencer),
        productos: Number(item.productos_por_vencer),
      };
    }
  }

  const monedaCodigo = configuracion?.moneda_codigo ?? "CLP";

  // ── Restauración del borrador ────────────────────────────────────────────────

  useEffect(() => {
    if (view !== "crear" || borradorCargado.current) return;
    borradorCargado.current = true;

    async function restaurar() {
      setRestaurando(true);
      try {
        const [borradorRes, proveedoresRes] = await Promise.all([
          api.get<{ borrador: SolicitudDetalle | null }>(
            "/solicitudes-compra/borrador",
          ),
          api.get<Proveedor[]>("/proveedores"),
        ]);
        const b = borradorRes.data.borrador;
        const provs = proveedoresRes.data;

        const borradorItems: SolicitudItem[] = b
          ? b.items.map((item) => ({
              producto_id: item.producto_id,
              producto_nombre: item.producto_nombre,
              codigo_proveedor: item.codigo_proveedor,
              codigo_maestro: item.codigo_maestro,
              proveedor_id: item.proveedor_id,
              proveedor_nombre: item.proveedor_nombre || "Desconocido",
              lead_time: 0,
              presentacion_id: item.presentacion_id,
              presentacion_nombre: item.presentacion_nombre,
              presentacion_nombre_plural: item.presentacion_nombre_plural,
              factor_conversion: item.factor_conversion
                ? toNum(item.factor_conversion)
                : null,
              unidad_base: item.unidad,
              unidad_base_plural: item.unidad_plural ?? item.unidad,
              unidad_basica_id: item.unidad_basica_id,
              cantidad: toNum(item.cantidad_sugerida),
              precio_unitario: item.precio_unitario
                ? toNum(item.precio_unitario)
                : 0,
              imagen_url: item.imagen_url,
              consumo_diario: 0,
              stock_actual: 0,
              stock_minimo: 0,
              horizonte_dias: item.horizonte_dias ?? null,
              horizonte_sugerido: item.horizonte_sugerido ?? null,
              horizonte_razon: item.horizonte_razon ?? null,
            }))
          : [];

        if (b) setSolicitudId(b.id);

        if (borradorItems.length > 0) {
          const savedIds = JSON.parse(
            localStorage.getItem("solicitud_proveedores_ids") ?? "[]",
          ) as number[];
          const ids =
            savedIds.length > 0
              ? savedIds
              : ([
                  ...new Set(
                    borradorItems.map((i) => i.proveedor_id).filter(Boolean),
                  ),
                ] as number[]);
          setProveedoresFiltro(
            ids
              .map((id) => provs.find((p) => p.id === id))
              .filter(Boolean) as Proveedor[],
          );
        }

        setItems(borradorItems);
      } catch (err) {
        console.warn("[solicitudes] Error restaurando borrador:", err);
      }
      setRestaurando(false);
    }

    restaurar();
  }, [view]);

  useEffect(() => {
    localStorage.setItem(
      "solicitud_proveedores_ids",
      JSON.stringify(proveedoresFiltro.map((p) => p.id)),
    );
  }, [proveedoresFiltro]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (data: UpdateSolicitudRequest) =>
      solicitudId
        ? api.put(`/solicitudes-compra/${solicitudId}`, data)
        : api.post("/solicitudes-compra", data),
    onSuccess: (res) => {
      if (!solicitudId) setSolicitudId(res.data.id);
      queryClient.invalidateQueries({ queryKey: ["solicitudes-historial"] });
      notify.success("Borrador guardado");
    },
    onError: (err: unknown) => {
      notify.error(parseApiError(err) || "Error al guardar borrador");
    },
  });

  const guardarMutation = useMutation({
    mutationFn: async () => {
      if (items.some((i) => i.proveedor_id == null)) {
        throw new Error("Todos los items deben tener proveedor asignado");
      }
      const saveData: UpdateSolicitudRequest = {
        nota: null,
        items: items.map((i) => ({
          producto_id: i.producto_id,
          cantidad_sugerida: i.cantidad.toString(),
          unidad_basica_id: i.unidad_basica_id,
          precio_unitario: i.precio_unitario.toString(),
          presentacion_id: i.presentacion_id,
          cantidad_presentaciones: i.cantidad.toString(),
          horizonte_dias: i.horizonte_dias ?? null,
          horizonte_sugerido: i.horizonte_sugerido ?? null,
          horizonte_razon: i.horizonte_razon ?? null,
        })),
      };
      let id = solicitudId;
      if (id) {
        await api.put(`/solicitudes-compra/${id}`, saveData);
      } else {
        const res = await api.post("/solicitudes-compra", saveData);
        id = res.data.id;
        setSolicitudId(id);
      }
      return api.post(`/solicitudes-compra/${id}/guardar`);
    },
    onSuccess: () => {
      notify.success("Solicitud guardada correctamente");
      setItems([]);
      setSolicitudId(null);
      setProveedoresFiltro([]);
      borradorCargado.current = false;
      localStorage.removeItem("solicitud_proveedores_ids");
      setView("historial");
      queryClient.invalidateQueries({ queryKey: ["solicitudes-historial"] });
    },
    onError: (err: unknown) => {
      notify.error(parseApiError(err) || "Error al guardar solicitud");
    },
  });

  const registrarEnvioMutation = useMutation({
    mutationFn: ({
      solicitudId,
      body,
    }: {
      solicitudId: string;
      body: RegistrarEnvioInput;
    }) =>
      api
        .post<SolicitudDetalle>(
          `/solicitudes-compra/${solicitudId}/envios`,
          body,
        )
        .then((r) => r.data),
    onSuccess: (data, { solicitudId }) => {
      queryClient.setQueryData(["solicitud-detail", solicitudId], data);
      queryClient.invalidateQueries({ queryKey: ["solicitudes-historial"] });
      notify.success(
        data.estado === "enviada"
          ? "Solicitud completamente enviada"
          : "Envio registrado",
      );
    },
    onError: (err: unknown) => {
      if (
        getApiErrorCode(err) === "VERSION_CONFLICT" ||
        getApiStatus(err) === 409
      ) {
        if (selectedSolicitudId)
          queryClient.invalidateQueries({
            queryKey: ["solicitud-detail", selectedSolicitudId],
          });
        notify.error("Version desactualizada, recarga la pagina");
      } else {
        notify.error(parseApiError(err) || "Error registrando envio");
      }
    },
  });

  const cancelarEnvioMutation = useMutation({
    mutationFn: ({
      solicitudId,
      proveedorId,
      body,
    }: {
      solicitudId: string;
      proveedorId: number;
      body: CancelarEnvioInput;
    }) =>
      api
        .delete<SolicitudDetalle>(
          `/solicitudes-compra/${solicitudId}/envios/${proveedorId}`,
          { data: body },
        )
        .then((r) => r.data),
    onSuccess: (data, { solicitudId }) => {
      queryClient.setQueryData(["solicitud-detail", solicitudId], data);
      queryClient.invalidateQueries({ queryKey: ["solicitudes-historial"] });
      notify.success("Envio cancelado");
    },
  });

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleAddFromRec = async (r: ItemRecomendado) => {
    if (items.find((i) => i.producto_id === r.producto_id)) {
      notify.error("Producto ya está en la lista");
      return;
    }
    const proveedorId = r.proveedor_id ?? selectedProveedor?.id ?? null;
    if (proveedorId == null) {
      notify.error("Todos los items deben tener proveedor asignado");
      return;
    }
    const horizData = await fetchHorizonte(r.producto_id, proveedorId);
    const consumoDiario = toNum(r.consumo_diario);
    const stockActual = toNum(r.stock_actual);
    const stockMinimo = toNum(r.stock_seguridad);
    const factorConv = r.factor_conversion ? toNum(r.factor_conversion) : null;
    const cantidadCalc = calcularCantidad(
      horizonteGlobal,
      consumoDiario,
      r.lead_time,
      stockMinimo,
      stockActual,
      factorConv,
    );
    const cantidad = r.confianza === "baja" ? 0 : cantidadCalc;

    setItems((prev) => [
      ...prev,
      {
        producto_id: r.producto_id,
        producto_nombre: r.producto_nombre,
        codigo_proveedor: r.codigo_proveedor,
        codigo_maestro: r.codigo_maestro,
        proveedor_id: proveedorId,
        proveedor_nombre: r.proveedor_nombre || "S/P",
        lead_time: r.lead_time,
        presentacion_id: r.presentacion_id,
        presentacion_nombre: r.presentacion_nombre,
        presentacion_nombre_plural: r.presentacion_nombre_plural,
        factor_conversion: factorConv,
        unidad_base: r.unidad_base,
        unidad_base_plural: r.unidad_base_plural || r.unidad_base,
        unidad_basica_id: r.unidad_basica_id ?? null,
        cantidad,
        precio_unitario: r.precio_ultima_recepcion
          ? toNum(r.precio_ultima_recepcion)
          : 0,
        imagen_url: r.imagen_url,
        consumo_diario: consumoDiario,
        stock_actual: stockActual,
        stock_minimo: stockMinimo,
        horizonte_dias: horizonteGlobal,
        horizonte_sugerido: horizData.horizonte_sugerido,
        horizonte_razon: horizData.razon,
        tipo_estimacion_demanda:
          r.confianza === "baja" ? "sin_historial" : "forecast",
        horizonte_personalizado: false,
      },
    ]);
  };

  const handleAddFromRecConCantidad = async (
    r: ItemRecomendado,
    cantidad: number,
  ) => {
    if (items.find((i) => i.producto_id === r.producto_id)) {
      notify.error("Producto ya está en la lista");
      return;
    }
    const proveedorId = r.proveedor_id ?? selectedProveedor?.id ?? null;
    if (proveedorId == null) {
      notify.error("Todos los items deben tener proveedor asignado");
      return;
    }
    const horizData = await fetchHorizonte(r.producto_id, proveedorId);
    const factorConv = r.factor_conversion ? toNum(r.factor_conversion) : null;
    setItems((prev) => [
      ...prev,
      {
        producto_id: r.producto_id,
        producto_nombre: r.producto_nombre,
        codigo_proveedor: r.codigo_proveedor,
        codigo_maestro: r.codigo_maestro,
        proveedor_id: proveedorId,
        proveedor_nombre: r.proveedor_nombre || "S/P",
        lead_time: r.lead_time,
        presentacion_id: r.presentacion_id,
        presentacion_nombre: r.presentacion_nombre,
        presentacion_nombre_plural: r.presentacion_nombre_plural,
        factor_conversion: factorConv,
        unidad_base: r.unidad_base,
        unidad_base_plural: r.unidad_base_plural || r.unidad_base,
        unidad_basica_id: r.unidad_basica_id ?? null,
        cantidad,
        precio_unitario: r.precio_ultima_recepcion
          ? toNum(r.precio_ultima_recepcion)
          : 0,
        imagen_url: r.imagen_url,
        consumo_diario: toNum(r.consumo_diario),
        stock_actual: toNum(r.stock_actual),
        stock_minimo: toNum(r.stock_seguridad),
        horizonte_dias: horizonteGlobal,
        horizonte_sugerido: horizData.horizonte_sugerido,
        horizonte_razon: horizData.razon,
        tipo_estimacion_demanda:
          r.confianza === "baja" ? "sin_historial" : "forecast",
        horizonte_personalizado: true,
      },
    ]);
  };

  const handleAddFromSearch = async (p: Producto) => {
    if (items.find((i) => i.producto_id === p.id)) {
      notify.error("Producto ya está en la lista");
      return;
    }

    // Fetch product detail and its presentations inline
    const [detailRes, presRes] = await Promise.all([
      api.get<any>(`/productos/${p.id}`),
      api.get<any[]>(`/productos/${p.id}/presentaciones`),
    ]);
    const detail = detailRes.data;
    const presentaciones = presRes.data;

    // Find the active presentation matching the provider, or default to the first active presentation
    const activePres =
      presentaciones.find(
        (pr: any) =>
          pr.activa &&
          (selectedProveedor === null ||
            pr.proveedor_id === selectedProveedor?.id),
      ) || presentaciones.find((pr: any) => pr.activa);

    const resolvedProveedorId = activePres?.proveedor_id ?? selectedProveedor?.id ?? null;
    if (resolvedProveedorId == null) {
      notify.warning(
        "Producto sin proveedor",
        `"${p.nombre}" no tiene proveedor asignado. Asígnaselo en el catálogo antes de guardar la solicitud.`,
      );
    }

    const provMatch = proveedores?.find((prov) => prov.id === resolvedProveedorId);
    const resolvedProveedorNombre = provMatch?.nombre ?? selectedProveedor?.nombre ?? "Manual";

    const factorConvSearch = activePres?.factor_conversion ? parseFloat(activePres.factor_conversion) : null;
    const leadTime = detail.lead_time_propio || 0;

    const horizData = await fetchHorizonte(p.id, resolvedProveedorId);
    const cantidad = calcularCantidad(
      horizonteGlobal,
      horizData.consumo_diario,
      leadTime,
      horizData.stock_minimo,
      horizData.stock_actual,
      factorConvSearch,
    );

    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        codigo_proveedor: activePres?.sku ?? null,
        codigo_maestro: detail.codigo_maestro ?? null,
        proveedor_id: resolvedProveedorId,
        proveedor_nombre: resolvedProveedorNombre,
        lead_time: leadTime,
        presentacion_id: activePres?.id ?? null,
        presentacion_nombre: activePres?.nombre ?? null,
        presentacion_nombre_plural: activePres?.nombre_plural ?? null,
        factor_conversion: factorConvSearch,
        unidad_base: detail.unidad_base?.nombre ?? "u",
        unidad_base_plural: detail.unidad_base?.nombre_plural ?? "u",
        unidad_basica_id: detail.unidad_base?.id ?? null,
        cantidad,
        precio_unitario:
          horizData.precio_ultimo != null
            ? horizData.precio_ultimo
            : activePres?.precio_adquisicion
              ? parseFloat(activePres.precio_adquisicion)
              : 0,
        imagen_url: detail.imagen_url ?? null,
        consumo_diario: horizData.consumo_diario,
        stock_actual: horizData.stock_actual,
        stock_minimo: horizData.stock_minimo,
        horizonte_dias: horizonteGlobal,
        horizonte_sugerido: horizData.horizonte_sugerido,
        horizonte_razon: horizData.razon,
        tipo_estimacion_demanda: horizData.tipo_estimacion_demanda,
        horizonte_personalizado: false,
      },
    ]);
  };

  const handleUpdateQty = (pid: string, val: number) =>
    setItems((prev) =>
      prev.map((i) =>
        i.producto_id === pid ? { ...i, cantidad: Math.max(1, val) } : i,
      ),
    );

  // Recibe el precio por unidad base (el componente convierte desde la presentación).
  const handleUpdatePrecio = (pid: string, precioUnitarioBase: number) =>
    setItems((prev) =>
      prev.map((i) =>
        i.producto_id === pid
          ? { ...i, precio_unitario: Math.max(0, precioUnitarioBase) }
          : i,
      ),
    );

  const handleRemove = (pid: string) =>
    setItems((prev) => prev.filter((i) => i.producto_id !== pid));

  const handleGlobalHorizonteChange = (dias: number) => {
    const conservados = items.filter((i) => i.horizonte_personalizado).length;
    const recalculados = items.length - conservados;
    setHorizonteGlobal(dias);
    setItems((prev) =>
      prev.map((i) => {
        if (i.horizonte_personalizado) return i;
        const nueva = calcularCantidad(
          dias,
          i.consumo_diario,
          i.lead_time,
          i.stock_minimo,
          i.stock_actual,
          i.factor_conversion,
        );
        return { ...i, horizonte_dias: dias, cantidad: nueva };
      }),
    );
    if (items.length === 0) return;
    const label =
      dias >= 365
        ? "1 año"
        : dias >= 180
          ? "6 meses"
          : dias >= 90
            ? "3 meses"
            : `${dias} días`;
    if (conservados === items.length) {
      notify.info("Todos los items tienen horizonte personalizado 📌");
    } else if (conservados > 0) {
      notify.success(
        `Horizonte actualizado a ${label}. ${recalculados} recalculados, ${conservados} con horizonte personalizado 📌.`,
      );
    } else {
      notify.success(
        `Horizonte actualizado a ${label}. ${recalculados} ${recalculados === 1 ? "item recalculado" : "items recalculados"}.`,
      );
    }
  };

  const handleHorizonteChip = (pid: string, dias: number) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.producto_id !== pid) return i;
        const nueva = calcularCantidad(
          dias,
          i.consumo_diario,
          i.lead_time,
          i.stock_minimo,
          i.stock_actual,
          i.factor_conversion,
        );
        return {
          ...i,
          horizonte_dias: dias,
          cantidad: nueva,
          horizonte_personalizado: dias !== horizonteGlobal,
        };
      }),
    );
    setPopoverOpenId(null);
  };

  const handleResetHorizonteToGlobal = (pid: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.producto_id !== pid) return i;
        const nueva = calcularCantidad(
          horizonteGlobal,
          i.consumo_diario,
          i.lead_time,
          i.stock_minimo,
          i.stock_actual,
          i.factor_conversion,
        );
        return {
          ...i,
          horizonte_dias: horizonteGlobal,
          cantidad: nueva,
          horizonte_personalizado: false,
        };
      }),
    );
    setPopoverOpenId(null);
  };

  const handleSaveBorrador = () => {
    if (items.length === 0) return;
    if (items.some((i) => i.proveedor_id == null)) {
      notify.error("Todos los items deben tener proveedor asignado");
      return;
    }
    setIsSaving(true);
    saveMutation.mutate(
      {
        nota: null,
        items: items.map((i) => ({
          producto_id: i.producto_id,
          cantidad_sugerida: i.cantidad.toString(),
          unidad_basica_id: i.unidad_basica_id,
          precio_unitario: i.precio_unitario.toString(),
          presentacion_id: i.presentacion_id,
          cantidad_presentaciones: i.cantidad.toString(),
          horizonte_dias: i.horizonte_dias ?? null,
          horizonte_sugerido: i.horizonte_sugerido ?? null,
          horizonte_razon: i.horizonte_razon ?? null,
        })),
      },
      { onSettled: () => setIsSaving(false) },
    );
  };

  const handleSelectProveedor = (p: Proveedor) => {
    setProveedoresFiltro((prev) =>
      prev.some((x) => x.id === p.id)
        ? prev.filter((x) => x.id !== p.id)
        : [...prev, p],
    );
  };

  const handleCambiarProveedor = () => setProveedoresFiltro([]);
  const handleAgregarProveedorFiltro = handleSelectProveedor;
  const handleQuitarProveedorFiltro = (proveedorId: number) =>
    setProveedoresFiltro((prev) => prev.filter((p) => p.id !== proveedorId));
  const handleLimpiarFiltros = () => setProveedoresFiltro([]);
  const handleQuitarProveedorCarrito = (proveedorId: number) => {
    setItems((prev) => prev.filter((i) => i.proveedor_id !== proveedorId));
    notify.success("Items del proveedor removidos del pedido");
  };

  // ── Detail query ─────────────────────────────────────────────────────────────

  const { data: detail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ["solicitud-detail", selectedSolicitudId],
    queryFn: () =>
      api
        .get<SolicitudDetalle>(`/solicitudes-compra/${selectedSolicitudId}`)
        .then((r) => r.data),
    enabled: !!selectedSolicitudId,
  });

  // ── Derived ──────────────────────────────────────────────────────────────────

  const recsFiltered = useMemo(
    () =>
      proveedoresFiltro.length > 0
        ? (recomendaciones ?? []).filter((r) =>
            proveedoresFiltro.some((p) => p.id === r.proveedor_id),
          )
        : (recomendaciones ?? []),
    [recomendaciones, proveedoresFiltro],
  );

  const recsByProveedor = useMemo(() => {
    const map = new Map<
      number,
      {
        proveedor_id: number;
        proveedor_nombre: string;
        recs: ItemRecomendado[];
      }
    >();
    for (const r of recsFiltered) {
      const pid = r.proveedor_id ?? -1;
      const entry = map.get(pid) ?? {
        proveedor_id: pid,
        proveedor_nombre: r.proveedor_nombre ?? "Sin proveedor",
        recs: [],
      };
      entry.recs.push(r);
      map.set(pid, entry);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.proveedor_nombre.localeCompare(b.proveedor_nombre),
    );
  }, [recsFiltered]);

  const itemsByProveedor = useMemo(() => {
    const map = new Map<
      number,
      { proveedor_nombre: string; items: SolicitudItem[]; subtotal: number }
    >();
    for (const item of items) {
      const proveedorId = item.proveedor_id ?? -1;
      const current = map.get(proveedorId) ?? {
        proveedor_nombre: item.proveedor_nombre || "Sin proveedor",
        items: [],
        subtotal: 0,
      };
      const precio =
        item.presentacion_id && item.factor_conversion
          ? toDecimal(item.precio_unitario).times(item.factor_conversion)
          : toDecimal(item.precio_unitario);
      current.items.push(item);
      current.subtotal = toDecimal(current.subtotal)
        .plus(toDecimal(item.cantidad).times(precio))
        .toNumber();
      map.set(proveedorId, current);
    }
    return Array.from(map.entries())
      .map(([proveedor_id, value]) => ({ proveedor_id, ...value }))
      .sort((a, b) => a.proveedor_nombre.localeCompare(b.proveedor_nombre));
  }, [items]);

  const totalGeneral = useMemo(
    () => itemsByProveedor.reduce((acc, grupo) => acc + grupo.subtotal, 0),
    [itemsByProveedor],
  );

  const urgenciasByProveedor = (recomendaciones ?? []).reduce<
    Record<number, { total: number; criticos: number }>
  >((acc, r) => {
    const pid = r.proveedor_id;
    if (pid == null) return acc;
    if (!acc[pid]) acc[pid] = { total: 0, criticos: 0 };
    acc[pid].total++;
    if (r.nivel_urgencia === "critica" || r.nivel_urgencia === "critico")
      acc[pid].criticos++;
    return acc;
  }, {});

  return {
    // Vista
    view,
    setView,
    // Proveedor
    selectedProveedor,
    proveedoresFiltro,
    handleSelectProveedor,
    handleCambiarProveedor,
    handleAgregarProveedorFiltro,
    handleQuitarProveedorFiltro,
    handleLimpiarFiltros,
    handleQuitarProveedorCarrito,
    // Items
    items,
    handleAddFromRec,
    handleAddFromRecConCantidad,
    handleAddFromSearch,
    handleUpdateQty,
    handleUpdatePrecio,
    handleRemove,
    // Horizonte
    horizonteGlobal,
    handleGlobalHorizonteChange,
    handleHorizonteChip,
    handleResetHorizonteToGlobal,
    // Borrador / guardar
    solicitudId,
    isSaving,
    saveMutation,
    guardarMutation,
    handleSaveBorrador,
    // Historial
    historialSearch,
    setHistorialSearch,
    historialEstado,
    setHistorialEstado,
    historial,
    isLoadingHistorial,
    // Detalle modal
    selectedSolicitudId,
    setSelectedSolicitudId,
    detail,
    isLoadingDetail,
    registrarEnvioMutation,
    cancelarEnvioMutation,
    pdfFirmaLabel,
    setPdfFirmaLabel,
    // Modo / tabs
    modoRevision,
    setModo,
    tabIzquierdo,
    setTabIzquierdo,
    popoverOpenId,
    setPopoverOpenId,
    restaurando,
    // Descartados (modo revisión)
    descartados,
    handleDescartar,
    handleRestaurar,
    // Datos globales
    proveedores,
    isLoadingProveedores,
    recomendaciones,
    isLoadingRecs,
    recsFiltered,
    recsByProveedor,
    urgenciasByProveedor,
    itemsByProveedor,
    totalGeneral,
    vencimientoByProveedor,
    diasVencimiento,
    setDiasVencimiento,
    configuracion,
    monedaCodigo,
  };
}

export type SolicitudStateReturn = ReturnType<typeof useSolicitudState>;
