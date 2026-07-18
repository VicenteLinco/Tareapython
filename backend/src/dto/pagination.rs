use crate::errors::AppError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

impl PaginationParams {
    pub fn page(&self) -> i64 {
        self.page.unwrap_or(1).max(1)
    }

    pub fn per_page(&self) -> i64 {
        self.per_page.unwrap_or(25).clamp(1, 100)
    }

    pub fn offset(&self) -> i64 {
        (self.page() - 1) * self.per_page()
    }

    pub fn validated(self) -> Result<Self, AppError> {
        if let Some(pp) = self.per_page {
            if pp < 1 {
                return Err(AppError::Validation("per_page debe ser >= 1".into()));
            }
            if pp > 200 {
                return Err(AppError::Validation("per_page no puede superar 200".into()));
            }
        }
        Ok(self)
    }
}

#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}
