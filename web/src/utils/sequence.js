/**
 * Calculates the next correlative batch number (lote) based on the last batch number.
 * Increments the final digits while keeping the prefix and padding zeros.
 * Falls back to a date-based sequence if no previous batch is provided.
 * 
 * @param {string} lastLote - The last batch number recorded (e.g. "260830I001").
 * @returns {string} The next batch number.
 */
export const calculateNextLote = (lastLote) => {
    if (lastLote) {
        // Expresión regular pura para atrapar secuencias numéricas sin importar prefijos
        const match = lastLote.match(/(\d+)$/);
        if (match) {
            const numStr = match[1];
            const prefix = lastLote.slice(0, -numStr.length);
            // Incremento respetando los "ceros" a la izquierda originales
            const nextNum = (parseInt(numStr, 10) + 1).toString().padStart(numStr.length, '0');
            return prefix + nextNum;
        }
    }

    // Fallback si no hay secuencia numérica previa
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    return `${yy}${mm}${dd}I001`;
};
