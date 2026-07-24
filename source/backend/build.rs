fn main() {
    println!("cargo:rerun-if-changed=.env");

    // Attempt to load .env, but ignore if it doesn't exist
    let _ = dotenvy::dotenv();

    // Check if we are compiling for debug (typically local dev or tests)
    if std::env::var("PROFILE").unwrap_or_default() == "debug" {
        if let Ok(db_url) = std::env::var("DATABASE_URL") {
            let is_remote = db_url.contains("neon.tech")
                || db_url.contains("rds.amazonaws.com")
                || db_url.contains("render.com");

            if is_remote && std::env::var("SQLX_OFFLINE").unwrap_or_default() != "true" {
                panic!("SECURITY VIOLATION [OPS-DB-ISOLATION-001]: Remote database host detected in DATABASE_URL during compilation! This prevents accidental remote database mutations during tests. Use the test-isolated-db.sh wrapper instead.");
            }
        }
    }
}
