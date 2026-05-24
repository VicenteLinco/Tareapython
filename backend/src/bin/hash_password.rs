use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};

fn main() {
    let password = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!("Uso: cargo run --bin hash_password -- <password>");
        std::process::exit(2);
    });
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("Error hasheando password")
        .to_string();
    println!("{}", hash);
}
