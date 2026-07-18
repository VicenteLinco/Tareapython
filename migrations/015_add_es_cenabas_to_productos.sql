-- Migration: Add es_cenabas to productos
ALTER TABLE public.productos 
  ADD COLUMN es_cenabas boolean DEFAULT false NOT NULL;
