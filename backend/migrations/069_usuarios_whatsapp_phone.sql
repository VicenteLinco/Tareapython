-- Migration 069: Add whatsapp_phone to usuarios table
ALTER TABLE usuarios ADD COLUMN whatsapp_phone VARCHAR(50) UNIQUE;
