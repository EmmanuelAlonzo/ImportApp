import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Alert, SafeAreaView, ScrollView, Switch } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';

export default function GlobalManagementScreen() {
    const [sheetUrl, setSheetUrl] = useState('');
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [wiping, setWiping] = useState(false);

    const industrialRed = '#D32F2F';

    useEffect(() => { fetchConfig(); }, []);

    const fetchConfig = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single();
            if (error) throw error;
            if (data) {
                setConfig(data);
                setSheetUrl(data.active_spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${data.active_spreadsheet_id}` : '');
            }
        } catch (err) {
            console.log("Error config:", err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleWipe = async () => {
        Alert.alert("Limpieza Industrial", "¿Borrar registros locales?", [
            { text: "Cancelar", style: "cancel" },
            { text: "SÍ, LIMPIAR", style: "destructive", onPress: async () => {
                setWiping(true);
                await supabase.from('registros_importacion').delete().neq('id', 0);
                Alert.alert("Éxito", "Registros eliminados.");
                setWiping(false);
            }}
        ]);
    };

    const handleSync = async () => {
        if (!sheetUrl) return Alert.alert("Error", "URL requerida.");
        setSyncing(true);
        try {
            const response = await fetch('https://pskcnkzgoaqesjiohyth.supabase.co/functions/v1/import-sheet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer sb_publishable_OZX0jnagvl8zfKdM42KlNg_5EsG0LTl` },
                body: JSON.stringify({ url: sheetUrl })
            });
            if (response.ok) {
                Alert.alert("Éxito", "Infraestructura sincronizada.");
                fetchConfig();
            } else throw new Error("Fallo en sincronización");
        } catch (err) {
            Alert.alert("Error", err.message);
        } finally {
            setSyncing(false);
        }
    };

    const toggleSheetVisibility = async (index, currentVal) => {
        try {
            const currentSheets = Array.isArray(config.active_sheets) ? config.active_sheets : (typeof config.active_sheets === 'string' ? JSON.parse(config.active_sheets) : []);
            const updatedSheets = [...currentSheets];
            
            // Si el elemento es un string, lo convertimos a objeto para guardar el estado de visibilidad
            if (typeof updatedSheets[index] === 'string') {
                updatedSheets[index] = { name: updatedSheets[index], visible: !currentVal };
            } else {
                updatedSheets[index] = { ...updatedSheets[index], visible: !currentVal };
            }
            
            const { error } = await supabase.from('app_settings').update({ active_sheets: updatedSheets }).eq('id', 1);
            if (error) throw error;
            fetchConfig();
        } catch (err) {
            Alert.alert("Error", "Fallo al cambiar visibilidad: " + err.message);
        }
    };

    const getSheetsList = () => {
        if (!config?.active_sheets) return [];
        let list = [];
        if (Array.isArray(config.active_sheets)) list = config.active_sheets;
        else {
            try { list = JSON.parse(config.active_sheets); } catch (e) { list = []; }
        }
        // Normalizar a objetos {name, visible} para la UI de gestión si vienen como strings
        return list.map(s => typeof s === 'string' ? { name: s, visible: true } : s);
    };

    const sheetsList = getSheetsList();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>CONFIGURACIÓN EMPRESARIAL</Text>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.sectionCard}>
                    <Text style={styles.sectionLabel}>ENLACE MAESTRO (GOOGLE DRIVE)</Text>
                    <TextInput style={styles.urlInput} placeholder="https://docs.google.com/..." placeholderTextColor="#444" value={sheetUrl} onChangeText={setSheetUrl} />
                    
                    <View style={styles.actionsRow}>
                        <TouchableOpacity style={[styles.btnAction, {backgroundColor: '#1E1E1E', flex: 1, marginRight: 10}]} onPress={handleWipe} disabled={wiping}>
                            {wiping ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>LIMPIAR BASE</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.btnAction, {backgroundColor: industrialRed, flex: 1}]} onPress={handleSync} disabled={syncing}>
                            {syncing ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>SINCRONIZAR DRIVE</Text>}
                        </TouchableOpacity>
                    </View>
                </View>

                {sheetsList.length > 0 && (
                    <View style={styles.sheetsCard}>
                        <Text style={styles.cardTitle}>CONTROL DE VISIBILIDAD POR DIÁMETRO:</Text>
                        {sheetsList.slice(1, 10).map((sheet, idx) => {
                            const realIdx = idx + 1;
                            const isVisible = sheet.visible !== false;
                            return (
                                <View key={realIdx} style={styles.sheetRow}>
                                    <View>
                                        <Text style={styles.sheetName}>{sheet.name || sheet}</Text>
                                        <Text style={styles.sheetSub}>Hoja de Producción</Text>
                                    </View>
                                    <Switch 
                                        value={isVisible} 
                                        onValueChange={() => toggleSheetVisibility(realIdx, isVisible)}
                                        trackColor={{ false: "#333", true: industrialRed }}
                                        thumbColor={isVisible ? "#FFF" : "#666"}
                                    />
                                </View>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 3, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
    content: { padding: 20 },
    sectionCard: { marginBottom: 30, backgroundColor: '#1E1E1E', padding: 20, borderRadius: 15 },
    sectionLabel: { color: '#444', fontSize: 9, fontWeight: 'bold', marginBottom: 15 },
    urlInput: { backgroundColor: '#000', borderRadius: 10, padding: 18, color: '#FFF', fontSize: 13, borderWidth: 1, borderColor: '#333' },
    actionsRow: { flexDirection: 'row', marginTop: 25 },
    btnAction: { padding: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' },
    btnText: { color: 'white', fontWeight: 'bold', fontSize: 11 },
    sheetsCard: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 15 },
    cardTitle: { color: '#444', fontSize: 9, fontWeight: 'bold', marginBottom: 20 },
    sheetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#222' },
    sheetName: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },
    sheetSub: { color: '#444', fontSize: 9, marginTop: 2 }
});
