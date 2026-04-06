import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView, ActivityIndicator, FlatList, ScrollView } from 'react-native';
import { supabase } from '../api/supabase';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function VerificationScreen() {
    const { user } = useAuth();
    const [sheets, setSheets] = useState([]);
    const [selectedSheet, setSelectedSheet] = useState(null);
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [verifying, setVerifying] = useState(null);

    const industrialRed = '#D32F2F';

    // 1. Cargar Diámetros Disponibles al Inicio
    useEffect(() => { fetchSheets(); }, []);

    // 2. Cada vez que cambie el Diámetro Seleccionado, Recargar Lotes
    useEffect(() => { 
        if (selectedSheet) fetchPendingRecords(); 
    }, [selectedSheet]);

    const fetchSheets = async () => {
        setLoading(true);
        try {
            const { data: settings } = await supabase.from('app_settings').select('active_sheets').eq('id', 1).single();
            if (settings?.active_sheets) {
                const parsed = Array.isArray(settings.active_sheets) ? settings.active_sheets : JSON.parse(settings.active_sheets);
                // Normalizar nombres de hojas visibles
                const visible = parsed.map(s => (typeof s === 'object' && s !== null) ? (s.visible !== false ? s.name : null) : s).filter(Boolean);
                setSheets(visible);
                if (visible.length > 0 && !selectedSheet) setSelectedSheet(visible[0]);
            }
        } catch (err) {
            console.log("Error sheets:", err.message);
        } finally {
            if (!selectedSheet) setLoading(false);
        }
    };

    const fetchPendingRecords = async () => {
        if (!selectedSheet) return;
        setLoading(true);
        try {
            // Normalización para búsqueda flexible (evitar fallos por espacios o mayúsculas)
            const searchQuery = selectedSheet.trim();
            
            const { data, error } = await supabase
                .from('registros_importacion')
                .select('*')
                .eq('is_verified', false)
                .ilike('sheet_name', searchQuery) // Corregido: La columna real es sheet_name
                .order('lote', { ascending: true })
                .limit(40);

            if (error) throw error;
            
            if (data && data.length === 0) {
                console.log(`Debug: No hay lotes pendientes para "${searchQuery}"`);
                // Intento fallback: Ver si los diámetros en la DB son diferentes
                const { data: dbSamples } = await supabase.from('registros_importacion').select('diametro').limit(5);
                console.log("Ejemplos de diámetros en registros_importacion:", dbSamples?.map(d => d.diametro));
            }
            
            setRecords(data || []);
        } catch (err) {
            console.log("Error fetch records:", err.message);
            Alert.alert("Error de Conexión", "No se pudo conectar con la tabla de registros.");
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (item) => {
        setVerifying(item.id);
        const now = new Date().toISOString();
        
        try {
            // 1. BLOQUEO ATÓMICO (SEGURIDAD TOTAL)
            // Solo actualizamos Supabase. El Webhook del servidor hará el resto.
            const { data, error: dbError } = await supabase
                .from('registros_importacion')
                .update({ 
                    is_verified: true,
                    verified_by: user.nombre,
                    verified_at: now
                })
                .eq('id', item.id)
                .eq('is_verified', false)
                .select();

            if (dbError) throw dbError;

            // Si no se actualizó, es porque otro lo tomó
            if (data?.length === 0) {
                Alert.alert("Lote Ocupado", "Otro operario ya ha verificado este lote.");
                setRecords(prev => prev.filter(r => r.id !== item.id));
                return;
            }

            // 2. RETIRO INSTANTÁNEO (ALTA VELOCIDAD)
            setRecords(prev => prev.filter(r => r.id !== item.id));

        } catch (e) {
            console.log("Error Verificación:", e);
            Alert.alert("Confirma tu conexión", "No se pudo registrar la toma por un problema de señal.");
        } finally {
            setVerifying(null);
        }
    };

    const renderItem = ({ item }) => (
        <View style={styles.recordCard}>
            <View style={styles.cardMain}>
                <View style={styles.loteHeader}>
                    <Text style={styles.loteLabel}>LOTE SECUENCIAL</Text>
                    <Text style={styles.loteText}>{item.lote}</Text>
                </View>
                
                <View style={styles.dataGrid}>
                    <View style={styles.dataCol}>
                        <Text style={styles.dataLabel}>COIL / BOBINA</Text>
                        <Text style={styles.dataValue}>{item.coil || 'S/N'}</Text>
                    </View>
                    <View style={styles.dataCol}>
                        <Text style={styles.dataLabel}>SAE / MAT.</Text>
                        <Text style={styles.dataValue}>{item.sae || 'EST.'}</Text>
                    </View>
                    <View style={styles.dataCol}>
                        <Text style={styles.dataLabel}>PESO (KG)</Text>
                        <Text style={styles.dataValue}>{item.peso || '0.00'}</Text>
                    </View>
                </View>
                <Text style={styles.skuText}>SKU: {item.sku || '---'}</Text>
            </View>

            <TouchableOpacity 
                style={[styles.btnVerify, {backgroundColor: industrialRed}]} 
                onPress={() => handleVerify(item)}
                disabled={verifying === item.id}
            >
                {verifying === item.id ? (
                    <ActivityIndicator color="white" />
                ) : (
                    <View style={styles.btnContent}>
                        <Ionicons name="barcode-outline" size={24} color="white" />
                        <Text style={styles.btnTextAction}>TOMAR</Text>
                    </View>
                )}
            </TouchableOpacity>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            {/* Header Industrial con Selector de Diámetros */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>VERIFICACIÓN PLANTA</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sheetSelector}>
                    {sheets.map(s => (
                        <TouchableOpacity 
                            key={s} 
                            onPress={() => setSelectedSheet(s)}
                            style={[styles.sheetBtn, selectedSheet === s && styles.sheetBtnActive]}
                        >
                            <Text style={[styles.sheetBtnText, selectedSheet === s && styles.sheetBtnTextActive]}>{s}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {loading && records.length === 0 ? (
                <View style={styles.loaderContainer}>
                    <ActivityIndicator size="large" color={industrialRed} />
                    <Text style={styles.loaderText}>CARGANDO PRODUCTOS...</Text>
                </View>
            ) : (
                <FlatList 
                    data={records}
                    renderItem={renderItem}
                    keyExtractor={item => item.id.toString()}
                    contentContainerStyle={{padding: 15, paddingBottom: 50}}
                    ListHeaderComponent={
                        <View style={styles.listHeader}>
                            <Ionicons name="layers-outline" size={12} color="#444" />
                            <Text style={styles.listHeaderText}>SIGUIENTES PENDIENTES ({selectedSheet})</Text>
                        </View>
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons name="checkmark-circle-outline" size={80} color="#1E1E1E" />
                            <Text style={styles.emptyText}>SIN PRODUCTOS PENDIENTES</Text>
                            <Text style={styles.emptySub}>{selectedSheet}: Todas las tomas completadas.</Text>
                            <TouchableOpacity style={styles.refreshBtn} onPress={fetchPendingRecords}>
                                <Text style={styles.refreshBtnText}>REFRESCAR LISTA</Text>
                            </TouchableOpacity>
                        </View>
                    }
                    onRefresh={fetchPendingRecords}
                    refreshing={loading}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { backgroundColor: '#000', borderBottomWidth: 2, borderBottomColor: '#222', paddingTop: 10 },
    headerTitle: { color: '#FFF', fontSize: 11, fontWeight: 'bold', letterSpacing: 3, textAlign: 'center', marginBottom: 15, marginTop: 10 },
    sheetSelector: { paddingHorizontal: 15, paddingBottom: 15 },
    sheetBtn: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, backgroundColor: '#1A1A1A', marginRight: 10, borderWidth: 1, borderColor: '#333' },
    sheetBtnActive: { backgroundColor: '#D32F2F', borderColor: '#D32F2F' },
    sheetBtnText: { color: '#666', fontSize: 11, fontWeight: 'bold' },
    sheetBtnTextActive: { color: '#FFF' },

    loaderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loaderText: { color: '#444', fontSize: 9, fontWeight: 'bold', marginTop: 15, letterSpacing: 1 },

    listHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15, marginLeft: 5 },
    listHeaderText: { color: '#444', fontSize: 10, fontWeight: 'bold', marginLeft: 8, letterSpacing: 1 },

    recordCard: { backgroundColor: '#1E1E1E', borderRadius: 15, marginBottom: 15, overflow: 'hidden', borderWidth: 1, borderColor: '#222' },
    cardMain: { padding: 20 },
    loteHeader: { borderBottomWidth: 1, borderBottomColor: '#2A2A2A', paddingBottom: 10, marginBottom: 15 },
    loteLabel: { color: '#D32F2F', fontSize: 8, fontWeight: '900', letterSpacing: 2 },
    loteText: { color: '#FFF', fontSize: 28, fontWeight: 'bold' },

    dataGrid: { flexDirection: 'row', justifyContent: 'space-between' },
    dataCol: { flex: 1 },
    dataLabel: { color: '#444', fontSize: 8, fontWeight: 'bold', marginBottom: 3 },
    dataValue: { color: '#AAA', fontSize: 13, fontWeight: 'bold' },
    skuText: { color: '#333', fontSize: 10, marginTop: 15, fontWeight: 'bold' },

    btnVerify: { paddingVertical: 18, alignItems: 'center' },
    btnContent: { flexDirection: 'row', alignItems: 'center' },
    btnTextAction: { color: '#FFF', fontWeight: '900', fontSize: 14, marginLeft: 10, letterSpacing: 2 },

    emptyContainer: { padding: 50, alignItems: 'center', marginTop: 30 },
    emptyText: { color: '#444', fontSize: 14, fontWeight: 'bold', marginTop: 20 },
    emptySub: { color: '#222', fontSize: 10, marginTop: 5, textAlign: 'center' },
    refreshBtn: { marginTop: 30, paddingVertical: 12, paddingHorizontal: 25, borderRadius: 25, borderWidth: 1, borderColor: '#D32F2F' },
    refreshBtnText: { color: '#D32F2F', fontSize: 10, fontWeight: 'bold' }
});
