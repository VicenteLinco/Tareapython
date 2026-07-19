use sqlx::PgPool;
use sqlx::migrate::{MigrateError, Migrator};

static MIGRATOR: Migrator = sqlx::migrate!("./migrations");
const LEGACY_RESET_TOKEN: &str = "legacy-001-019";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryDecision {
    ResetPublicSchema,
    Fail,
}

pub fn legacy_reset_authorized(value: Option<&str>) -> bool {
    value.is_some_and(|value| value == LEGACY_RESET_TOKEN)
}

pub fn is_exact_legacy_history(versions: &[(i64, bool)]) -> bool {
    versions.len() == 19
        && versions
            .iter()
            .enumerate()
            .all(|(index, (version, success))| *version == (index as i64 + 1) && *success)
}

pub fn recovery_decision(
    error: &MigrateError,
    authorized: bool,
    exact_legacy: bool,
) -> RecoveryDecision {
    if authorized && exact_legacy && matches!(error, MigrateError::VersionMissing(2)) {
        RecoveryDecision::ResetPublicSchema
    } else {
        RecoveryDecision::Fail
    }
}

async fn legacy_history(pool: &PgPool) -> Result<Vec<(i64, bool)>, sqlx::Error> {
    sqlx::query_as("SELECT version, success FROM _sqlx_migrations ORDER BY version")
        .fetch_all(pool)
        .await
}

async fn reset_public_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    sqlx::query("DROP SCHEMA public CASCADE")
        .execute(&mut *transaction)
        .await?;
    sqlx::query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER")
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await
}

pub async fn run_startup_migrations(
    pool: &PgPool,
    legacy_reset_authorized: bool,
    disposable_reset_authorized: bool,
) -> Result<(), MigrateError> {
    match MIGRATOR.run(pool).await {
        Ok(()) => Ok(()),
        Err(error) => {
            let exact_legacy = if legacy_reset_authorized {
                legacy_history(pool)
                    .await
                    .map(|versions| is_exact_legacy_history(&versions))
                    .unwrap_or(false)
            } else {
                false
            };
            let decision = recovery_decision(&error, legacy_reset_authorized, exact_legacy);
            let checksum_reset =
                disposable_reset_authorized && matches!(error, MigrateError::VersionMismatch(1));
            if decision != RecoveryDecision::ResetPublicSchema && !checksum_reset {
                return Err(error);
            }
            tracing::warn!(migration_error = %error, "one-time recovery of exact legacy SQLx history 001-019; resetting disposable public schema");
            reset_public_schema(pool)
                .await
                .map_err(MigrateError::Execute)?;
            MIGRATOR.run(pool).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_must_match_exactly() {
        assert!(legacy_reset_authorized(Some("legacy-001-019")));
        assert!(!legacy_reset_authorized(Some("true")));
        assert!(!legacy_reset_authorized(None));
    }

    #[test]
    fn only_exact_successful_legacy_history_is_eligible() {
        let legacy = (1..=19).map(|v| (v, true)).collect::<Vec<_>>();
        assert!(is_exact_legacy_history(&legacy));
        assert!(!is_exact_legacy_history(&legacy[..18]));
        let mut dirty = legacy.clone();
        dirty[4].1 = false;
        assert!(!is_exact_legacy_history(&dirty));
        let future = (1..=20).map(|v| (v, true)).collect::<Vec<_>>();
        assert!(!is_exact_legacy_history(&future));
    }

    #[test]
    fn future_or_arbitrary_conflicts_fail_closed() {
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(2), true, true),
            RecoveryDecision::ResetPublicSchema
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(3), true, true),
            RecoveryDecision::Fail
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMismatch(1), true, true),
            RecoveryDecision::Fail
        );
        assert_eq!(
            recovery_decision(&MigrateError::VersionMissing(2), true, false),
            RecoveryDecision::Fail
        );
    }
}
