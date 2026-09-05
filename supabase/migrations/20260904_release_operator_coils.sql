-- Actualización de la función release_operator_coils para soportar coincidencia por ID y Nombre
CREATE OR REPLACE FUNCTION release_operator_coils(
  p_operator_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_operator_id IS NOT NULL AND TRIM(p_operator_id) <> '' THEN
    UPDATE registros_importacion
    SET reserved_by = NULL,
        reserved_at = NULL
    WHERE is_verified = FALSE
      AND (
        reserved_by = p_operator_id 
        OR reserved_by ILIKE p_operator_id
      );
  END IF;
END;
$$;
