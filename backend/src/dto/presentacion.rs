use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Type)]
pub struct AssignGtinRequest {
    /// Explicit GTIN supplied by the supplier (13 or 14 digits).
    pub gtin: Option<String>,
    /// When true, auto-generate a GS1-compliant internal GTIN using the
    /// configured company prefix.
    pub generate_internal: Option<bool>,
}

#[derive(Debug, Serialize, Type)]
pub struct AssignGtinResponse {
    pub presentacion_id: i32,
    pub gtin: String,
    /// true if the GTIN was internally generated (not supplied by the caller).
    pub generated: bool,
}
