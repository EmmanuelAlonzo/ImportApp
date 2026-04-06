import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';

export default function DatabaseScreen() {
    const [stats, setStats] = useState([]);
    const [globalStats, setGlobalStats] = useState({ total: 0, verified: 0, percent: 0 });
    const [loading, setLoading] = useState(false);

    const industrialRed = '#D32F2F';

    useEffect(() => { fetchStats(); }, []);

    const fetchStats = async () => {
        setLoading(true);
        try {
            const { data: settings } = await supabase.from('app_settings').select('active_sheets').eq('id', 1).single();
            let visibleNames = [];
            if (settings?.active_sheets) {
                const parsed = Array.isArray(settings.active_sheets) ? settings.active_sheets : JSON.parse(settings.active_sheets);
                visibleNames = parsed.filter(s => s.visible !== false).map(s => s.name);
            }

            const { data, error } = await supabase.from('registros_importacion').select('diametro, is_verified');
            if (error) throw error;

            if (data) {
                const uniqueInDb = [...new Set(data.map(r => r.diametro))];
                const finalVisible = visibleNames.length > 0 ? visibleNames : uniqueInDb;
                const filteredData = data.filter(r => finalVisible.includes(r.diametro));
                
                const total = filteredData.length;
                const verified = filteredData.filter(r => r.is_verified).length;
                setGlobalStats({ total, verified, percent: total > 0 ? (verified / total) * 100 : 0 });

                const grouped = filteredData.reduce((acc, current) => {
                    const name = current.diametro || 'OTRO';
                    if (!acc[name]) acc[name] = { total: 0, verified: 0 };
                    acc[name].total += 1;
                    if (current.is_verified) acc[name].verified += 1;
                    return acc;
                }, {});

                const statsArray = finalVisible.map(name => {
                    const g = grouped[name] || { total: 0, verified: 0 };
                    return {
                        name,
                        total: g.total,
                        verified: g.verified,
                        percent: g.total > 0 ? (g.verified / g.total) * 100 : 0
                    };
                }).filter(s => s.total > 0);

                setStats(statsArray);
            }
        } catch (err) {
            console.log("Error stats:", err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>ANÁLISIS DE AVANCE INDUSTRIAL</Text>
            </View>

            {loading ? (
                <ActivityIndicator size="large" color={industrialRed} style={{marginTop: 50}} />
            ) : (
                <ScrollView contentContainerStyle={styles.content}>
                    <View style={styles.globalCard}>
                        <View style={styles.globalRow}>
                            <View>
                                <Text style={styles.globalLabel}>EFICIENCIA DE PLANTA</Text>
                                <Text style={styles.globalPercent}>{globalStats.percent.toFixed(1)}%</Text>
                            </View>
                            <Ionicons name="stats-chart" size={44} color="#333" />
                        </View>
                        <View style={styles.progressBarBg}>
                            <View style={[styles.progressBarFill, { width: `${globalStats.percent}%`, backgroundColor: industrialRed }]} />
                        </View>
                    </View>

                    <Text style={styles.sectionTitle}>DETALLE DE PRODUCCIÓN HABILITADA:</Text>
                    
                    {stats.map((item, index) => (
                        <View key={index} style={styles.statRow}>
                            <View style={styles.statHeader}>
                                <Text style={styles.statName}>{item.name}</Text>
                                <Text style={styles.statNum}>{item.percent.toFixed(0)}%</Text>
                            </View>
                            <View style={styles.miniBarBg}>
                                <View style={[styles.miniBarFill, { width: `${item.percent}%`, backgroundColor: item.percent === 100 ? '#4CAF50' : industrialRed }]} />
                            </View>
                            <Text style={styles.statDetail}>{item.verified} de {item.total} lotes validados</Text>
                        </View>
                    ))}
                    {stats.length === 0 && <Text style={{color: '#444', textAlign: 'center', marginTop: 30, fontSize: 10}}>Cargue datos en Gestión Global para ver estadísticas.</Text>}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 3, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
    content: { padding: 20 },
    globalCard: { backgroundColor: '#1E1E1E', padding: 25, borderRadius: 20, marginBottom: 25 },
    globalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    globalLabel: { color: '#444', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 },
    globalPercent: { color: '#FFF', fontSize: 44, fontWeight: 'bold' },
    progressBarBg: { height: 6, backgroundColor: '#000', borderRadius: 3, overflow: 'hidden' },
    progressBarFill: { height: '100%' },
    sectionTitle: { color: '#444', fontSize: 9, fontWeight: 'bold', marginBottom: 20 },
    statRow: { backgroundColor: '#1E1E1E', padding: 15, borderRadius: 12, marginBottom: 15 },
    statHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    statName: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },
    statNum: { color: '#888', fontSize: 14, fontWeight: 'bold' },
    miniBarBg: { height: 3, backgroundColor: '#000', borderRadius: 2, overflow: 'hidden' },
    miniBarFill: { height: '100%' },
    statDetail: { color: '#444', fontSize: 8, marginTop: 8, fontWeight: 'bold', textAlign: 'right' }
});
