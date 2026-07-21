use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PaginatedResponse<T> {
    pub data: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}

impl<T: Serialize> PaginatedResponse<T> {
    pub fn new(data: Vec<T>, total: i64, page: i64, per_page: i64) -> Self {
        let total = total.max(0);
        let page = page.max(1);
        let per_page = per_page.max(1);
        let total_pages = if total == 0 {
            0
        } else {
            1 + (total - 1) / per_page
        };

        Self {
            data,
            total,
            page,
            per_page,
            total_pages,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PaginatedResponse;

    #[test]
    fn calculates_total_pages_with_ceiling_division() {
        let response = PaginatedResponse::new(vec!["product"; 20], 21, 1, 20);

        assert_eq!(response.total_pages, 2);
        assert_eq!(response.per_page, 20);
    }

    #[test]
    fn calculates_total_pages_safely_for_invalid_page_size() {
        let response = PaginatedResponse::new(Vec::<String>::new(), 21, 1, 0);

        assert_eq!(response.total_pages, 21);
        assert_eq!(response.per_page, 1);
    }
}
