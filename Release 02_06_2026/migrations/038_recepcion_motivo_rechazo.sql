-- Migration 038: Add motivo_rechazo column to recepciones table
ALTER TABLE recepciones ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
