import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, SafeAreaView, ActivityIndicator, FlatList } from 'react-native';
import { supabase } from '../api/supabase';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function VerificationScreen() {
    const { user } = useAuth();
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(false);
    const [verifying, setVerifying] = useState(null);

    const industrialRed = '#D32F2F';

    useEffect(() => { fetchPendingRecords(); }, []);

    const fetchPendingRecords = async () => {
        setLoading(true);
        try {
            // 1. Obtener Visibilidad
            const { data: settings } = await supabase.from('app_settings').select('active_sheets').eq('id', 1).single();
            let visibleNames = [];
            if (settings?.active_sheets) {
                const parsed = Array.isArray(settings.active_sheets) ? settings.active_sheets : JSON.parse(settings.active_sheets);
                visibleNames = parsed.filter(s => s.visible !== false).map(s => s.name);
            }

            // 2. Obtener Pendientes de Diámetros Visibles
            const { data, error } = await supabase
                .from('registros_importacion')
                .select('*')
                .eq('is_verified', false)
                .in('diametro', visibleNames)
                .order('created_at', { ascending: true })
                .limit(50);

            if (error) throw error;
            setRecords(data || []);
        } catch (err) {
            console.log("Error verification:", err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (item) => {
        setVerifying(item.id);
        const { error } = await supabase
            .from('registros_importacion')
            .update({ 
                is_verified: true,
                verified_by: user.nombre,
                verified_at: new Date().toISOString()
            })
            .eq('id', item.id);

        if (!error) {
            setRecords(prev => prev.filter(r => r.id !== item.id));
        } else {
            Alert.alert("Error", "No se pudo verificar el registro.");
        }
        setVerifying(null);
    };

    const renderItem = ({ item }) => (
        <View style={styles.recordCard}>
            <View style={styles.cardInfo}>
                <Text style={styles.loteText}>{item.lote}</Text>
                <Text style={styles.diametroLabel}>{item.diametro}</Text>
                <View style={styles.dataGrid}>
                    <Text style={styles.dataItem}>Colada: {item.colada || '---'}</Text>
                    <Text style={styles.dataItem}>Peso: {item.peso} kg</Text>
                </View>
            </View>
            <TouchableOpacity 
                style={[styles.btnVerify, {backgroundColor: industrialRed}]} 
                onPress={() => handleVerify(item)}
                disabled={verifying === item.id}
            >
                {verifying === item.id ? (
                    <ActivityIndicator color="white" />
                ) : (
                    <Ionicons name="checkmark-sharp" size={24} color="white" />
                )}
            </TouchableOpacity>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>CONTROL OPERATIVO DE PLANTA</Text>
            </View>

            {loading ? (
                <ActivityIndicator size="large" color={industrialRed} style={{marginTop: 50}} />
            ) : (
                <FlatList 
                    data={records}
                    renderItem={renderItem}
                    keyExtractor={item => item.id.toString()}
                    contentContainerStyle={{padding: 20}}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <Ionicons name="shield-checkmark-outline" size={60} color="#222" />
                            <Text style={styles.emptyText}>TODOS LOS PRODUCTOS VERIFICADOS</Text>
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
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 3, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
    recordCard: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 15, marginBottom: 15, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#222' },
    cardInfo: { flex: 1 },
    loteText: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
    diametroLabel: { color: '#666', fontSize: 10, fontWeight: 'bold', marginTop: 5, letterSpacing: 1 },
    dataGrid: { flexDirection: 'row', marginTop: 12 },
    dataItem: { color: '#444', fontSize: 10, marginRight: 15, fontWeight: 'bold' },
    btnVerify: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5 },
    emptyContainer: { padding: 50, alignItems: 'center', marginTop: 50 },
    emptyText: { color: '#444', fontSize: 10, fontWeight: 'bold', marginTop: 20, letterSpacing: 1 }
});
