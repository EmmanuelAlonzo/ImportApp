
-- 1. Modernizando registros_importacion
ALTER TABLE registros_importacion 
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verified_by TEXT,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_sync TIMESTAMPTZ DEFAULT NOW();

-- 2. Modernizando usuarios_app para suspensión
ALTER TABLE usuarios_app 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 3. Nueva tabla de configuración para Drive Dinámico
CREATE TABLE IF NOT EXISTS app_config (
    id BIGINT PRIMARY KEY DEFAULT 1,
    spreadsheet_url TEXT,
    spreadsheet_id TEXT,
    enabled_sheets JSONB DEFAULT '[]'::jsonb,
    last_sync TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Asegurar que solo exista una fila de configuración
INSERT INTO app_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

