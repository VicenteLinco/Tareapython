use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::Type as SqlxType;

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoSolicitud {
    Borrador,
    Guardada,
    ParcialmenteEnviada,
    Enviada,
    ParcialmenteRecibida,
    Completada,
    Cancelada,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoRecepcion {
    Borrador,
    Completa,
    Parcial,
    Rechazada,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoOrdenCompra {
    Borrador,
    Enviada,
    RecibidaParcial,
    RecibidaTotal,
    Cancelada,
}

// Estado de sesión de conteo
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoConteoSesion {
    Borrador,
    EnProgreso,
    Confirmado,
    Cancelado,
}

// Estado de ítem de conteo
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoConteoItem {
    Contado,
    NoContado,
}

// Estado de envío a proveedor (en solicitudes de compra)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoEnvioProveedor {
    Pendiente,
    Enviado,
    Cancelado,
}

// Confianza del forecast
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ConfianzaForecast {
    Alta,
    Media,
    Baja,
}

// Urgencia de reposición
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
#[allow(dead_code)]
pub enum UrgenciaReposicion {
    Critica,
    Alta,
    Media,
}

// Política de control de lote de un producto.
// 'con_vto' es el comportamiento por defecto (actual).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ControlLote {
    Trazable,
    ConVto,
    Simple,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoCatalogo {
    PendienteAprobacion,
    Aprobado,
}

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum OrigenRegistro {
    Manual,
    ApiRegulatoria,
    GuiaPdf,
}

