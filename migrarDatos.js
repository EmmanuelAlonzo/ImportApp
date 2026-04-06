const { createClient } = require('@supabase/supabase-js');

const supabase = createClient('https://vayoscssobmzijnsqnem.supabase.co', 'sb_publishable_FKDIA1zcURL84h-JhYipkQ_Jv7jFrH7');
const API_URL = "https://script.google.com/macros/s/AKfycbyHOuM_HmKngKBSW8IWsVIU2j_AJ_K-61fXafBAJxIQHyyevQ_lSKGeCBnbdzKrs11qWQ/exec";

async function iniciarMigracion() {
    console.log("Iniciando descarga desde Google Sheets...");
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'getInitialData' }),
        });
        
        const result = await response.json();
        
        if (!result.success) {
            console.error("Error del script GAS:", result.error);
            return;
        }
        
        const hojasData = result.data;
        let totalHojas = Object.keys(hojasData).length;
        console.log(`Descargado con éxito. Encontradas ${totalHojas} hojas.`);
        
        let bulkInsertArray = [];
        
        for (const [nombreHoja, filas] of Object.entries(hojasData)) {
            console.log(`Procesando hoja: ${nombreHoja} (${filas.length} filas)`);
            
            for (const fila of filas) {
                // Parse the row data from the structure in GAS
                // Usually it was: { rowIndex, valueA, valueF, isVerified }
                
                bulkInsertArray.push({
                    diametro: nombreHoja,
                    lote: fila.valueA,
                    colada: fila.valueF,
                    is_verified: fila.isVerified === true || String(fila.isVerified).toLowerCase() === 'true',
                    // Si ya estaba verificado originalmente en sheets y hay un valor
                    verified_at: (fila.isVerified) ? new Date().toISOString() : null,
                    coils_cajas: null // No lo traíamos en getInitialData
                });
            }
        }
        
        console.log(`Total de registros listos para insertar en Supabase: ${bulkInsertArray.length}`);
        
        if (bulkInsertArray.length === 0) {
            console.log("No hay datos para migrar.");
            return;
        }

        // Insertar en lotes de 1000 para no saturar
        const batchSize = 1000;
        for (let i = 0; i < bulkInsertArray.length; i += batchSize) {
            const batch = bulkInsertArray.slice(i, i + batchSize);
            const { data, error } = await supabase
                .from('registros_importacion')
                .insert(batch);
                
            if (error) {
                console.error(`Error insertando lote ${i} - ${i + batchSize}:`, error);
                // Si falla por ID repetido u otra cosa
            } else {
                console.log(`Lote ${i} a ${i + batch.length} insertado con éxito.`);
            }
        }

        console.log("¡Migración completada exitosamente!");

    } catch (error) {
        console.error("Hubo un error fatal durante la migración:", error);
    }
}

iniciarMigracion();
