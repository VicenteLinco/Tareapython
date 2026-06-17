CREATE EXTENSION IF NOT EXISTS pg_trgm;

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS public;



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--




--
-- Name: fn_procesar_movimiento_stock(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.fn_procesar_movimiento_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_signo DECIMAL := 1;
    v_stock_actual DECIMAL := 0;
BEGIN
    -- 1. Determinar el signo según el tipo de movimiento
    IF NEW.tipo IN ('CONSUMO', 'AJUSTE_NEGATIVO', 'TRANSFERENCIA_SALIDA', 'DESCARTE_VENCIDO', 'DESCARTE_DAÑADO') THEN
        v_signo := -1;
    END IF;

    -- 2. Obtener el stock actual del lote en el área (bloqueando la fila para evitar race conditions)
    -- Si no existe, se asume 0.
    SELECT cantidad INTO v_stock_actual
    FROM stock
    WHERE lote_id = NEW.lote_id AND area_id = NEW.area_id
    FOR UPDATE;

    IF NOT FOUND THEN
        v_stock_actual := 0;
    END IF;

    -- 3. Calcular la cantidad resultante
    NEW.cantidad_resultante := v_stock_actual + (NEW.cantidad * v_signo);

    -- 4. Validar que el stock no sea negativo (regla de negocio crítica)
    IF NEW.cantidad_resultante < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para el lote % en el área %. Actual: %, Requerido: %', 
            NEW.lote_id, NEW.area_id, v_stock_actual, NEW.cantidad;
    END IF;

    -- 5. Actualizar o Insertar en la tabla stock
    INSERT INTO stock (lote_id, area_id, cantidad, updated_at)
    VALUES (NEW.lote_id, NEW.area_id, NEW.cantidad_resultante, NOW())
    ON CONFLICT (lote_id, area_id) 
    DO UPDATE SET 
        cantidad = EXCLUDED.cantidad,
        updated_at = EXCLUDED.updated_at;

    RETURN NEW;
END;
$$;



--
-- Name: generar_codigo_lote(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.generar_codigo_lote() RETURNS text
    LANGUAGE sql
    AS $$
    SELECT 'LOT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('seq_lot_numero')::TEXT, 5, '0')
$$;



--
-- Name: generar_codigo_producto(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.generar_codigo_producto() RETURNS text
    LANGUAGE sql
    AS $$
    SELECT 'PRD-' || LPAD(NEXTVAL('seq_prd_numero')::TEXT, 5, '0')
$$;



--
-- Name: generar_numero_mov(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.generar_numero_mov() RETURNS text
    LANGUAGE sql
    AS $$
    SELECT 'MOV-' || LPAD(NEXTVAL('seq_mov_numero')::TEXT, 6, '0')
$$;



--
-- Name: generar_numero_oc(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.generar_numero_oc() RETURNS text
    LANGUAGE sql
    AS $$
    SELECT 'OC-' || LPAD(NEXTVAL('seq_oc_numero')::TEXT, 6, '0')
$$;



--
-- Name: generar_numero_rec(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.generar_numero_rec() RETURNS text
    LANGUAGE sql
    AS $$
    SELECT 'REC-' || LPAD(NEXTVAL('seq_rec_numero')::TEXT, 6, '0')
$$;



--
-- Name: generar_numero_sol(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.generar_numero_sol() RETURNS text
    LANGUAGE sql
    AS $$
    SELECT 'SOL-' || LPAD(NEXTVAL('seq_sol_numero')::TEXT, 6, '0')
$$;



--
-- Name: productos_search_vector_update(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.productos_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.nombre, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_interno, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_proveedor, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_maestro, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(NEW.descripcion, '')), 'C');
    RETURN NEW;
END;
$$;



--
-- Name: trg_solicitud_envios_updated(); Type: FUNCTION; Schema: public; Owner: lab_user
--

CREATE FUNCTION public.trg_solicitud_envios_updated() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$;



SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: areas; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.areas (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    es_bodega boolean DEFAULT false NOT NULL,
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    conteo_frecuencia_dias integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    deleted_at timestamp with time zone
);



--
-- Name: areas_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.areas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: areas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.areas_id_seq OWNED BY public.areas.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.audit_log (
    id bigint NOT NULL,
    tabla character varying(50) NOT NULL,
    registro_id character varying(50) NOT NULL,
    accion character varying(10) NOT NULL,
    datos_anteriores jsonb,
    datos_nuevos jsonb,
    usuario_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_log_accion_check CHECK (((accion)::text = ANY (ARRAY[('CREATE'::character varying)::text, ('UPDATE'::character varying)::text, ('DELETE'::character varying)::text])))
);



--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: categorias; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.categorias (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone
);



--
-- Name: categorias_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.categorias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: categorias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.categorias_id_seq OWNED BY public.categorias.id;


--
-- Name: configuracion; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.configuracion (
    clave character varying(100) NOT NULL,
    valor_texto text DEFAULT ''::text NOT NULL
);



--
-- Name: conteo_items; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.conteo_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sesion_id uuid NOT NULL,
    lote_id uuid NOT NULL,
    stock_sistema numeric(12,2) NOT NULL,
    cantidad_contada numeric(12,2),
    estado_item character varying(15) DEFAULT 'pendiente'::character varying NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conteo_items_estado_item_check CHECK (((estado_item)::text = ANY (ARRAY[('pendiente'::character varying)::text, ('contado'::character varying)::text, ('no_contado'::character varying)::text])))
);



--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.idempotency_keys (
    key character varying(256) NOT NULL,
    endpoint character varying(100) NOT NULL,
    response_status smallint NOT NULL,
    response_body jsonb NOT NULL,
    usuario_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: lotes; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.lotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    producto_id uuid NOT NULL,
    proveedor_id integer,
    numero_lote character varying(100) NOT NULL,
    fecha_vencimiento date NOT NULL,
    codigo_interno character varying(30) NOT NULL,
    costo_unitario numeric(12,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: movimientos; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.movimientos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_documento character varying(20) DEFAULT public.generar_numero_mov() NOT NULL,
    grupo_movimiento uuid,
    lote_id uuid NOT NULL,
    area_id integer NOT NULL,
    tipo character varying(30) NOT NULL,
    cantidad numeric(12,2) NOT NULL,
    cantidad_resultante numeric(12,2) NOT NULL,
    usuario_id uuid NOT NULL,
    origen character varying(30),
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT movimientos_cantidad_check CHECK ((cantidad > (0)::numeric)),
    CONSTRAINT movimientos_tipo_check CHECK (((tipo)::text = ANY (ARRAY[('INGRESO'::character varying)::text, ('CARGA_INICIAL'::character varying)::text, ('CONSUMO'::character varying)::text, ('AJUSTE_POSITIVO'::character varying)::text, ('AJUSTE_NEGATIVO'::character varying)::text, ('TRANSFERENCIA_ENTRADA'::character varying)::text, ('TRANSFERENCIA_SALIDA'::character varying)::text, ('DESCARTE_VENCIDO'::character varying)::text, ('DESCARTE_DAÑADO'::character varying)::text])))
);



--
-- Name: orden_compra_detalle; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.orden_compra_detalle (
    id integer NOT NULL,
    orden_compra_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    presentacion_id integer,
    cantidad_solicitada numeric(12,2) NOT NULL,
    cantidad_recibida numeric(12,2) DEFAULT 0 NOT NULL,
    precio_unitario numeric(12,4),
    unidad character varying(50) NOT NULL,
    area_destino_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orden_compra_detalle_cantidad_solicitada_check CHECK ((cantidad_solicitada > (0)::numeric)),
    CONSTRAINT orden_compra_detalle_check CHECK (((cantidad_recibida >= (0)::numeric) AND (cantidad_recibida <= cantidad_solicitada)))
);



--
-- Name: orden_compra_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.orden_compra_detalle_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: orden_compra_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.orden_compra_detalle_id_seq OWNED BY public.orden_compra_detalle.id;


--
-- Name: ordenes_compra; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.ordenes_compra (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_documento character varying(20) DEFAULT public.generar_numero_oc() NOT NULL,
    solicitud_id uuid,
    proveedor_id integer NOT NULL,
    estado character varying(30) DEFAULT 'borrador'::character varying NOT NULL,
    fecha_emision timestamp with time zone DEFAULT now() NOT NULL,
    fecha_entrega_esperada date,
    nota text,
    usuario_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ordenes_compra_estado_check CHECK (((estado)::text = ANY (ARRAY[('borrador'::character varying)::text, ('enviada'::character varying)::text, ('recibida_parcial'::character varying)::text, ('recibida_total'::character varying)::text, ('cancelada'::character varying)::text])))
);



--
-- Name: presentacion_formatos; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.presentacion_formatos (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    nombre_plural character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    es_predefinido boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: presentacion_formatos_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.presentacion_formatos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: presentacion_formatos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.presentacion_formatos_id_seq OWNED BY public.presentacion_formatos.id;


--
-- Name: presentaciones; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.presentaciones (
    id integer NOT NULL,
    producto_id uuid NOT NULL,
    nombre character varying(100) NOT NULL,
    factor_conversion numeric(12,2) NOT NULL,
    codigo_barras character varying(100),
    activa boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    nombre_plural character varying(100) NOT NULL,
    deleted_at timestamp with time zone,
    gtin character varying(14),
    gs1_habilitado boolean DEFAULT false NOT NULL,
    CONSTRAINT presentaciones_factor_conversion_check CHECK ((factor_conversion > (0)::numeric))
);



--
-- Name: presentaciones_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.presentaciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: presentaciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.presentaciones_id_seq OWNED BY public.presentaciones.id;


--
-- Name: producto_area; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.producto_area (
    producto_id uuid NOT NULL,
    area_id integer NOT NULL,
    stock_minimo numeric(12,2),
    stock_maximo numeric(12,2),
    punto_reorden numeric(12,2)
);



--
-- Name: producto_precio_historial; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.producto_precio_historial (
    id bigint NOT NULL,
    producto_id uuid NOT NULL,
    proveedor_id integer,
    precio_unidad numeric(12,4) NOT NULL,
    presentacion_id integer,
    precio_presentacion numeric(12,4),
    vigente_desde date DEFAULT CURRENT_DATE NOT NULL,
    usuario_id uuid,
    nota text,
    fuente character varying(20) DEFAULT 'manual'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT producto_precio_historial_fuente_check CHECK (((fuente)::text = ANY (ARRAY[('manual'::character varying)::text, ('recepcion'::character varying)::text, ('solicitud'::character varying)::text])))
);



--
-- Name: producto_precio_historial_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.producto_precio_historial_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: producto_precio_historial_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.producto_precio_historial_id_seq OWNED BY public.producto_precio_historial.id;


--
-- Name: producto_proveedor; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.producto_proveedor (
    id integer NOT NULL,
    producto_id uuid NOT NULL,
    proveedor_id integer NOT NULL,
    es_principal boolean DEFAULT false NOT NULL,
    codigo_proveedor character varying(100),
    precio_unidad numeric(12,4),
    lead_time_dias integer,
    unidad_minima_pedido numeric(12,2),
    activo boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    codigo_maestro character varying(100),
    presentacion_id integer,
    imagen_url text
);



--
-- Name: producto_proveedor_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.producto_proveedor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: producto_proveedor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.producto_proveedor_id_seq OWNED BY public.producto_proveedor.id;


--
-- Name: productos; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.productos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    codigo_interno character varying(20) NOT NULL,
    nombre character varying(300) NOT NULL,
    descripcion text,
    categoria_id integer,
    unidad_base_id integer NOT NULL,
    stock_minimo numeric(12,2) DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    proveedor_id integer,
    codigo_proveedor character varying(100),
    codigo_maestro character varying(100),
    precio_unidad numeric(12,4),
    imagen_path text,
    ubicacion character varying(200),
    lead_time_propio integer,
    deleted_at timestamp with time zone,
    temperatura_almacenamiento character varying(30),
    requiere_cadena_frio boolean DEFAULT false NOT NULL,
    dias_estabilidad_abierto integer,
    clase_riesgo character varying(20),
    search_vector tsvector,
    CONSTRAINT productos_clase_riesgo_check CHECK (((clase_riesgo)::text = ANY (ARRAY[('biologico'::character varying)::text, ('quimico'::character varying)::text, ('radiactivo'::character varying)::text, ('inflamable'::character varying)::text, ('corrosivo'::character varying)::text, ('ninguno'::character varying)::text]))),
    CONSTRAINT productos_temperatura_almacenamiento_check CHECK (((temperatura_almacenamiento)::text = ANY (ARRAY[('ambiente'::character varying)::text, ('refrigerado'::character varying)::text, ('congelado'::character varying)::text, ('ultra_frio'::character varying)::text, ('no_aplica'::character varying)::text])))
);



--
-- Name: COLUMN productos.precio_unidad; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.productos.precio_unidad IS 'Precio de referencia neto por unidad base';


--
-- Name: COLUMN productos.lead_time_propio; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.productos.lead_time_propio IS 'Tiempo de reposición propio del producto en días (sobreescribe el del proveedor si está definido)';


--
-- Name: proveedores; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.proveedores (
    id integer NOT NULL,
    nombre character varying(200) NOT NULL,
    contacto character varying(200),
    telefono character varying(50),
    email character varying(255),
    activa boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    icono text,
    dias_despacho_aereo integer,
    dias_despacho_tierra integer,
    deleted_at timestamp with time zone
);



--
-- Name: proveedores_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.proveedores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: proveedores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.proveedores_id_seq OWNED BY public.proveedores.id;


--
-- Name: recepcion_detalle; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.recepcion_detalle (
    id integer NOT NULL,
    recepcion_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    lote_id uuid NOT NULL,
    presentacion_id integer,
    area_destino_id integer NOT NULL,
    cantidad_presentaciones numeric(12,2) NOT NULL,
    factor_conversion_usado numeric(12,2) NOT NULL,
    cantidad_unidades_base numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    precio_unitario numeric(14,2),
    orden_compra_detalle_id integer
);



--
-- Name: COLUMN recepcion_detalle.precio_unitario; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.recepcion_detalle.precio_unitario IS 'Precio neto pagado por unidad (de presentación o base) en esta recepción';


--
-- Name: COLUMN recepcion_detalle.orden_compra_detalle_id; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.recepcion_detalle.orden_compra_detalle_id IS 'Ítem de OC asociado a este detalle de recepción';


--
-- Name: recepcion_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.recepcion_detalle_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: recepcion_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.recepcion_detalle_id_seq OWNED BY public.recepcion_detalle.id;


--
-- Name: recepcion_reconciliacion; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.recepcion_reconciliacion (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recepcion_id uuid NOT NULL,
    solicitud_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    estado text NOT NULL,
    cantidad_solicitada numeric(12,2) DEFAULT 0 NOT NULL,
    cantidad_recibida numeric(12,2) DEFAULT 0 NOT NULL,
    diferencia numeric(12,2) DEFAULT 0 NOT NULL,
    unidad text,
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recepcion_reconciliacion_estado_check CHECK ((estado = ANY (ARRAY['ok'::text, 'faltante'::text, 'no_recibido'::text, 'sobrante'::text, 'extra'::text])))
);



--
-- Name: recepciones; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.recepciones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_documento character varying(20) DEFAULT public.generar_numero_rec() NOT NULL,
    proveedor_id integer NOT NULL,
    guia_despacho character varying(100),
    estado character varying(20) DEFAULT 'borrador'::character varying NOT NULL,
    fecha_recepcion timestamp with time zone NOT NULL,
    guia_despacho_archivo character varying(500),
    usuario_id uuid NOT NULL,
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    foto_documento text,
    foto_actualizada_at timestamp with time zone,
    solicitud_id uuid,
    motivo_rechazo text,
    orden_compra_id uuid,
    CONSTRAINT recepciones_estado_check CHECK (((estado)::text = ANY (ARRAY[('borrador'::character varying)::text, ('completa'::character varying)::text, ('parcial'::character varying)::text, ('rechazada'::character varying)::text])))
);



--
-- Name: COLUMN recepciones.solicitud_id; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.recepciones.solicitud_id IS 'ID de la solicitud de compra que originó esta recepción';


--
-- Name: COLUMN recepciones.orden_compra_id; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.recepciones.orden_compra_id IS 'OC que originó esta recepción (nullable para compatibilidad)';


--
-- Name: refresh_sessions; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.refresh_sessions (
    id uuid NOT NULL,
    usuario_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by uuid,
    created_ip text
);



--
-- Name: scanner_items; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.scanner_items (
    id bigint NOT NULL,
    session_token uuid NOT NULL,
    codigo character varying(200) NOT NULL,
    producto_id uuid,
    producto_nombre character varying(500),
    scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    fetched boolean DEFAULT false NOT NULL
);



--
-- Name: scanner_items_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.scanner_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: scanner_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.scanner_items_id_seq OWNED BY public.scanner_items.id;


--
-- Name: scanner_sessions; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.scanner_sessions (
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    recepcion_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:10:00'::interval) NOT NULL
);



--
-- Name: seq_lot_numero; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.seq_lot_numero
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: seq_mov_numero; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.seq_mov_numero
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: seq_oc_numero; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.seq_oc_numero
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: seq_prd_numero; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.seq_prd_numero
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: seq_rec_numero; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.seq_rec_numero
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: seq_sol_numero; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.seq_sol_numero
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: sesiones_conteo; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.sesiones_conteo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    area_id integer NOT NULL,
    estado character varying(20) DEFAULT 'borrador'::character varying NOT NULL,
    usuario_creador_id uuid NOT NULL,
    usuario_confirmador_id uuid,
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    confirmed_at timestamp with time zone,
    CONSTRAINT sesiones_conteo_estado_check CHECK (((estado)::text = ANY (ARRAY[('borrador'::character varying)::text, ('en_progreso'::character varying)::text, ('confirmado'::character varying)::text, ('cancelado'::character varying)::text])))
);



--
-- Name: solicitud_compra_detalle; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.solicitud_compra_detalle (
    id integer NOT NULL,
    solicitud_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    cantidad_sugerida numeric(12,2) NOT NULL,
    unidad character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    precio_unitario numeric(14,2),
    presentacion_id integer,
    cantidad_presentaciones numeric(12,2),
    horizonte_dias integer,
    horizonte_sugerido integer,
    horizonte_razon text
);



--
-- Name: COLUMN solicitud_compra_detalle.precio_unitario; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.solicitud_compra_detalle.precio_unitario IS 'Precio neto por unidad de presentación (o base si no hay presentación)';


--
-- Name: COLUMN solicitud_compra_detalle.presentacion_id; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.solicitud_compra_detalle.presentacion_id IS 'Presentación usada para expresar la cantidad. NULL = se pide en unidad base';


--
-- Name: COLUMN solicitud_compra_detalle.cantidad_presentaciones; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.solicitud_compra_detalle.cantidad_presentaciones IS 'Cantidad en unidades de presentación. NULL si no hay presentación definida';


--
-- Name: COLUMN solicitud_compra_detalle.horizonte_dias; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.solicitud_compra_detalle.horizonte_dias IS 'Horizonte activo al guardar. NULL indica cantidad editada manualmente (ningún chip activo).';


--
-- Name: COLUMN solicitud_compra_detalle.horizonte_sugerido; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.solicitud_compra_detalle.horizonte_sugerido IS 'Horizonte calculado por el sistema al agregar el ítem. Inmutable.';


--
-- Name: COLUMN solicitud_compra_detalle.horizonte_razon; Type: COMMENT; Schema: public; Owner: lab_user
--

COMMENT ON COLUMN public.solicitud_compra_detalle.horizonte_razon IS 'Razón textual del horizonte sugerido. Inmutable.';


--
-- Name: solicitud_compra_detalle_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.solicitud_compra_detalle_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: solicitud_compra_detalle_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.solicitud_compra_detalle_id_seq OWNED BY public.solicitud_compra_detalle.id;


--
-- Name: solicitud_envios; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.solicitud_envios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    solicitud_id uuid NOT NULL,
    proveedor_id integer NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    metodo_envio text,
    fecha_envio timestamp with time zone,
    usuario_envio_id uuid,
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT solicitud_envios_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'enviado'::text, 'cancelado'::text]))),
    CONSTRAINT solicitud_envios_fecha_consistente CHECK ((((estado = 'enviado'::text) AND (fecha_envio IS NOT NULL) AND (metodo_envio IS NOT NULL)) OR (estado <> 'enviado'::text))),
    CONSTRAINT solicitud_envios_metodo_check CHECK (((metodo_envio IS NULL) OR (metodo_envio = ANY (ARRAY['email'::text, 'telefono'::text, 'whatsapp'::text, 'presencial'::text, 'otro'::text]))))
);



--
-- Name: solicitudes_compra; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.solicitudes_compra (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    numero_documento character varying(20) DEFAULT public.generar_numero_sol() NOT NULL,
    fecha_creacion timestamp with time zone DEFAULT now() NOT NULL,
    usuario_id uuid NOT NULL,
    estado text DEFAULT 'borrador'::character varying NOT NULL,
    nota text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    fecha_envio timestamp with time zone,
    fecha_cierre timestamp with time zone,
    motivo_cierre text,
    metodo_envio text,
    CONSTRAINT solicitudes_compra_estado_check CHECK ((estado = ANY (ARRAY[('borrador'::character varying)::text, ('guardada'::character varying)::text, ('parcialmente_enviada'::character varying)::text, ('enviada'::character varying)::text, ('parcialmente_recibida'::character varying)::text, ('completada'::character varying)::text, ('cancelada'::character varying)::text])))
);



--
-- Name: stock; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.stock (
    id integer NOT NULL,
    lote_id uuid NOT NULL,
    area_id integer NOT NULL,
    cantidad numeric(12,2) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stock_cantidad_check CHECK ((cantidad >= (0)::numeric))
);



--
-- Name: stock_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.stock_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: stock_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.stock_id_seq OWNED BY public.stock.id;


--
-- Name: unidades_basicas; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.unidades_basicas (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    nombre_plural character varying(50) NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone
);



--
-- Name: unidades_medida_id_seq; Type: SEQUENCE; Schema: public; Owner: lab_user
--

CREATE SEQUENCE public.unidades_medida_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: unidades_medida_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lab_user
--

ALTER SEQUENCE public.unidades_medida_id_seq OWNED BY public.unidades_basicas.id;


--
-- Name: usuario_area; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.usuario_area (
    usuario_id uuid NOT NULL,
    area_id integer NOT NULL
);



--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.usuarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre character varying(150) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    rol character varying(20) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    whatsapp_phone character varying(50),
    CONSTRAINT usuarios_rol_check CHECK (((rol)::text = ANY (ARRAY[('admin'::character varying)::text, ('tecnologo'::character varying)::text, ('consulta'::character varying)::text])))
);



--
-- Name: v_stock_por_producto_area; Type: VIEW; Schema: public; Owner: lab_user
--

CREATE VIEW public.v_stock_por_producto_area AS
 SELECT p.id AS producto_id,
    p.codigo_interno,
    p.nombre AS producto_nombre,
    a.id AS area_id,
    a.nombre AS area_nombre,
    sum(s.cantidad) AS stock_total,
    um.nombre AS unidad_nombre,
    um.nombre_plural AS unidad_nombre_plural,
    um.nombre AS unidad,
    min(l.fecha_vencimiento) FILTER (WHERE (s.cantidad > (0)::numeric)) AS proximo_vencimiento
   FROM ((((public.stock s
     JOIN public.lotes l ON ((l.id = s.lote_id)))
     JOIN public.productos p ON ((p.id = l.producto_id)))
     JOIN public.areas a ON ((a.id = s.area_id)))
     JOIN public.unidades_basicas um ON ((um.id = p.unidad_base_id)))
  WHERE ((s.cantidad > (0)::numeric) AND (p.activo = true))
  GROUP BY p.id, p.codigo_interno, p.nombre, a.id, a.nombre, um.nombre, um.nombre_plural;



--
-- Name: whatsapp_webhook_logs; Type: TABLE; Schema: public; Owner: lab_user
--

CREATE TABLE public.whatsapp_webhook_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id character varying(100) NOT NULL,
    sender_phone character varying(50) NOT NULL,
    usuario_id uuid,
    request_body text NOT NULL,
    command_type character varying(20),
    status character varying(20) NOT NULL,
    response_body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: areas id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.areas ALTER COLUMN id SET DEFAULT nextval('public.areas_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: categorias id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.categorias ALTER COLUMN id SET DEFAULT nextval('public.categorias_id_seq'::regclass);


--
-- Name: orden_compra_detalle id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.orden_compra_detalle ALTER COLUMN id SET DEFAULT nextval('public.orden_compra_detalle_id_seq'::regclass);


--
-- Name: presentacion_formatos id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.presentacion_formatos ALTER COLUMN id SET DEFAULT nextval('public.presentacion_formatos_id_seq'::regclass);


--
-- Name: presentaciones id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.presentaciones ALTER COLUMN id SET DEFAULT nextval('public.presentaciones_id_seq'::regclass);


--
-- Name: producto_precio_historial id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_precio_historial ALTER COLUMN id SET DEFAULT nextval('public.producto_precio_historial_id_seq'::regclass);


--
-- Name: producto_proveedor id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_proveedor ALTER COLUMN id SET DEFAULT nextval('public.producto_proveedor_id_seq'::regclass);


--
-- Name: proveedores id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.proveedores ALTER COLUMN id SET DEFAULT nextval('public.proveedores_id_seq'::regclass);


--
-- Name: recepcion_detalle id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle ALTER COLUMN id SET DEFAULT nextval('public.recepcion_detalle_id_seq'::regclass);


--
-- Name: scanner_items id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.scanner_items ALTER COLUMN id SET DEFAULT nextval('public.scanner_items_id_seq'::regclass);


--
-- Name: solicitud_compra_detalle id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_compra_detalle ALTER COLUMN id SET DEFAULT nextval('public.solicitud_compra_detalle_id_seq'::regclass);


--
-- Name: stock id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.stock ALTER COLUMN id SET DEFAULT nextval('public.stock_id_seq'::regclass);


--
-- Name: unidades_basicas id; Type: DEFAULT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.unidades_basicas ALTER COLUMN id SET DEFAULT nextval('public.unidades_medida_id_seq'::regclass);


--
-- Name: areas areas_nombre_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_nombre_key UNIQUE (nombre);


--
-- Name: areas areas_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.areas
    ADD CONSTRAINT areas_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: categorias categorias_nombre_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_nombre_key UNIQUE (nombre);


--
-- Name: categorias categorias_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.categorias
    ADD CONSTRAINT categorias_pkey PRIMARY KEY (id);


--
-- Name: configuracion configuracion_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.configuracion
    ADD CONSTRAINT configuracion_pkey PRIMARY KEY (clave);


--
-- Name: conteo_items conteo_items_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.conteo_items
    ADD CONSTRAINT conteo_items_pkey PRIMARY KEY (id);


--
-- Name: conteo_items conteo_items_sesion_id_lote_id_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.conteo_items
    ADD CONSTRAINT conteo_items_sesion_id_lote_id_key UNIQUE (sesion_id, lote_id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (key);


--
-- Name: lotes lotes_codigo_interno_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_codigo_interno_key UNIQUE (codigo_interno);


--
-- Name: lotes lotes_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_pkey PRIMARY KEY (id);


--
-- Name: lotes lotes_producto_proveedor_lote_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_producto_proveedor_lote_key UNIQUE (producto_id, proveedor_id, numero_lote);


--
-- Name: movimientos movimientos_numero_documento_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.movimientos
    ADD CONSTRAINT movimientos_numero_documento_key UNIQUE (numero_documento);


--
-- Name: movimientos movimientos_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.movimientos
    ADD CONSTRAINT movimientos_pkey PRIMARY KEY (id);


--
-- Name: orden_compra_detalle orden_compra_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_pkey PRIMARY KEY (id);


--
-- Name: ordenes_compra ordenes_compra_numero_documento_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_numero_documento_key UNIQUE (numero_documento);


--
-- Name: ordenes_compra ordenes_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_pkey PRIMARY KEY (id);


--
-- Name: presentacion_formatos presentacion_formatos_nombre_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.presentacion_formatos
    ADD CONSTRAINT presentacion_formatos_nombre_key UNIQUE (nombre);


--
-- Name: presentacion_formatos presentacion_formatos_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.presentacion_formatos
    ADD CONSTRAINT presentacion_formatos_pkey PRIMARY KEY (id);


--
-- Name: presentaciones presentaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.presentaciones
    ADD CONSTRAINT presentaciones_pkey PRIMARY KEY (id);


--
-- Name: producto_area producto_area_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_area
    ADD CONSTRAINT producto_area_pkey PRIMARY KEY (producto_id, area_id);


--
-- Name: producto_precio_historial producto_precio_historial_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_precio_historial
    ADD CONSTRAINT producto_precio_historial_pkey PRIMARY KEY (id);


--
-- Name: producto_proveedor producto_proveedor_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_proveedor
    ADD CONSTRAINT producto_proveedor_pkey PRIMARY KEY (id);


--
-- Name: productos productos_codigo_interno_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_codigo_interno_key UNIQUE (codigo_interno);


--
-- Name: productos productos_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_pkey PRIMARY KEY (id);


--
-- Name: proveedores proveedores_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.proveedores
    ADD CONSTRAINT proveedores_pkey PRIMARY KEY (id);


--
-- Name: recepcion_detalle recepcion_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle
    ADD CONSTRAINT recepcion_detalle_pkey PRIMARY KEY (id);


--
-- Name: recepcion_reconciliacion recepcion_reconciliacion_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_reconciliacion
    ADD CONSTRAINT recepcion_reconciliacion_pkey PRIMARY KEY (id);


--
-- Name: recepciones recepciones_numero_documento_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepciones
    ADD CONSTRAINT recepciones_numero_documento_key UNIQUE (numero_documento);


--
-- Name: recepciones recepciones_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepciones
    ADD CONSTRAINT recepciones_pkey PRIMARY KEY (id);


--
-- Name: refresh_sessions refresh_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_pkey PRIMARY KEY (id);


--
-- Name: refresh_sessions refresh_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: scanner_items scanner_items_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.scanner_items
    ADD CONSTRAINT scanner_items_pkey PRIMARY KEY (id);


--
-- Name: scanner_sessions scanner_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.scanner_sessions
    ADD CONSTRAINT scanner_sessions_pkey PRIMARY KEY (token);


--
-- Name: sesiones_conteo sesiones_conteo_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.sesiones_conteo
    ADD CONSTRAINT sesiones_conteo_pkey PRIMARY KEY (id);


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_pkey PRIMARY KEY (id);


--
-- Name: solicitud_envios solicitud_envios_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_envios
    ADD CONSTRAINT solicitud_envios_pkey PRIMARY KEY (id);


--
-- Name: solicitud_envios solicitud_envios_unique; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_envios
    ADD CONSTRAINT solicitud_envios_unique UNIQUE (solicitud_id, proveedor_id);


--
-- Name: solicitudes_compra solicitudes_compra_numero_documento_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_numero_documento_key UNIQUE (numero_documento);


--
-- Name: solicitudes_compra solicitudes_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_pkey PRIMARY KEY (id);


--
-- Name: stock stock_lote_id_area_id_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_lote_id_area_id_key UNIQUE (lote_id, area_id);


--
-- Name: stock stock_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_pkey PRIMARY KEY (id);


--
-- Name: unidades_basicas unidades_medida_nombre_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.unidades_basicas
    ADD CONSTRAINT unidades_medida_nombre_key UNIQUE (nombre);


--
-- Name: unidades_basicas unidades_medida_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.unidades_basicas
    ADD CONSTRAINT unidades_medida_pkey PRIMARY KEY (id);


--
-- Name: producto_proveedor uq_producto_proveedor; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_proveedor
    ADD CONSTRAINT uq_producto_proveedor UNIQUE (producto_id, proveedor_id);


--
-- Name: recepcion_reconciliacion uq_rec_reconciliacion; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_reconciliacion
    ADD CONSTRAINT uq_rec_reconciliacion UNIQUE (recepcion_id, solicitud_id, producto_id);


--
-- Name: usuario_area usuario_area_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.usuario_area
    ADD CONSTRAINT usuario_area_pkey PRIMARY KEY (usuario_id, area_id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_whatsapp_phone_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_whatsapp_phone_key UNIQUE (whatsapp_phone);


--
-- Name: whatsapp_webhook_logs whatsapp_webhook_logs_message_id_key; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.whatsapp_webhook_logs
    ADD CONSTRAINT whatsapp_webhook_logs_message_id_key UNIQUE (message_id);


--
-- Name: whatsapp_webhook_logs whatsapp_webhook_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.whatsapp_webhook_logs
    ADD CONSTRAINT whatsapp_webhook_logs_pkey PRIMARY KEY (id);


--
-- Name: idx_areas_activa; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_areas_activa ON public.areas USING btree (activa) WHERE (activa = true);


--
-- Name: idx_areas_deleted; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_areas_deleted ON public.areas USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_audit_fecha; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_audit_fecha ON public.audit_log USING btree (created_at);


--
-- Name: idx_audit_log_tabla_registro; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_audit_log_tabla_registro ON public.audit_log USING btree (tabla, registro_id);


--
-- Name: idx_audit_tabla_registro; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_audit_tabla_registro ON public.audit_log USING btree (tabla, registro_id);


--
-- Name: idx_categorias_activo; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_categorias_activo ON public.categorias USING btree (activo) WHERE (activo = true);


--
-- Name: idx_categorias_deleted; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_categorias_deleted ON public.categorias USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_conteo_items_sesion; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_conteo_items_sesion ON public.conteo_items USING btree (sesion_id);


--
-- Name: idx_lotes_codigo_interno; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_lotes_codigo_interno ON public.lotes USING btree (codigo_interno);


--
-- Name: idx_lotes_fecha_vencimiento; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_lotes_fecha_vencimiento ON public.lotes USING btree (fecha_vencimiento) WHERE (fecha_vencimiento IS NOT NULL);


--
-- Name: idx_lotes_producto; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_lotes_producto ON public.lotes USING btree (producto_id);


--
-- Name: idx_lotes_vencimiento; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_lotes_vencimiento ON public.lotes USING btree (fecha_vencimiento);


--
-- Name: idx_mov_area_tipo_fecha; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_mov_area_tipo_fecha ON public.movimientos USING btree (area_id, tipo, created_at DESC);


--
-- Name: idx_mov_lote_fecha; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_mov_lote_fecha ON public.movimientos USING btree (lote_id, created_at DESC);


--
-- Name: idx_movimientos_created_at; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_movimientos_created_at ON public.movimientos USING btree (created_at DESC);


--
-- Name: idx_movimientos_grupo; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_movimientos_grupo ON public.movimientos USING btree (grupo_movimiento);


--
-- Name: idx_movimientos_usuario; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_movimientos_usuario ON public.movimientos USING btree (usuario_id);


--
-- Name: idx_oc_estado; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_oc_estado ON public.ordenes_compra USING btree (estado);


--
-- Name: idx_oc_proveedor; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_oc_proveedor ON public.ordenes_compra USING btree (proveedor_id);


--
-- Name: idx_oc_solicitud; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_oc_solicitud ON public.ordenes_compra USING btree (solicitud_id);


--
-- Name: idx_ocd_oc; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_ocd_oc ON public.orden_compra_detalle USING btree (orden_compra_id);


--
-- Name: idx_ocd_producto; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_ocd_producto ON public.orden_compra_detalle USING btree (producto_id);


--
-- Name: idx_pp_principal; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE UNIQUE INDEX idx_pp_principal ON public.producto_proveedor USING btree (producto_id) WHERE (es_principal = true);


--
-- Name: idx_pp_producto; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_pp_producto ON public.producto_proveedor USING btree (producto_id);


--
-- Name: idx_pp_proveedor; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_pp_proveedor ON public.producto_proveedor USING btree (proveedor_id);


--
-- Name: idx_precio_hist_producto; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_precio_hist_producto ON public.producto_precio_historial USING btree (producto_id, vigente_desde DESC, created_at DESC);


--
-- Name: idx_precio_hist_proveedor; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_precio_hist_proveedor ON public.producto_precio_historial USING btree (proveedor_id, vigente_desde DESC) WHERE (proveedor_id IS NOT NULL);


--
-- Name: idx_presentaciones_activa; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_presentaciones_activa ON public.presentaciones USING btree (activa) WHERE (activa = true);


--
-- Name: idx_presentaciones_codigo_barras; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_presentaciones_codigo_barras ON public.presentaciones USING btree (codigo_barras);


--
-- Name: idx_presentaciones_deleted; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_presentaciones_deleted ON public.presentaciones USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_presentaciones_gtin; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE UNIQUE INDEX idx_presentaciones_gtin ON public.presentaciones USING btree (gtin) WHERE (gtin IS NOT NULL);


--
-- Name: idx_presentaciones_producto; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_presentaciones_producto ON public.presentaciones USING btree (producto_id);


--
-- Name: idx_productos_activo; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_productos_activo ON public.productos USING btree (activo) WHERE (activo = true);


--
-- Name: idx_productos_categoria; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_productos_categoria ON public.productos USING btree (categoria_id);


--
-- Name: idx_productos_codigo; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_productos_codigo ON public.productos USING btree (codigo_interno);


--
-- Name: idx_productos_deleted; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_productos_deleted ON public.productos USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_productos_search_vector; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_productos_search_vector ON public.productos USING gin (search_vector);


--
-- Name: idx_proveedores_activa; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_proveedores_activa ON public.proveedores USING btree (activa) WHERE (activa = true);


--
-- Name: idx_proveedores_deleted; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_proveedores_deleted ON public.proveedores USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_rec_reconciliacion_estado; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_rec_reconciliacion_estado ON public.recepcion_reconciliacion USING btree (estado);


--
-- Name: idx_rec_reconciliacion_recepcion; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_rec_reconciliacion_recepcion ON public.recepcion_reconciliacion USING btree (recepcion_id);


--
-- Name: idx_rec_reconciliacion_solicitud; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_rec_reconciliacion_solicitud ON public.recepcion_reconciliacion USING btree (solicitud_id);


--
-- Name: idx_recepcion_detalle_ocd; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_recepcion_detalle_ocd ON public.recepcion_detalle USING btree (orden_compra_detalle_id);


--
-- Name: idx_recepcion_detalle_recepcion_id; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_recepcion_detalle_recepcion_id ON public.recepcion_detalle USING btree (recepcion_id);


--
-- Name: idx_recepciones_oc; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_recepciones_oc ON public.recepciones USING btree (orden_compra_id);


--
-- Name: idx_recepciones_solicitud; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_recepciones_solicitud ON public.recepciones USING btree (solicitud_id);


--
-- Name: idx_refresh_sessions_active; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_refresh_sessions_active ON public.refresh_sessions USING btree (usuario_id, expires_at) WHERE (revoked_at IS NULL);


--
-- Name: idx_refresh_sessions_usuario; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_refresh_sessions_usuario ON public.refresh_sessions USING btree (usuario_id);


--
-- Name: idx_scanner_items_session; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_scanner_items_session ON public.scanner_items USING btree (session_token, fetched);


--
-- Name: idx_sesiones_conteo_area; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_sesiones_conteo_area ON public.sesiones_conteo USING btree (area_id);


--
-- Name: idx_sesiones_conteo_estado; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_sesiones_conteo_estado ON public.sesiones_conteo USING btree (estado);


--
-- Name: idx_solicitud_detalle_solicitud; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_solicitud_detalle_solicitud ON public.solicitud_compra_detalle USING btree (solicitud_id);


--
-- Name: idx_solicitud_envios_estado; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_solicitud_envios_estado ON public.solicitud_envios USING btree (estado);


--
-- Name: idx_solicitud_envios_proveedor; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_solicitud_envios_proveedor ON public.solicitud_envios USING btree (proveedor_id);


--
-- Name: idx_solicitud_envios_solicitud; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_solicitud_envios_solicitud ON public.solicitud_envios USING btree (solicitud_id);


--
-- Name: idx_solicitudes_estado; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_solicitudes_estado ON public.solicitudes_compra USING btree (estado);


--
-- Name: idx_solicitudes_usuario; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_solicitudes_usuario ON public.solicitudes_compra USING btree (usuario_id);


--
-- Name: idx_stock_activo; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_stock_activo ON public.stock USING btree (lote_id, area_id) WHERE (cantidad > (0)::numeric);


--
-- Name: idx_stock_area; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_stock_area ON public.stock USING btree (area_id);


--
-- Name: idx_stock_area_cantidad; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_stock_area_cantidad ON public.stock USING btree (area_id, cantidad) WHERE (cantidad > (0)::numeric);


--
-- Name: idx_stock_lote; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_stock_lote ON public.stock USING btree (lote_id);


--
-- Name: idx_unidades_basicas_activo; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_unidades_basicas_activo ON public.unidades_basicas USING btree (activo) WHERE (activo = true);


--
-- Name: idx_unidades_deleted; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_unidades_deleted ON public.unidades_basicas USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_usuarios_activo; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_usuarios_activo ON public.usuarios USING btree (activo) WHERE (activo = true);


--
-- Name: idx_usuarios_whatsapp_phone; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_usuarios_whatsapp_phone ON public.usuarios USING btree (whatsapp_phone) WHERE (whatsapp_phone IS NOT NULL);


--
-- Name: idx_whatsapp_logs_created; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_whatsapp_logs_created ON public.whatsapp_webhook_logs USING btree (created_at);


--
-- Name: idx_whatsapp_logs_phone; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_whatsapp_logs_phone ON public.whatsapp_webhook_logs USING btree (sender_phone);


--
-- Name: idx_whatsapp_logs_status; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE INDEX idx_whatsapp_logs_status ON public.whatsapp_webhook_logs USING btree (status);


--
-- Name: uq_solicitudes_compra_borrador_por_usuario; Type: INDEX; Schema: public; Owner: lab_user
--

CREATE UNIQUE INDEX uq_solicitudes_compra_borrador_por_usuario ON public.solicitudes_compra USING btree (usuario_id) WHERE (estado = 'borrador'::text);


--
-- Name: solicitud_envios solicitud_envios_updated; Type: TRIGGER; Schema: public; Owner: lab_user
--

CREATE TRIGGER solicitud_envios_updated BEFORE UPDATE ON public.solicitud_envios FOR EACH ROW EXECUTE FUNCTION public.trg_solicitud_envios_updated();


--
-- Name: movimientos trg_actualizar_stock; Type: TRIGGER; Schema: public; Owner: lab_user
--

CREATE TRIGGER trg_actualizar_stock BEFORE INSERT ON public.movimientos FOR EACH ROW EXECUTE FUNCTION public.fn_procesar_movimiento_stock();


--
-- Name: productos trg_productos_search_vector; Type: TRIGGER; Schema: public; Owner: lab_user
--

CREATE TRIGGER trg_productos_search_vector BEFORE INSERT OR UPDATE OF nombre, codigo_interno, codigo_proveedor, codigo_maestro, descripcion ON public.productos FOR EACH ROW EXECUTE FUNCTION public.productos_search_vector_update();


--
-- Name: audit_log audit_log_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: conteo_items conteo_items_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.conteo_items
    ADD CONSTRAINT conteo_items_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id);


--
-- Name: conteo_items conteo_items_sesion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.conteo_items
    ADD CONSTRAINT conteo_items_sesion_id_fkey FOREIGN KEY (sesion_id) REFERENCES public.sesiones_conteo(id) ON DELETE CASCADE;


--
-- Name: idempotency_keys idempotency_keys_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: lotes lotes_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: lotes lotes_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.lotes
    ADD CONSTRAINT lotes_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: movimientos movimientos_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.movimientos
    ADD CONSTRAINT movimientos_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id);


--
-- Name: movimientos movimientos_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.movimientos
    ADD CONSTRAINT movimientos_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id);


--
-- Name: movimientos movimientos_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.movimientos
    ADD CONSTRAINT movimientos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: orden_compra_detalle orden_compra_detalle_area_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_area_destino_id_fkey FOREIGN KEY (area_destino_id) REFERENCES public.areas(id);


--
-- Name: orden_compra_detalle orden_compra_detalle_orden_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES public.ordenes_compra(id) ON DELETE CASCADE;


--
-- Name: orden_compra_detalle orden_compra_detalle_presentacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_presentacion_id_fkey FOREIGN KEY (presentacion_id) REFERENCES public.presentaciones(id);


--
-- Name: orden_compra_detalle orden_compra_detalle_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.orden_compra_detalle
    ADD CONSTRAINT orden_compra_detalle_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: ordenes_compra ordenes_compra_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: ordenes_compra ordenes_compra_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes_compra(id) ON DELETE RESTRICT;


--
-- Name: ordenes_compra ordenes_compra_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.ordenes_compra
    ADD CONSTRAINT ordenes_compra_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: presentaciones presentaciones_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.presentaciones
    ADD CONSTRAINT presentaciones_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: producto_area producto_area_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_area
    ADD CONSTRAINT producto_area_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE CASCADE;


--
-- Name: producto_area producto_area_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_area
    ADD CONSTRAINT producto_area_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: producto_precio_historial producto_precio_historial_presentacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_precio_historial
    ADD CONSTRAINT producto_precio_historial_presentacion_id_fkey FOREIGN KEY (presentacion_id) REFERENCES public.presentaciones(id);


--
-- Name: producto_precio_historial producto_precio_historial_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_precio_historial
    ADD CONSTRAINT producto_precio_historial_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: producto_precio_historial producto_precio_historial_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_precio_historial
    ADD CONSTRAINT producto_precio_historial_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: producto_precio_historial producto_precio_historial_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_precio_historial
    ADD CONSTRAINT producto_precio_historial_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: producto_proveedor producto_proveedor_presentacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_proveedor
    ADD CONSTRAINT producto_proveedor_presentacion_id_fkey FOREIGN KEY (presentacion_id) REFERENCES public.presentaciones(id);


--
-- Name: producto_proveedor producto_proveedor_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_proveedor
    ADD CONSTRAINT producto_proveedor_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE CASCADE;


--
-- Name: producto_proveedor producto_proveedor_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.producto_proveedor
    ADD CONSTRAINT producto_proveedor_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: productos productos_categoria_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_categoria_id_fkey FOREIGN KEY (categoria_id) REFERENCES public.categorias(id);


--
-- Name: productos productos_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: productos productos_unidad_base_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.productos
    ADD CONSTRAINT productos_unidad_base_id_fkey FOREIGN KEY (unidad_base_id) REFERENCES public.unidades_basicas(id);


--
-- Name: recepcion_detalle recepcion_detalle_area_destino_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle
    ADD CONSTRAINT recepcion_detalle_area_destino_id_fkey FOREIGN KEY (area_destino_id) REFERENCES public.areas(id);


--
-- Name: recepcion_detalle recepcion_detalle_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle
    ADD CONSTRAINT recepcion_detalle_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id);


--
-- Name: recepcion_detalle recepcion_detalle_orden_compra_detalle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle
    ADD CONSTRAINT recepcion_detalle_orden_compra_detalle_id_fkey FOREIGN KEY (orden_compra_detalle_id) REFERENCES public.orden_compra_detalle(id);


--
-- Name: recepcion_detalle recepcion_detalle_presentacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle
    ADD CONSTRAINT recepcion_detalle_presentacion_id_fkey FOREIGN KEY (presentacion_id) REFERENCES public.presentaciones(id);


--
-- Name: recepcion_detalle recepcion_detalle_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle
    ADD CONSTRAINT recepcion_detalle_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: recepcion_detalle recepcion_detalle_recepcion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_detalle
    ADD CONSTRAINT recepcion_detalle_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES public.recepciones(id) ON DELETE CASCADE;


--
-- Name: recepcion_reconciliacion recepcion_reconciliacion_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_reconciliacion
    ADD CONSTRAINT recepcion_reconciliacion_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: recepcion_reconciliacion recepcion_reconciliacion_recepcion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_reconciliacion
    ADD CONSTRAINT recepcion_reconciliacion_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES public.recepciones(id) ON DELETE CASCADE;


--
-- Name: recepcion_reconciliacion recepcion_reconciliacion_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepcion_reconciliacion
    ADD CONSTRAINT recepcion_reconciliacion_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes_compra(id) ON DELETE CASCADE;


--
-- Name: recepciones recepciones_orden_compra_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepciones
    ADD CONSTRAINT recepciones_orden_compra_id_fkey FOREIGN KEY (orden_compra_id) REFERENCES public.ordenes_compra(id);


--
-- Name: recepciones recepciones_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepciones
    ADD CONSTRAINT recepciones_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: recepciones recepciones_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepciones
    ADD CONSTRAINT recepciones_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes_compra(id);


--
-- Name: recepciones recepciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.recepciones
    ADD CONSTRAINT recepciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: refresh_sessions refresh_sessions_replaced_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES public.refresh_sessions(id) ON DELETE SET NULL;


--
-- Name: refresh_sessions refresh_sessions_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.refresh_sessions
    ADD CONSTRAINT refresh_sessions_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: scanner_items scanner_items_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.scanner_items
    ADD CONSTRAINT scanner_items_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: scanner_items scanner_items_session_token_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.scanner_items
    ADD CONSTRAINT scanner_items_session_token_fkey FOREIGN KEY (session_token) REFERENCES public.scanner_sessions(token) ON DELETE CASCADE;


--
-- Name: scanner_sessions scanner_sessions_recepcion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.scanner_sessions
    ADD CONSTRAINT scanner_sessions_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES public.recepciones(id) ON DELETE CASCADE;


--
-- Name: sesiones_conteo sesiones_conteo_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.sesiones_conteo
    ADD CONSTRAINT sesiones_conteo_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id);


--
-- Name: sesiones_conteo sesiones_conteo_usuario_confirmador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.sesiones_conteo
    ADD CONSTRAINT sesiones_conteo_usuario_confirmador_id_fkey FOREIGN KEY (usuario_confirmador_id) REFERENCES public.usuarios(id);


--
-- Name: sesiones_conteo sesiones_conteo_usuario_creador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.sesiones_conteo
    ADD CONSTRAINT sesiones_conteo_usuario_creador_id_fkey FOREIGN KEY (usuario_creador_id) REFERENCES public.usuarios(id);


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_presentacion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_presentacion_id_fkey FOREIGN KEY (presentacion_id) REFERENCES public.presentaciones(id);


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.productos(id);


--
-- Name: solicitud_compra_detalle solicitud_compra_detalle_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_compra_detalle
    ADD CONSTRAINT solicitud_compra_detalle_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes_compra(id) ON DELETE CASCADE;


--
-- Name: solicitud_envios solicitud_envios_proveedor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_envios
    ADD CONSTRAINT solicitud_envios_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES public.proveedores(id);


--
-- Name: solicitud_envios solicitud_envios_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_envios
    ADD CONSTRAINT solicitud_envios_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes_compra(id) ON DELETE CASCADE;


--
-- Name: solicitud_envios solicitud_envios_usuario_envio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitud_envios
    ADD CONSTRAINT solicitud_envios_usuario_envio_id_fkey FOREIGN KEY (usuario_envio_id) REFERENCES public.usuarios(id);


--
-- Name: solicitudes_compra solicitudes_compra_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id);


--
-- Name: stock stock_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id);


--
-- Name: stock stock_lote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.stock
    ADD CONSTRAINT stock_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES public.lotes(id);


--
-- Name: usuario_area usuario_area_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.usuario_area
    ADD CONSTRAINT usuario_area_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.areas(id) ON DELETE CASCADE;


--
-- Name: usuario_area usuario_area_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.usuario_area
    ADD CONSTRAINT usuario_area_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;


--
-- Name: whatsapp_webhook_logs whatsapp_webhook_logs_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lab_user
--

ALTER TABLE ONLY public.whatsapp_webhook_logs
    ADD CONSTRAINT whatsapp_webhook_logs_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuarios(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--



-- ============================================================
-- SEED DATA (CONSOLIDATED)
-- ============================================================

-- Seed Unidades de medida base
INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES
    ('unidad', 'unidades'),
    ('mililitro', 'mililitros'),
    ('gramo', 'gramos'),
    ('prueba', 'pruebas'),
    ('litro', 'litros'),
    ('kilogramo', 'kilogramos')
ON CONFLICT (nombre) DO NOTHING;

-- Seed 12 Áreas del laboratorio
INSERT INTO areas (nombre, es_bodega) VALUES
    ('Microbiología', false),
    ('PCR', false),
    ('Orinas', false),
    ('Recepción', false),
    ('Laboratorio Central', false),
    ('Bodega Insumos', true),
    ('Bodega Reactivos', true),
    ('Serología', false),
    ('Unidad de Medicina Transfusional', false),
    ('Donantes', false),
    ('Sala Entrevista Donantes', false),
    ('Sala de Toma de Muestras', false)
ON CONFLICT (nombre) DO NOTHING;

-- Seed Categorías iniciales
INSERT INTO categorias (nombre, descripcion) VALUES
    ('Reactivo',            'Compuestos químicos para reacciones diagnósticas'),
    ('Consumible',          'Material de uso único: tubos, puntas, placas, lancetas, etc.'),
    ('Calibrador',          'Materiales de calibración de equipos analíticos'),
    ('Control',             'Sueros y materiales de control de calidad interno'),
    ('Kit diagnóstico',     'Kits completos para pruebas específicas'),
    ('Medio de cultivo',    'Medios sólidos y líquidos para microbiología'),
    ('Material de extracción', 'Tubos vacutainer, agujas, torniquetes'),
    ('Solución / Buffer',   'Diluyentes, soluciones de lavado y fijadores'),
    ('EPP',                 'Equipos de protección personal: guantes, mascarillas, lentes'),
    ('Papelería',           'Etiquetas, formularios y material administrativo')
ON CONFLICT (nombre) DO NOTHING;

-- Seed Formatos de presentación predefinidos
INSERT INTO presentacion_formatos (nombre, nombre_plural, es_predefinido) VALUES
    ('Ampolla', 'Ampollas', TRUE),
    ('Blister', 'Blisters', TRUE),
    ('Bolsa', 'Bolsas', TRUE),
    ('Botella', 'Botellas', TRUE),
    ('Caja', 'Cajas', TRUE),
    ('Frasco', 'Frascos', TRUE),
    ('Jeringa', 'Jeringas', TRUE),
    ('Kit', 'Kits', TRUE),
    ('Lata', 'Latas', TRUE),
    ('Paquete', 'Paquetes', TRUE),
    ('Rollo', 'Rollos', TRUE),
    ('Sobre', 'Sobres', TRUE),
    ('Tubo', 'Tubos', TRUE),
    ('Unidad', 'Unidades', TRUE)
ON CONFLICT (nombre) DO NOTHING;

-- Seed Configuraciones iniciales
INSERT INTO configuracion (clave, valor_texto) VALUES
    ('setup_finalizado', 'false'),
    ('nombre_laboratorio', 'Laboratorio Clínico'),
    ('logo_base64', ''),
    ('logo_path', ''),
    ('conteo_ciego', 'false'),
    ('moneda_codigo', 'CLP'),
    ('moneda_simbolo', '$'),
    ('conteo_periodo_dias', '30'),
    ('ventana_consumo_dias', '30'),
    ('periodo_revision_dias', '30'),
    ('nivel_servicio_z', '1.65'),
    ('ventana_demanda_dias', '60'),
    ('dias_minimos_historia', '14'),
    ('factor_historial_corto', '0.35'),
    ('ia_proveedor', 'gemini'),
    ('ia_modelo', 'gemini-1.5-flash'),
    ('ia_api_url', ''),
    ('ia_api_key', ''),
    ('whatsapp_api_url', ''),
    ('whatsapp_api_key', ''),
    ('whatsapp_webhook_secret', ''),
    ('whatsapp_bot_phone', '')
ON CONFLICT (clave) DO UPDATE SET valor_texto = EXCLUDED.valor_texto;


-- ============================================================
-- Originally: 002_database_fixes.sql
-- ============================================================

-- 1. Unification of decimal precision
ALTER TABLE public.recepcion_detalle ALTER COLUMN precio_unitario TYPE numeric(12,4);
ALTER TABLE public.solicitud_compra_detalle ALTER COLUMN precio_unitario TYPE numeric(12,4);
ALTER TABLE public.presentaciones ALTER COLUMN factor_conversion TYPE numeric(12,6);
ALTER TABLE public.recepcion_detalle ALTER COLUMN factor_conversion_usado TYPE numeric(12,6);

-- 2. Dropping redundant columns from productos table
-- We drop the search vector trigger first because it references the columns we want to drop
DROP TRIGGER IF EXISTS trg_productos_search_vector ON public.productos;

-- Update search vector update function to not reference dropped columns
CREATE OR REPLACE FUNCTION public.productos_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.nombre, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_interno, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.descripcion, '')), 'C');
    RETURN NEW;
END;
$$;

-- Drop foreign key constraint on productos first
ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_proveedor_id_fkey;

-- Drop the columns
ALTER TABLE public.productos DROP COLUMN IF EXISTS proveedor_id;
ALTER TABLE public.productos DROP COLUMN IF EXISTS codigo_proveedor;
ALTER TABLE public.productos DROP COLUMN IF EXISTS codigo_maestro;
ALTER TABLE public.productos DROP COLUMN IF EXISTS precio_unidad;

-- Recreate trigger on productos table
CREATE TRIGGER trg_productos_search_vector
    BEFORE INSERT OR UPDATE OF nombre, codigo_interno, descripcion
    ON public.productos
    FOR EACH ROW
    EXECUTE FUNCTION public.productos_search_vector_update();

-- 3. Modification of UNIQUE constraints on soft-deleted tables
ALTER TABLE public.areas DROP CONSTRAINT IF EXISTS areas_nombre_key;
CREATE UNIQUE INDEX idx_areas_nombre_active ON public.areas (nombre) WHERE deleted_at IS NULL;

ALTER TABLE public.categorias DROP CONSTRAINT IF EXISTS categorias_nombre_key;
CREATE UNIQUE INDEX idx_categorias_nombre_active ON public.categorias (nombre) WHERE deleted_at IS NULL;

ALTER TABLE public.productos DROP CONSTRAINT IF EXISTS productos_codigo_interno_key;
CREATE UNIQUE INDEX idx_productos_codigo_interno_active ON public.productos (codigo_interno) WHERE deleted_at IS NULL;

ALTER TABLE public.unidades_basicas DROP CONSTRAINT IF EXISTS unidades_medida_nombre_key;
CREATE UNIQUE INDEX idx_unidades_basicas_nombre_active ON public.unidades_basicas (nombre) WHERE deleted_at IS NULL;

-- 4. Setting generar_codigo_lote() as DEFAULT value for lotes.codigo_interno
ALTER TABLE public.lotes ALTER COLUMN codigo_interno SET DEFAULT public.generar_codigo_lote();

-- 5. Adding nullable foreign key formato_id in presentaciones
ALTER TABLE public.presentaciones ADD COLUMN formato_id integer REFERENCES public.presentacion_formatos(id);

-- 6. Automating updated_at tracking
CREATE OR REPLACE FUNCTION public.fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_timestamp_productos
    BEFORE UPDATE ON public.productos
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_update_timestamp_usuarios
    BEFORE UPDATE ON public.usuarios
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_update_timestamp_stock
    BEFORE UPDATE ON public.stock
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_update_timestamp();

-- 7. Add missing columns and foreign keys for unit/integration tests compatibility
ALTER TABLE public.solicitud_compra_detalle DROP COLUMN IF EXISTS unidad;
ALTER TABLE public.solicitud_compra_detalle ADD COLUMN unidad_basica_id integer REFERENCES public.unidades_basicas(id);

ALTER TABLE public.orden_compra_detalle DROP COLUMN IF EXISTS unidad;
ALTER TABLE public.orden_compra_detalle ADD COLUMN unidad_basica_id integer REFERENCES public.unidades_basicas(id);

-- 8. Add missing sku column and unique active partial index to presentaciones table
ALTER TABLE public.presentaciones ADD COLUMN sku character varying(100);
CREATE UNIQUE INDEX idx_presentaciones_sku_active ON public.presentaciones (sku) WHERE deleted_at IS NULL AND sku IS NOT NULL;

-- 9. Add check constraint to enforce exclusivity between unidad_basica_id and presentacion_id in solicitud_compra_detalle
ALTER TABLE public.solicitud_compra_detalle
    ADD CONSTRAINT chk_solicitud_detalle_unidad_exclusiva
    CHECK (
        (unidad_basica_id IS NOT NULL AND presentacion_id IS NULL) OR
        (unidad_basica_id IS NULL AND presentacion_id IS NOT NULL)
    );


-- ============================================================
-- Originally: 003_database_refinements.sql
-- ============================================================

-- 1. Fix the race condition in public.fn_procesar_movimiento_stock()
-- We lock the corresponding row in the public.lotes table (which always exists)
-- to serialize concurrent stock updates for that batch.
CREATE OR REPLACE FUNCTION public.fn_procesar_movimiento_stock() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_signo DECIMAL := 1;
    v_stock_actual DECIMAL := 0;
BEGIN
    -- Bloquear el lote en la tabla public.lotes para serializar inserciones/actualizaciones concurrentes de stock
    PERFORM id FROM public.lotes WHERE id = NEW.lote_id FOR UPDATE;

    -- Determinar el signo según el tipo de movimiento
    IF NEW.tipo IN ('CONSUMO', 'AJUSTE_NEGATIVO', 'TRANSFERENCIA_SALIDA', 'DESCARTE_VENCIDO', 'DESCARTE_DAÑADO') THEN
        v_signo := -1;
    END IF;

    -- Obtener el stock actual del lote en el área (bloqueando la fila del stock)
    SELECT cantidad INTO v_stock_actual
    FROM public.stock
    WHERE lote_id = NEW.lote_id AND area_id = NEW.area_id
    FOR UPDATE;

    IF NOT FOUND THEN
        v_stock_actual := 0;
    END IF;

    -- Calcular la cantidad resultante
    NEW.cantidad_resultante := v_stock_actual + (NEW.cantidad * v_signo);

    -- Validar que el stock no sea negativo
    IF NEW.cantidad_resultante < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para el lote % en el área %. Actual: %, Requerido: %', 
            NEW.lote_id, NEW.area_id, v_stock_actual, NEW.cantidad;
    END IF;

    -- Actualizar o Insertar en la tabla stock
    INSERT INTO public.stock (lote_id, area_id, cantidad, updated_at)
    VALUES (NEW.lote_id, NEW.area_id, NEW.cantidad_resultante, NOW())
    ON CONFLICT (lote_id, area_id) 
    DO UPDATE SET 
        cantidad = EXCLUDED.cantidad,
        updated_at = EXCLUDED.updated_at;

    RETURN NEW;
END;
$$;

-- 2. Improve UNIQUE constraint on public.lotes table to handle NULL values for proveedor_id
-- Since PostgreSQL 15, we can use UNIQUE NULLS NOT DISTINCT. This matches the ON CONFLICT (producto_id, proveedor_id, numero_lote) 
-- syntax in the Rust backend while ensuring NULL values in proveedor_id do not allow duplicates.
ALTER TABLE public.lotes DROP CONSTRAINT IF EXISTS lotes_producto_proveedor_lote_key;

ALTER TABLE public.lotes ADD CONSTRAINT lotes_producto_proveedor_lote_key 
    UNIQUE NULLS NOT DISTINCT (producto_id, proveedor_id, numero_lote);

-- 3. Add soft delete (deleted_at) to public.usuarios table
ALTER TABLE public.usuarios ADD COLUMN deleted_at timestamp with time zone;

-- 4. Recreate unique constraints for usuarios as partial indexes supporting soft delete
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_email_key;
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_whatsapp_phone_key;

CREATE UNIQUE INDEX idx_usuarios_email_active ON public.usuarios (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_usuarios_whatsapp_phone_active ON public.usuarios (whatsapp_phone) WHERE deleted_at IS NULL AND whatsapp_phone IS NOT NULL;


-- ============================================================
-- Originally: 069_presentaciones_proveedor.sql
-- ============================================================

-- 069: Supplier-aware presentations join table + lot packaging traceability
-- Adds producto_proveedor_presentacion table and lotes.presentacion_id column.
-- producto_proveedor.presentacion_id is kept for now (legacy, do not use for reads)


-- 1. Join table: links a producto_proveedor record to one or more presentations,
--    with a single active default per supplier+product link enforced at DB level.
CREATE TABLE producto_proveedor_presentacion (
    id                     SERIAL PRIMARY KEY,
    producto_proveedor_id  INTEGER NOT NULL
        REFERENCES producto_proveedor(id) ON DELETE CASCADE,
    presentacion_id        INTEGER NOT NULL
        REFERENCES presentaciones(id),
    es_default             BOOLEAN NOT NULL DEFAULT false,
    precio_unidad          NUMERIC(12,4),
    activo                 BOOLEAN NOT NULL DEFAULT true,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (producto_proveedor_id, presentacion_id)
);

-- Exactly one active default per supplier+product link (partial unique index).
-- activo = true ensures soft-deleted rows don't count toward the constraint.
CREATE UNIQUE INDEX uq_ppp_default
    ON producto_proveedor_presentacion (producto_proveedor_id)
    WHERE es_default = true AND activo = true;

-- Performance index for active listing queries.
CREATE INDEX idx_ppp_pp
    ON producto_proveedor_presentacion (producto_proveedor_id)
    WHERE activo = true;

COMMENT ON TABLE producto_proveedor_presentacion IS
    'Supplier+product to presentation link with optional default and per-presentation price. Supersedes producto_proveedor.presentacion_id (deprecated, not dropped).';

-- 2. Migrate existing default links from the legacy column.
INSERT INTO producto_proveedor_presentacion
    (producto_proveedor_id, presentacion_id, es_default, precio_unidad, activo)
SELECT pp.id, pp.presentacion_id, true, pp.precio_unidad, true
FROM producto_proveedor pp
WHERE pp.presentacion_id IS NOT NULL
ON CONFLICT (producto_proveedor_id, presentacion_id) DO NOTHING;

-- 3. Add nullable lot packaging FK (backward-compatible; existing lots get NULL).
ALTER TABLE lotes ADD COLUMN presentacion_id INTEGER REFERENCES presentaciones(id);

COMMENT ON COLUMN lotes.presentacion_id IS
    'Presentation the lot arrived in (reception). NULL for legacy or unmatched lots.';

-- 4. Backfill lotes.presentacion_id from most-recent recepcion_detalle per lot.
--    Uses DISTINCT ON ordered by created_at DESC, id DESC for determinism.
UPDATE lotes l
SET presentacion_id = sub.presentacion_id
FROM (
    SELECT DISTINCT ON (rd.lote_id)
        rd.lote_id,
        rd.presentacion_id
    FROM recepcion_detalle rd
    WHERE rd.presentacion_id IS NOT NULL
    ORDER BY rd.lote_id, rd.created_at DESC, rd.id DESC
) sub
WHERE sub.lote_id = l.id;

-- 5. Deprecation notice on the legacy column (not dropped this cycle).
COMMENT ON COLUMN producto_proveedor.presentacion_id IS
    'DEPRECATED: kept for rollback safety. Use producto_proveedor_presentacion instead. Will be dropped in a future migration.';

