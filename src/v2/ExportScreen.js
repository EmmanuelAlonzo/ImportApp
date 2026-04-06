import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView, ScrollView } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export default function ExportScreen() {
    const [exporting, setExporting] = useState(false);
    const industrialRed = '#D32F2F';

    const handleExportCSV = async () => {
        setExporting(true);
        try {
            const { data, error } = await supabase
                .from('registros_importacion')
                .select('lote, diametro, sku, coil, colada, peso, is_verified, verified_by, verified_at')
                .order('diametro', { ascending: true });

            if (error) throw error;
            if (!data || data.length === 0) throw new Error("Sin datos");

            const headers = "LOTE,DIAMETRO,SKU,COIL,COLADA,PESO,VERIFICADO,AUDITOR,FECHA_AUDITORIA\n";
            const rows = data.map(r => 
                `${r.lote},${r.diametro},${r.sku},${r.coil || ''},${r.colada || ''},${r.peso},${r.is_verified ? 'SI' : 'NO'},${r.verified_by || ''},${r.verified_at || ''}`
            ).join("\n");

            const csvContent = headers + rows;
            const fileName = `Reporte_Produccion_${new Date().getTime()}.csv`;
            const fileUri = FileSystem.cacheDirectory + fileName;

            await FileSystem.writeAsStringAsync(fileUri, csvContent, { encoding: FileSystem.EncodingType.UTF8 });

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(fileUri);
            } else {
                Alert.alert("Éxito", "Archivo guardado en caché: " + fileName);
            }
        } catch (err) {
            Alert.alert("Error", err.message);
        } finally {
            setExporting(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>AUDITORÍA Y EXPORTACIÓN DE DATOS</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.infoCard}>
                    <Ionicons name="document-text-outline" size={50} color={industrialRed} />
                    <Text style={styles.infoTitle}>Módulo de Backup</Text>
                    <Text style={styles.infoSub}>Genera reportes de cumplimiento y avance de producción para auditorías externas en formato CSV/Excel.</Text>
                </View>

                <TouchableOpacity 
                    style={[styles.exportBtn, {backgroundColor: industrialRed}, exporting && {opacity: 0.7}]} 
                    onPress={handleExportCSV}
                    disabled={exporting}
                >
                    {exporting ? <ActivityIndicator color="white" /> : <Text style={styles.exportBtnText}>DESCARGAR REPORTE TOTAL</Text>}
                </TouchableOpacity>

                <View style={styles.warningBox}>
                    <Ionicons name="shield-checkmark" size={16} color="#444" style={{marginRight: 10}} />
                    <Text style={styles.warningText}>Este archivo cumple con los estándares de trazabilidad industrial.</Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 3, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
    content: { padding: 20 },
    infoCard: { backgroundColor: '#1E1E1E', padding: 40, borderRadius: 20, alignItems: 'center', marginBottom: 30, borderWidth: 1, borderColor: '#222' },
    infoTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold', marginTop: 15 },
    infoSub: { color: '#666', fontSize: 10, textAlign: 'center', marginTop: 12, lineHeight: 18, fontWeight: 'bold' },
    exportBtn: { padding: 18, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
    exportBtnText: { color: 'white', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 },
    warningBox: { flexDirection: 'row', marginTop: 30, backgroundColor: '#1E1E1E', padding: 15, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#222' },
    warningText: { color: '#444', fontSize: 8, flex: 1, fontWeight: 'bold', letterSpacing: 1 }
});
