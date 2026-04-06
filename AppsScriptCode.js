/**
 * Se ejecuta automáticamente al editar cualquier celda de la hoja.
 * 
 * Funcionalidad:
 * 1. Inserta fecha/hora estática en la columna I cuando se marca la casilla en la columna H.
 * 2. Borra la fecha/hora en la columna I cuando se desmarca la casilla en la columna H.
 * 
 * El script funciona en CUALQUIER hoja del libro.
 */
function onEdit(e) {
    // Asegúrate de que las constantes coincidan con las columnas de tu libro
    const COLUMNA_VERIFICACION = 8; // Columna H (VERIFICACION)
    const COLUMNA_FECHA = 9;        // Columna I (FECHA)

    const rangoEditado = e.range;
    const hoja = rangoEditado.getSheet();

    // 1. Verifica si la edición ocurrió en la columna de verificación (H)
    if (rangoEditado.getColumn() !== COLUMNA_VERIFICACION) {
        return;
    }

    const celdaFecha = hoja.getRange(rangoEditado.getRow(), COLUMNA_FECHA);
    const nuevoValor = e.value;

    // --- LÓGICA DE MARCAR LA CASILLA (Poner la fecha/hora) ---
    // Se ejecuta si:
    // a) El nuevo valor es "TRUE" (casilla marcada).
    // b) La celda de la fecha está vacía (para no sobrescribir una fecha existente).
    if (nuevoValor === "TRUE" && celdaFecha.isBlank()) {
        // Inserta la fecha y hora como una fórmula temporal (=NOW())
        celdaFecha.setFormula('=NOW()');

        // Convierte la fórmula a su valor estático inmediatamente ("congela" la hora)
        celdaFecha.setValue(celdaFecha.getValue());

        // Aplica el formato de fecha y hora
        celdaFecha.setNumberFormat('dd/MM/yyyy HH:mm:ss');
    }

    // --- LÓGICA DE DESMARCAR LA CASILLA (Borrar la fecha/hora) ---
    // Se ejecuta si:
    // a) El nuevo valor es "FALSE" (casilla desmarcada).
    // b) La celda de la fecha no está vacía.
    else if (nuevoValor === "FALSE" && !celdaFecha.isBlank()) {
        celdaFecha.clearContent();
    }
}

// ==========================================
// CÓDIGO AÑADIDO PARA LA APP MÓVIL (API)
// ==========================================

function doPost(e) {
    try {
        const params = JSON.parse(e.postData.contents);
        const action = params.action;

        let result = {};

        if (action === 'getSheets') {
            result = handleGetSheets();
        } else if (action === 'getInitialData') {
            result = handleGetInitialData();
        } else if (action === 'getSheetData') {
            result = handleGetSheetData(params.sheetName);
        } else if (action === 'updateRow') {
            result = handleUpdateRow(params.sheetName, params.rowIndex, params.isVerified, params.numberValue);
        } else {
            throw new Error('Acción no reconocida');
        }

        return ContentService.createTextOutput(JSON.stringify({
            success: true,
            data: result
        })).setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        return ContentService.createTextOutput(JSON.stringify({
            success: false,
            error: error.message
        })).setMimeType(ContentService.MimeType.JSON);
    }
}

function handleGetSheets() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();
    return sheets.map(sheet => sheet.getName());
}

function handleGetInitialData() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();

    const result = {
        sheetNames: [],
        sheetsData: {}
    };

    sheets.forEach(sheet => {
        const sheetName = sheet.getName();
        result.sheetNames.push(sheetName);

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();

        if (lastRow < 2) {
            result.sheetsData[sheetName] = [];
            return; // continué con la app
        }

        // Leemos desde la Columna A (1) hasta la H (8), o hasta donde haya datos reales si hay menos columnas
        const colsToFetch = Math.max(lastCol, 8);
        const range = sheet.getRange(2, 1, lastRow - 1, colsToFetch);
        const values = range.getValues();

        const data = [];
        for (let i = 0; i < values.length; i++) {
            const valA = values[i][0] != null ? String(values[i][0]).trim() : ""; // Columna 1 (A)
            const valF = values[i][5] != null ? String(values[i][5]).trim() : ""; // Columna 6 (F)
            const valH = values[i][7]; // Columna 8 (H)

            if (valF !== "") {
                data.push({
                    rowIndex: i + 2, // Fila real correspondiente en la hoja
                    valueA: valA,
                    valueF: valF,
                    isVerified: valH === true || String(valH).toUpperCase() === "TRUE" || String(valH).toUpperCase() === "VERDADERO"
                });
            }
        }

        result.sheetsData[sheetName] = data;
    });

    return result;
}

function handleGetSheetData(sheetName) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) throw new Error('Hoja no encontrada');

    // Leemos desde la fila 2 hasta la última con datos (asumiendo fila 1 como encabezados)
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) return [];

    // Leemos desde la Columna A (1) hasta la H (8) o la máxima disponible
    const colsToFetch = Math.max(lastCol, 8);
    const range = sheet.getRange(2, 1, lastRow - 1, colsToFetch);
    const values = range.getValues();

    const data = [];
    for (let i = 0; i < values.length; i++) {
        const valA = values[i][0] != null ? String(values[i][0]).trim() : ""; // Columna 1 (A)
        const valF = values[i][5] != null ? String(values[i][5]).trim() : ""; // Columna 6 (F)
        const valH = values[i][7]; // Columna 8 (H)

        if (valF !== "") {
            data.push({
                rowIndex: i + 2, // Fila real correspondiente en la hoja
                valueA: valA,
                valueF: valF,
                isVerified: valH === true || String(valH).toUpperCase() === "TRUE" || String(valH).toUpperCase() === "VERDADERO"
            });
        }
    }

    return data;
}

function handleUpdateRow(sheetName, rowIndex, isVerified, numberValue) {
    // 1. Obtener un cerrojo (lock) del script para evitar concurrencia (Condiciones de Carrera)
    const lock = LockService.getScriptLock();
    try {
        lock.waitLock(10000); // Esperar hasta 10 segundos por el cerrojo
    } catch (e) {
        throw new Error('Servidor de Google ocupado procesando otro registro. Intenta de nuevo en unos segundos.');
    }

    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName(sheetName);

        if (!sheet) throw new Error('Hoja no encontrada');

        let targetRowIndex = rowIndex;

        // 2. LECTURA EN LOTE (Optimización A): Leemos de la columna A (1) a la J (10) en un solo llamado
        // Esto lee Lote (A), Colada (F), Estado (H), Fecha (I), y Cajas (J) rapidísimo.
        let targetRowData = sheet.getRange(targetRowIndex, 1, 1, 10).getValues()[0];
        let currentVerifiedValue = targetRowData[7]; // Columna H (índice 7)
        const isCurrentlyVerified = currentVerifiedValue === true || String(currentVerifiedValue).toUpperCase() === "TRUE" || String(currentVerifiedValue).toUpperCase() === "VERDADERO";

        if (isVerified === true && isCurrentlyVerified) {
            // ¡Alguien más nos ganó el clic a la misma fila! 
            // Vamos a re-asignar este envío automáticamente a la SIGUIENTE fila disponible de la misma Colada.
            const targetValueF = targetRowData[5]; // Columna F (índice 5)
            const lastRow = sheet.getLastRow();

            // LECTURA EN LOTE MASIVA: Leemos toda la hoja de una vez (Columnas A a J)
            const range = sheet.getRange(2, 1, lastRow - 1, 10);
            const values = range.getValues();

            let foundAlternate = false;
            for (let i = 0; i < values.length; i++) {
                const fVal = values[i][5]; // Columna F
                const hVal = values[i][7]; // Columna H
                const hVerif = hVal === true || String(hVal).toUpperCase() === "TRUE" || String(hVal).toUpperCase() === "VERDADERO";

                // Buscamos coincidencia exacta de la Colada que NO esté ya verificada
                if (String(fVal).trim() === String(targetValueF).trim() && !hVerif) {
                    targetRowIndex = i + 2;
                    targetRowData = values[i]; // Guardamos en memoria los datos de la nueva fila encontrada
                    foundAlternate = true;
                    break;
                }
            }

            if (!foundAlternate) {
                // Si la auto-reasignación fracasa porque se acabaron las filas de esta colada:
                throw new Error('Todos los registros con esta Colada ya fueron procesados simultáneamente por otros usuarios.');
            }
        }

        // MÁXIMA VELOCIDAD: Procesar la escritura en la fila destino 
        const hasVerification = isVerified !== undefined;
        const hasNumber = numberValue !== undefined && numberValue !== null && numberValue !== "";

        // Preparamos los valores a sobreescribir (H, I, J) leyendo su estado actual de la memoria (targetRowData)
        let newH = targetRowData[7]; // H
        let newI = targetRowData[8]; // I
        let newJ = targetRowData[9]; // J
        let formatI = false;

        if (hasVerification) {
            newH = isVerified;
            if (isVerified === true && (!newI || newI === "")) {
                newI = new Date();
                formatI = true;
            } else if (isVerified === false && newI && newI !== "") {
                newI = "";
            }
        }

        if (hasNumber) {
            newJ = numberValue;
        }

        // ESCRITURA CON API AVANZADA (MÁXIMA VELOCIDAD)
        // Usamos Sheets.Spreadsheets.Values.batchUpdate para escribir H, I y J de golpe con menor latencia

        // Formateo de las celdas y la hoja basado en Notación A1 (ej: 'NombredelaHoja'!H15:J15)
        const rangeA1 = `'${sheetName}'!H${targetRowIndex}:J${targetRowIndex}`;

        // Convertimos la fecha (newI) a string estilo Excel si es un objeto Date
        let dateValue = newI;
        if (dateValue instanceof Date) {
            // El formato que Sheets espera para USER_ENTERED y entender fecha/hora
            const yyyy = dateValue.getFullYear();
            const mm = String(dateValue.getMonth() + 1).padStart(2, '0');
            const dd = String(dateValue.getDate()).padStart(2, '0');
            const hh = String(dateValue.getHours()).padStart(2, '0');
            const min = String(dateValue.getMinutes()).padStart(2, '0');
            const ss = String(dateValue.getSeconds()).padStart(2, '0');
            dateValue = `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
        }

        const valueRange = {
            range: rangeA1,
            values: [[newH, dateValue, newJ]]
        };

        const batchUpdateRequest = {
            valueInputOption: 'USER_ENTERED',
            data: [valueRange]
        };

        const spreadsheetId = ss.getId();

        // Ejecución de la API Avanzada de Google
        Sheets.Spreadsheets.Values.batchUpdate(batchUpdateRequest, spreadsheetId);

        // Extraer el "Lote" (valueA) exacto desde nuestra lectura en memoria masiva (Nula latencia adicional)
        const finalValueA = targetRowData[0]; // Columna A (índice 0)

        return {
            updated: true,
            rowIndex: targetRowIndex,
            wasReassigned: targetRowIndex !== rowIndex,
            valueA: String(finalValueA).trim()
        };

    } finally {
        // 3. Liberar siempre el cerrojo al terminar la transaccion, pase lo que pase.
        lock.releaseLock();
    }
}

function doGet(e) {
    // Manejador básico de GET por si se abre la URL en el navegador
    return ContentService.createTextOutput("API de la App de Importaciones funcionando correctamente.");
}

// ==== MIGRACIÓN A SUPABASE ====
// ESTA FUNCION SE DEBE CORRER UNA SOLA VEZ DESDE EL EDITOR DE GOOGLE APPS SCRIPT
function migrarTodoASupabase() {
    var supabaseUrl = 'https://vayoscssobmzijnsqnem.supabase.co/rest/v1/registros_importacion';
    var supabaseKey = 'sb_publishable_FKDIA1zcURL84h-JhYipkQ_Jv7jFrH7'; // Clave publica

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var batchData = [];

    for (var i = 0; i < sheets.length; i++) {
        var sheet = sheets[i];
        var sheetName = sheet.getName();
        var lastRow = sheet.getLastRow();

        // Ignorar la primera hoja de control "UNI DESCARGADAS"
        if (sheetName === "UNI DESCARGADAS" || lastRow < 2) continue;

        // Obtiene toda la hoja (A hasta J)
        var range = sheet.getRange(2, 1, lastRow - 1, 10);
        var values = range.getValues();

        for (var j = 0; j < values.length; j++) {
            var lote = values[j][0] ? String(values[j][0]).trim() : ""; // A: Lote
            var col_b = values[j][1] ? String(values[j][1]).trim() : ""; // B
            var col_c = values[j][2] ? String(values[j][2]).trim() : ""; // C
            var col_d = values[j][3] ? String(values[j][3]).trim() : ""; // D
            var col_e = values[j][4] ? String(values[j][4]).trim() : ""; // E
            var colada = values[j][5] ? String(values[j][5]).trim() : ""; // F: Colada
            var col_g = values[j][6] ? String(values[j][6]).trim() : ""; // G
            var isVerified = values[j][7]; // H: Verificado
            var ver_at = values[j][8]; // I: Fecha
            var cajas = values[j][9]; // J: Cajas

            if (colada !== "") {
                var isV = false;
                if (isVerified === true || String(isVerified).toUpperCase() === "TRUE" || String(isVerified).toUpperCase() === "VERDADERO") {
                    isV = true;
                }

                var payload = {
                    "diametro": sheetName,
                    "lote": lote,
                    "col_b": col_b,
                    "col_c": col_c,
                    "col_d": col_d,
                    "col_e": col_e,
                    "colada": colada,
                    "col_g": col_g,
                    "is_verified": isV,
                    "verified_at": (isV && ver_at) ? new Date(ver_at).toISOString() : null,
                    "coils_cajas": (cajas !== "" && !isNaN(cajas)) ? Number(cajas) : null
                };
                batchData.push(payload);
            }
        }
    }

    // Enviar a Supabase en paquetes de 500 para no sobrepasar limites de payload
    var batchSize = 500;
    for (var i = 0; i < batchData.length; i += batchSize) {
        var chunck = batchData.slice(i, i + batchSize);

        var options = {
            'method': 'post',
            'contentType': 'application/json',
            'headers': {
                'apikey': supabaseKey,
                'Authorization': 'Bearer ' + supabaseKey,
                'Prefer': 'return=minimal' // Optimiza la respuesta
            },
            'payload': JSON.stringify(chunck)
        };

        try {
            UrlFetchApp.fetch(supabaseUrl, options);
            Logger.log("Chunck " + i + " a " + (i + chunck.length) + " enviado OK.");
        } catch (e) {
            Logger.log("Error en Chunck " + i + ": " + e.message);
        }
    }

    Logger.log("Migración finalizada. Total registros insertados: " + batchData.length);
}
