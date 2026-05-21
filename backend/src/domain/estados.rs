use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EstadoSolicitud {
    Borrador,
    Guardada,
    PendienteAprobacion,
    Aprobada,
    Rechazada,
    ParcialmenteEnviada,
    ParcialmenteRecibida,
    Enviada,
    Completada,
    Cerrada,
    Cancelada,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EstadoRecepcion {
    Borrador,
    Confirmada,
    Cancelada,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum EstadoOrdenCompra {
    Borrador,
    Enviada,
    RecibidaParcial,
    RecibidaTotal,
    Cancelada,
}
