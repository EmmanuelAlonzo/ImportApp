-- Agregar columna sheet_name a registros_importacion
ALTER TABLE registros_importacion ADD COLUMN IF NOT EXISTS sheet_name TEXT DEFAULT 'Hoja1';

-- Crear tabla app_settings si no existe
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar que todas las columnas existan (por si la tabla ya existía)
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_spreadsheet_id TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_sheet_name TEXT DEFAULT 'Hoja1';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS active_sheets JSONB DEFAULT '[]';
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Insertar fila inicial si no existe
INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Habilitar RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'app_settings' AND policyname = 'allow_all_settings'
    ) THEN
        CREATE POLICY "allow_all_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Función RPC para obtener las hojas únicas de la base de datos
CREATE OR REPLACE FUNCTION get_unique_sheets()
RETURNS TABLE (name TEXT) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY 
  SELECT DISTINCT sheet_name 
  FROM registros_importacion 
  ORDER BY sheet_name;
END;
$$;
