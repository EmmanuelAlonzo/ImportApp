import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, SafeAreaView, StatusBar } from 'react-native';
import * as Print from 'expo-print';
import { shareAsync } from 'expo-sharing';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';

export default function BulkGenerationScreen() {
    const [diametros, setDiametros] = useState([]);
    const [selectedDiam, setSelectedDiam] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('');

    useEffect(() => { fetchDiametros(); }, []);

    const fetchDiametros = async () => {
        const { data } = await supabase.rpc('get_unique_sheets');
        if (data) setDiametros(data.map(d => d.name));
    };

    const handleGenerate = async () => {
        if (!selectedDiam) {
            Alert.alert("Error", "Selecciona un Diámetro primero.");
            return;
        }

        setLoading(true);
        setStatus('Consultando registros validados...');

        try {
            // Obtener solo registros VERIFICADOS para el diámetro seleccionado
            const { data: rows, error } = await supabase
                .from('registros_importacion')
                .select('*')
                .eq('sheet_name', selectedDiam)
                .eq('is_verified', true)
                .order('row_number', { ascending: true });

            if (error) throw error;
            if (!rows || rows.length === 0) {
                throw new Error("No hay registros validados para este diámetro todavía.");
            }

            setStatus(`Procesando ${rows.length} etiquetas...`);

            // Generar HTML con el formato CORPORATIVO (Lógica APK)
            const html = generateHtmlTemplate(rows);

            // Generar PDF (120mm x 80mm)
            const { uri } = await Print.printToFileAsync({ 
                html, 
                width: 340, // aprox 120mm
                height: 226 // aprox 80mm
            });
            
            setStatus('Compartiendo archivo...');
            await shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
            
            Alert.alert("Éxito", `Se ha generado el PDF con ${rows.length} etiquetas.`);

        } catch (err) {
            Alert.alert("Error", err.message);
        } finally {
            setLoading(false);
            setStatus('');
        }
    };

    // TEMPLATE CORPORATIVO (RESCATADO DE APK)
    const generateHtmlTemplate = (rows) => {
        const pages = rows.map((row) => {
            const weightTons = (row.peso / 1000).toFixed(3);
            const barcodeValue = `${row.sku || '000'}-${row.lote}-${weightTons}`;
            const barcodeUrl = `https://bwipjs-api.metafloor.com/?bcid=code128&text=${encodeURIComponent(barcodeValue)}&scaleY=0.5&scaleX=0.4&height=10&includeText&textxalign=center`;

            return `
            <div class="page">
                <div class="header-sku">${row.sku || 'N/A'}</div>
                <div class="title">ALAMBRON ${selectedDiam} ${row.sae || ''}</div>
                <div class="grid">
                    <div class="label">Peso:</div><div class="value">${weightTons} T</div>
                    <div class="label-right">N° OT:</div>
                    <div class="label">Largo:</div><div class="value">N/A</div>
                    <div class="label-right">Ancho:</div>
                    <div class="label">Grado:</div><div class="value">${row.sae ? row.sae.replace(/\s+/g, '') : ''}</div>
                    <div class="na-right">N/A</div>
                    <div class="label">Lote:</div><div class="value">${row.lote}</div>
                    <div class="retenido-container">
                        <div class="checkbox"></div><div class="retenido-text">RETENIDO</div>
                    </div>
                </div>
                <div class="barcode-container"><img src="${barcodeUrl}" class="barcode-img" /></div>
            </div>`;
        }).join('');

        return `<html><head><style>
            @page { size: 120mm 80mm; margin: 0; }
            body { margin: 0; padding: 0; font-family: Helvetica, Arial, sans-serif; }
            .page { width: 120mm; height: 80mm; position: relative; background: white; page-break-after: always; padding: 4mm; box-sizing: border-box; }
            .header-sku { text-align: right; font-size: 24pt; color: #000; }
            .title { text-align: center; font-size: 20pt; font-weight: bold; margin-top: 2mm; margin-bottom: 4mm; }
            .grid { display: grid; grid-template-columns: 20mm 40mm 30mm; row-gap: 3mm; font-size: 12pt; }
            .value { font-weight: bold; text-align: center; font-size: 14pt; }
            .label-right { text-align: right; }
            .retenido-container { display: flex; align-items: center; border: 1px solid black; padding: 2px; width: fit-content; margin-left: auto; }
            .checkbox { width: 12px; height: 12px; border: 1px solid black; margin-right: 4px; }
            .retenido-text { font-size: 10pt; font-weight: bold; }
            .barcode-container { position: absolute; bottom: 2mm; left: 0; width: 100%; text-align: center; }
            .barcode-img { width: 80%; max-height: 15mm; }
        </style></head><body>${pages}</body></html>`;
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>GENERACIÓN DE ETIQUETAS</Text>
            </View>

            <View style={styles.content}>
                <Text style={styles.sectionTitle}>Selecciona un Diámetro para procesar:</Text>
                
                <View style={styles.listContainer}>
                    <ScrollView>
                        {diametros.map(d => (
                            <TouchableOpacity 
                                key={d} 
                                style={[styles.diamItem, selectedDiam === d && styles.diamItemActive]}
                                onPress={() => setSelectedDiam(d)}
                            >
                                <Text style={[styles.diamText, selectedDiam === d && {color: '#FFF'}]}>{d}</Text>
                                {selectedDiam === d && <Ionicons name="checkmark-circle" size={20} color="#FFF" />}
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                {status ? <Text style={styles.statusText}>{status}</Text> : null}

                <TouchableOpacity 
                    style={[styles.btnGenerate, loading && {opacity: 0.7}]} 
                    onPress={handleGenerate}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <>
                            <Ionicons name="print" size={20} color="white" style={{marginRight: 10}} />
                            <Text style={styles.btnText}>GENERAR PDF CORPORATIVO</Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    content: { padding: 25 },
    sectionTitle: { color: '#666', fontSize: 14, fontWeight: 'bold', marginBottom: 20 },
    listContainer: { backgroundColor: '#1E1E1E', borderRadius: 15, height: '60%', padding: 10, borderWidth: 1, borderColor: '#222' },
    diamItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: '#333' },
    diamItemActive: { backgroundColor: '#D32F2F', borderRadius: 8 },
    diamText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    statusText: { color: '#2196F3', textAlign: 'center', marginVertical: 15, fontWeight: 'bold', fontSize: 12 },
    btnGenerate: { backgroundColor: '#D32F2F', padding: 20, borderRadius: 12, marginTop: 20, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', elevation: 5 },
    btnText: { color: 'white', fontWeight: 'bold', fontSize: 14, letterSpacing: 1 }
});
