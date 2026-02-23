import { API_URL } from './config';

async function callScript(action, payload = {}) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action, ...payload }),
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const text = await response.text();
        try {
            const result = JSON.parse(text);
            if (!result.success) {
                throw new Error(result.error || "Error en el servidor");
            }
            return result.data;
        } catch (e) {
            console.error("JSON Parse Error:", text);
            throw new Error(text.includes('html') ? 'Asegúrate de haber implementado el Script como Aplicación Web (con acceso para Todos)' : 'Respuesta inválida del servidor');
        }
    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}

export const sheetsAPI = {
    getSheets: () => callScript('getSheets'),
    getInitialData: () => callScript('getInitialData'),
    getSheetData: (sheetName) => callScript('getSheetData', { sheetName }),
    updateRow: (sheetName, rowIndex, isVerified, numberValue) => callScript('updateRow', { sheetName, rowIndex, isVerified, numberValue }),
};
