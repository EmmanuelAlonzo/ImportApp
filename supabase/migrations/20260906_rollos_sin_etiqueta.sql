-- Migración: Módulo de Rollos sin Etiqueta / Rezagos (Fase 1)
-- Archivo: supabase/migrations/20260906_rollos_sin_etiqueta.sql

-- 1. Crear tabla rollos_sin_etiqueta
CREATE TABLE IF NOT EXISTS rollos_sin_etiqueta (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sheet_name TEXT NOT NULL,
    codigo_temporal TEXT NOT NULL UNIQUE,
    peso_patio NUMERIC NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'conciliado', 'anulado')),
    matched_registro_id BIGINT NULL REFERENCES registros_importacion(id) ON DELETE SET NULL,
    matched_at TIMESTAMPTZ NULL,
    matched_by TEXT NULL
);

-- Índices para optimizar consultas de filtrado por calibre y estatus
CREATE INDEX IF NOT EXISTS idx_rollos_sin_etiqueta_sheet ON rollos_sin_etiqueta(sheet_name);
CREATE INDEX IF NOT EXISTS idx_rollos_sin_etiqueta_status ON rollos_sin_etiqueta(status);
CREATE INDEX IF NOT EXISTS idx_rollos_sin_etiqueta_matched ON rollos_sin_etiqueta(matched_registro_id);

-- 2. Agregar columna de trazabilidad en registros_importacion
ALTER TABLE IF EXISTS registros_importacion
ADD COLUMN IF NOT EXISTS codigo_temporal_origen TEXT NULL;

-- 3. Habilitar Seguridad a Nivel de Fila (RLS) y políticas de acceso
ALTER TABLE rollos_sin_etiqueta ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'rollos_sin_etiqueta' AND policyname = 'allow_all_rollos_sin_etiqueta'
    ) THEN
        CREATE POLICY "allow_all_rollos_sin_etiqueta" ON rollos_sin_etiqueta 
        FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 4. Conceder privilegios a los roles de Supabase
GRANT ALL ON TABLE rollos_sin_etiqueta TO anon, authenticated, service_role;

-- 5. Función RPC: generar_codigo_temporal_bobina
-- Genera de forma atómica y segura el código temporal (ej. B-55-01, B-65-01)
-- e inserta el nuevo rollo sin etiqueta en estado 'pendiente'.
CREATE OR REPLACE FUNCTION generar_codigo_temporal_bobina(
    p_sheet_name TEXT,
    p_operator_id TEXT,
    p_peso NUMERIC DEFAULT NULL
)
RETURNS rollos_sin_etiqueta
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_diam TEXT;
    v_prefix TEXT;
    v_num NUMERIC;
    v_next_val INT;
    v_next_code TEXT;
    v_record rollos_sin_etiqueta%ROWTYPE;
BEGIN
    IF p_sheet_name IS NULL OR TRIM(p_sheet_name) = '' THEN
        RAISE EXCEPTION 'El calibre (p_sheet_name) es requerido.';
    END IF;

    IF p_operator_id IS NULL OR TRIM(p_operator_id) = '' THEN
        RAISE EXCEPTION 'El identificador del operario (p_operator_id) es requerido.';
    END IF;

    -- Extraer el valor numérico del calibre (ej. de '5.50 mm' o '5.5 mm' -> 5.50)
    v_clean_diam := (regexp_match(p_sheet_name, '([0-9]+(?:\.[0-9]+)?)'))[1];

    IF v_clean_diam IS NOT NULL THEN
        v_num := v_clean_diam::NUMERIC;
        -- Para calibres estándar en mm (< 30 mm), escalar x10 (ej. 5.50/5.5 -> 55, 6.50 -> 65, 7.0 -> 70)
        IF v_num < 30 THEN
            v_prefix := 'B-' || (ROUND(v_num * 10))::TEXT || '-';
        ELSE
            v_prefix := 'B-' || (ROUND(v_num))::TEXT || '-';
        END IF;
    ELSE
        -- Fallback si no contiene dígitos: sanitizar caracteres alfanuméricos
        v_prefix := 'B-' || SUBSTRING(UPPER(REGEXP_REPLACE(p_sheet_name, '[^a-zA-Z0-9]', '', 'g')) FROM 1 FOR 10) || '-';
    END IF;

    -- Bloqueo transaccional advisory para serializar la generación del correlativo por prefijo
    PERFORM pg_advisory_xact_lock(hashtext('rollos_sin_etiqueta_' || v_prefix));

    -- Obtener el correlativo secuencial más alto para el prefijo correspondiente
    SELECT COALESCE(
        MAX(
            NULLIF(REGEXP_REPLACE(SUBSTRING(codigo_temporal FROM LENGTH(v_prefix) + 1), '[^0-9]', '', 'g'), '')::INTEGER
        ), 0
    ) + 1
    INTO v_next_val
    FROM rollos_sin_etiqueta
    WHERE codigo_temporal LIKE v_prefix || '%';

    -- Formatear con al menos 2 dígitos (ej. B-55-01, B-55-02, B-55-10)
    v_next_code := v_prefix || LPAD(v_next_val::TEXT, 2, '0');

    -- Insertar el registro con estado pendiente
    INSERT INTO rollos_sin_etiqueta (
        sheet_name,
        codigo_temporal,
        peso_patio,
        created_by,
        created_at,
        status
    ) VALUES (
        p_sheet_name,
        v_next_code,
        p_peso,
        p_operator_id,
        NOW(),
        'pendiente'
    )
    RETURNING * INTO v_record;

    RETURN v_record;
END;
$$;

GRANT EXECUTE ON FUNCTION generar_codigo_temporal_bobina TO anon, authenticated, service_role;
