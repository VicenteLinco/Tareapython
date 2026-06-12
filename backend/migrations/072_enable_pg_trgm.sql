-- Migration: Enable pg_trgm extension for fuzzy matching on product names
CREATE EXTENSION IF NOT EXISTS pg_trgm;
