use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::Type as SqlxType;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EstadoRecepcion {
    Borrador,
    Completa,
    Parcial,
    Rechazada,
}

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
pub enum ConfianzaForecast {
    Alta,
    Media,
    Baja,
}

// Urgencia de reposición
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, SqlxType)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum UrgenciaReposicion {
    Critica,
    Alta,
    Media,
}
