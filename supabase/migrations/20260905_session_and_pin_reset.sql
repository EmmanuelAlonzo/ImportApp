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

-- 3. Agregar columna para trazabilidad de modo de verificación
ALTER TABLE IF EXISTS registros_importacion
ADD COLUMN IF NOT EXISTS verification_mode TEXT;

-- 4. Columna para huella persistente de dispositivo en usuarios_app
ALTER TABLE IF EXISTS usuarios_app 
ADD COLUMN IF NOT EXISTS current_device_id TEXT;

-- 5. RPC Atómica para reclamar exactamente 1 bobina por operario con FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_next_coil_atomic(
    p_operator_id TEXT,
    p_sheet_name TEXT
)
RETURNS SETOF registros_importacion
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_coil_id BIGINT;
BEGIN
    -- 1. Si el operario ya tiene una bobina asignada no verificada en este calibre, devolver esa misma
    SELECT id INTO v_coil_id
    FROM registros_importacion
    WHERE sheet_name = p_sheet_name
      AND is_verified = FALSE
      AND (reserved_by = p_operator_id OR reserved_by = p_operator_id::text)
    ORDER BY reserved_at DESC
    LIMIT 1;

    IF v_coil_id IS NOT NULL THEN
        RETURN QUERY
        SELECT * FROM registros_importacion
        WHERE id = v_coil_id;
        RETURN;
    END IF;

    -- 2. Asegurar que reservas previas en otras hojas o sesiones queden limpias
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'release_operator_coils'
    ) THEN
        PERFORM release_operator_coils(p_operator_id);
    END IF;

    -- 3. Bloquear atómicamente la primera bobina disponible sin colisiones
    SELECT id INTO v_coil_id
    FROM registros_importacion
    WHERE sheet_name = p_sheet_name
      AND is_verified = FALSE
      AND reserved_by IS NULL
    ORDER BY lote ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    -- 4. Apartar la bobina encontrada
    IF v_coil_id IS NOT NULL THEN
        UPDATE registros_importacion
        SET reserved_by = p_operator_id,
            reserved_at = NOW()
        WHERE id = v_coil_id;

        RETURN QUERY
        SELECT * FROM registros_importacion
        WHERE id = v_coil_id;
    END IF;
END;
$$;


