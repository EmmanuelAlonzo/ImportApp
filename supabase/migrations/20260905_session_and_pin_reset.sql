-- Migración para control de sesión única y reseteo obligatorio de PIN
-- Archivo: supabase/migrations/20260905_session_and_pin_reset.sql

-- 1. Agregar columnas a usuarios_app si no existen
ALTER TABLE IF EXISTS usuarios_app 
ADD COLUMN IF NOT EXISTS session_token TEXT,
ADD COLUMN IF NOT EXISTS requires_pin_reset BOOLEAN DEFAULT FALSE;

-- 2. Función RPC para forzar sesión única e invalidar sesión previa liberando bobinas
CREATE OR REPLACE FUNCTION force_session_override(
    p_user_id TEXT,
    p_new_session_token TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Actualizar token de sesión para el usuario indicado
    UPDATE usuarios_app
    SET session_token = p_new_session_token
    WHERE id::text = p_user_id;

    -- Liberar bobinas que estuvieran reservadas por este usuario
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'release_operator_coils'
    ) THEN
        PERFORM release_operator_coils(p_user_id);
    ELSE
        UPDATE registros_importacion
        SET reserved_by = NULL,
            reserved_at = NULL
        WHERE is_verified = FALSE
          AND (reserved_by = p_user_id OR reserved_by ILIKE p_user_id);
    END IF;
END;
$$;
