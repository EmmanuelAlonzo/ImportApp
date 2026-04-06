import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView, StatusBar } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export default function ExcelExportScreen() {
    const [exporting, setExporting] = useState(false);

    const handleExport = async () => {
        setExporting(true);
        try {
            const { data } = await supabase.from('registros_importacion').select('*').eq('is_verified', true).order('verified_at', { ascending: false });
            if (!data || data.length === 0) { Alert.alert("Aviso", "No hay registros verified."); setExporting(false); return; }
            const wsData = data.map(r => ({ "Lote": r.lote, "Diámetro": r.diametro, "Peso": r.peso || 0, "Responsable": r.verified_by, "Fecha": new Date(r.verified_at).toLocaleString() }));
            const ws = XLSX.utils.json_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Inventario");
            const wbout = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
            const fileUri = FileSystem.cacheDirectory + `REPORTE_MP_${new Date().toISOString().split('T')[1]}.xlsx`;
            await FileSystem.writeAsStringAsync(fileUri, wbout, { encoding: FileSystem.EncodingType.Base64 });
            await Sharing.shareAsync(fileUri);
        } catch (err) { Alert.alert("Error", err.message); } finally { setExporting(false); }
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" />
            <View style={styles.header}><Text style={styles.headerTitle}>CONTROL DE INVENTARIO</Text></View>
            <View style={styles.content}>
                <View style={styles.iconBox}><Ionicons name="stats-chart-outline" size={70} color="#D32F2F" /></View>
                <Text style={styles.title}>REPORTE GERENCIAL</Text>
                <Text style={styles.sub}>Genera un archivo Excel compatible con dispositivos móviles del inventario verificado en planta.</Text>
                <TouchableOpacity style={[styles.btn, exporting && {opacity: 0.6}]} onPress={handleExport} disabled={exporting}>
                    {exporting ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>EXPORTAR A EXCEL (.XLSX)</Text>}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 2, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    iconBox: { width: 130, height: 130, borderRadius: 65, backgroundColor: '#1E1E1E', justifyContent: 'center', alignItems: 'center', marginBottom: 30, borderWidth: 2, borderColor: '#333' },
    title: { color: 'white', fontSize: 22, fontWeight: 'bold', marginBottom: 15, letterSpacing: 1 },
    sub: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 22, marginBottom: 45 },
    btn: { backgroundColor: '#2E7D32', width: '100%', height: 65, borderRadius: 15, justifyContent: 'center', alignItems: 'center', elevation: 5 },
    btnText: { color: 'white', fontWeight: 'bold', fontSize: 14 }
});
