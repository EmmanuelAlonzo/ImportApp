import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView, ScrollView, Vibration } from 'react-native';
import { supabase } from '../api/supabase';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function ManualEntryScreen() {
    const { user } = useAuth();
    const [diametros, setDiametros] = useState([]);
    const [selectedDiam, setSelectedDiam] = useState('');
    const [generatedBatch, setGeneratedBatch] = useState('YYYYMMDDIXXX');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const industrialRed = '#D32F2F';

    useEffect(() => { fetchDiametros(); }, []);

    const fetchDiametros = async () => {
        setLoading(true);
        const { data } = await supabase.rpc('get_unique_sheets');
        if (data) {
            const list = data.map(d => d.name);
            setDiametros(list);
            if (list.length > 0) {
                setSelectedDiam(list[0]);
                calculateNextLote(list[0]);
            }
        }
        setLoading(false);
    };

    const calculateNextLote = async (diam) => {
        try {
            // Buscamos el lote más reciente insertado/sincronizado para esta HOJA (que representa el diámetro)
            const { data } = await supabase
                .from('registros_importacion')
                .select('lote')
                .eq('sheet_name', diam) // CRÍTICO: El nombre de la hoja garantiza que están en el mismo grupo
                .order('id', { ascending: false }) // 'id' garantiza el registro más nuevo absoluto
                .limit(1);

            if (data && data.length > 0 && data[0].lote) {
                const lastLote = data[0].lote;
                
                // Expresión regular pura para atrapar secuencias numéricas sin importar prefijos
                const match = lastLote.match(/(\d+)$/);
                if (match) {
                    const numStr = match[1];
                    const prefix = lastLote.slice(0, -numStr.length);
                    // Incremento respetando los "ceros" a la izquierda originales
                    const nextNum = (parseInt(numStr, 10) + 1).toString().padStart(numStr.length, '0');
                    setGeneratedBatch(prefix + nextNum);
                    return;
                }
            }

            // Fallback Enterprise (Solo si jamás ha entrado material en Drive para esta hoja)
            const now = new Date();
            const yy = now.getFullYear().toString().slice(-2);
            const mm = (now.getMonth() + 1).toString().padStart(2, '0');
            const dd = now.getDate().toString().padStart(2, '0');
            setGeneratedBatch(`${yy}${mm}${dd}I001`);
        } catch (e) {
            console.log("Fallo algoritmo de secuencia:", e);
        }
    };

    const handleSave = async () => {
        if (!selectedDiam) return;
        setSaving(true);
        try {
            const now = new Date().toISOString();
            const record = {
                lote: generatedBatch,
                diametro: selectedDiam,
                is_verified: true,
                verified_at: now,
                verified_by: user.nombre,
                updated_at: now
            };

            // 1. Validar e insertar localmente (Rápido)
            const { error: dbError } = await supabase.from('registros_importacion').insert([record]);
            
            if (dbError) {
                // LÓGICA EMPRESARIAL: Prevención de Colisiones Multi-operario
                if (dbError.code === '23505' || dbError.message.includes('duplicate')) {
                    Alert.alert("Colisión Evitada", "Otro compañero sincronizó este lote simultáneamente. Se le asignará uno nuevo automáticamente.");
                    await calculateNextLote(selectedDiam);
                    return; // Frenar ejecución
                }
                throw dbError; // Otro error
            }

            // 2. Feedback Físico Industrial
            Vibration.vibrate(100);

            // 3. Delegación de Flujo Drive (Fire-and-Forget Cero Latencia)
            // Lógica asíncrona: El cliente guarda al instante y el servidor se pelea con Google sin congelar la app.
            supabase.functions.invoke('sync-manual-entry', {
                body: record
            }).catch(e => console.log('Edge Function Sync Fallido:', e.message));

            Alert.alert("Éxito", `Lote ${generatedBatch} asegurado.`);
            calculateNextLote(selectedDiam);

        } catch (err) {
            Alert.alert("Fallo de Transacción", err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>REGISTRO DE PRODUCCIÓN ACTUAL</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.selectionCard}>
                    <Text style={styles.label}>SELECCIONAR DIÁMETRO OPERATIVO:</Text>
                    <View style={styles.chipsRow}>
                        {diametros.map(d => (
                            <TouchableOpacity 
                                key={d} 
                                style={[styles.chip, selectedDiam === d && {backgroundColor: industrialRed, borderColor: industrialRed}]}
                                onPress={() => { setSelectedDiam(d); calculateNextLote(d); }}
                            >
                                <Text style={[styles.chipText, selectedDiam === d && {color: '#FFF'}]}>{d}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>

                <View style={styles.loteCard}>
                    <Text style={styles.loteLabel}>IDENTIFICADOR DE LOTE CORRELATIVO:</Text>
                    <Text style={styles.loteValue}>{generatedBatch}</Text>
                </View>

                <TouchableOpacity 
                    style={[styles.btnAction, {backgroundColor: industrialRed}, saving && {opacity: 0.7}]} 
                    onPress={handleSave}
                    disabled={saving}
                >
                    {saving ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>GUARDAR E INYECTAR PRODUCCIÓN</Text>}
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 3, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
    content: { padding: 20 },
    selectionCard: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 15, marginBottom: 20 },
    label: { color: '#444', fontSize: 9, fontWeight: 'bold', marginBottom: 20 },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap' },
    chip: { backgroundColor: '#000', paddingVertical: 12, paddingHorizontal: 15, borderRadius: 8, marginRight: 10, marginBottom: 10, borderWidth: 1, borderColor: '#333', minWidth: 60, alignItems: 'center' },
    chipText: { color: '#444', fontWeight: 'bold', fontSize: 11 },
    loteCard: { backgroundColor: '#1E1E1E', paddingVertical: 50, borderRadius: 20, alignItems: 'center', marginBottom: 30, borderWidth: 1, borderColor: '#333' },
    loteLabel: { color: '#444', fontSize: 8, fontWeight: 'bold', marginBottom: 15 },
    loteValue: { color: '#FFF', fontSize: 28, fontWeight: 'bold', letterSpacing: 3 },
    btnAction: { padding: 20, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    btnText: { color: 'white', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 }
});
