pub fn normalize_phone(phone: &str) -> String {
    let trimmed = phone.trim();
    let mut normalized = String::new();
    if trimmed.starts_with('+') {
        normalized.push('+');
    }
    for c in trimmed.chars() {
        if c.is_ascii_digit() {
            normalized.push(c);
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_phone() {
        assert_eq!(normalize_phone("+56 9 1234 5678"), "+56912345678");
        assert_eq!(normalize_phone("56912345678"), "56912345678");
        assert_eq!(normalize_phone("  +56-9-1234-5678  "), "+56912345678");
        assert_eq!(normalize_phone("+"), "+");
        assert_eq!(normalize_phone(""), "");
    }
}
