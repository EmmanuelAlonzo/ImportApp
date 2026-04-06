import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert, SafeAreaView } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

export default function HistoryScreen() {
    const { user } = useAuth();
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    const industrialRed = '#D32F2F';

    useEffect(() => { fetchHistory(); }, []);

    const fetchHistory = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('registros_importacion')
            .select('*')
            .order('updated_at', { ascending: false })
            .limit(100);
        if (data) setHistory(data);
        setLoading(false);
    };

    const toggleVerification = async (item) => {
        const newStatus = !item.is_verified;
        const { error } = await supabase
            .from('registros_importacion')
            .update({ 
                is_verified: newStatus,
                verified_by: user.nombre,
                verified_at: new Date().toISOString()
            })
            .eq('id', item.id);

        if (!error) {
            Alert.alert("Auditoría", `Lote ${item.lote} ${newStatus ? 'VERIFICADO' : 'REVERTIDO'}`);
            fetchHistory();
        }
    };

    const renderItem = ({ item }) => (
        <View style={[styles.card, item.is_verified && {borderColor: industrialRed}]}>
            <View style={styles.cardMain}>
                <View style={styles.statusId}>
                    <Text style={styles.lote}>{item.lote}</Text>
                    <Text style={styles.diametro}>{item.diametro} INDUSTRIAL</Text>
                </View>
                <TouchableOpacity 
                    onPress={() => toggleVerification(item)}
                    style={[styles.statusBtn, { backgroundColor: item.is_verified ? industrialRed : '#333' }]}
                >
                    <Text style={styles.statusText}>{item.is_verified ? 'VERIFICADO' : 'PENDIENTE'}</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.details}>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>FECHA ORIGEN:</Text>
                    <Text style={styles.detailValue}>{new Date(item.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>AUDITOR DE PLANTA:</Text>
                    <Text style={styles.detailValue}>{item.verified_by || 'SISTEMA'}</Text>
                </View>
                {item.verified_at && (
                    <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>ÚLTIMA ACCIÓN:</Text>
                        <Text style={styles.detailValue}>{new Date(item.verified_at).toLocaleTimeString()}</Text>
                    </View>
                )}
            </View>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>REGISTRO HISTÓRICO DE AUDITORÍA (S.L.)</Text>
            </View>
            <FlatList 
                data={history}
                renderItem={renderItem}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={{padding: 20}}
                refreshing={loading}
                onRefresh={fetchHistory}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 3, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
    card: { backgroundColor: '#1E1E1E', borderRadius: 15, marginBottom: 15, overflow: 'hidden', borderWidth: 1, borderColor: '#222' },
    cardMain: { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#000' },
    statusId: { flex: 1 },
    lote: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    diametro: { color: '#666', fontSize: 8, fontWeight: 'bold', marginTop: 4, letterSpacing: 1 },
    statusBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
    statusText: { color: 'white', fontSize: 9, fontWeight: 'bold' },
    details: { padding: 15 },
    detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
    detailLabel: { color: '#444', fontSize: 8, fontWeight: 'bold' },
    detailValue: { color: '#888', fontSize: 8, fontWeight: 'bold' }
});
