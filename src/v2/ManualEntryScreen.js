import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView, ScrollView } from 'react-native';
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
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const dd = now.getDate().toString().padStart(2, '0');
        const prefix = `${yy}${mm}${dd}I`;

        const { data } = await supabase
            .from('registros_importacion')
            .select('lote')
            .eq('diametro', diam)
            .like('lote', `${prefix}%`)
            .order('lote', { ascending: false })
            .limit(1);

        let nextSeq = 1;
        if (data && data.length > 0) {
            const lastLote = data[0].lote;
            const lastSeq = lastLote.split('I')[1];
            nextSeq = parseInt(lastSeq) + 1;
        }

        setGeneratedBatch(`${prefix}${nextSeq.toString().padStart(3, '0')}`);
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

            const { error: dbError } = await supabase.from('registros_importacion').insert([record]);
            if (dbError) throw dbError;

            await fetch('https://pskcnkzgoaqesjiohyth.supabase.co/functions/v1/sync-manual-entry', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer sb_publishable_OZX0jnagvl8zfKdM42KlNg_5EsG0LTl` },
                body: JSON.stringify(record)
            });

            Alert.alert("Éxito", `Lote ${generatedBatch} inyectado.`);
            calculateNextLote(selectedDiam);

        } catch (err) {
            Alert.alert("Error", err.message);
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
