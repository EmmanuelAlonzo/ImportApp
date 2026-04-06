import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, SafeAreaView, ScrollView, StatusBar } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';

export default function DatabaseViewScreen() {
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [stats, setStats] = useState({ total: 0, verified: 0, byDiam: {} });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        const { data: allData } = await supabase.from('registros_importacion').select('diametro, is_verified');
        const { data: verifiedData } = await supabase.from('registros_importacion').select('*').eq('is_verified', true).order('verified_at', { ascending: false });
        if (allData) {
            const total = allData.length;
            const verified = allData.filter(r => r.is_verified).length;
            const byDiam = {};
            allData.forEach(r => {
                const d = r.diametro || 'N/A';
                if (!byDiam[d]) byDiam[d] = { total: 0, verified: 0 };
                byDiam[d].total++;
                if (r.is_verified) byDiam[d].verified++;
            });
            setStats({ total, verified, byDiam });
        }
        if (verifiedData) setRecords(verifiedData);
        setLoading(false);
    };

    const filtered = records.filter(r => r.lote?.toLowerCase().includes(search.toLowerCase()) || r.diametro?.includes(search));

    const renderHeader = () => (
        <View style={styles.statsContainer}>
            <View style={styles.mainStat}>
                <Text style={styles.mainLabel}>EFICIENCIA DE VERIFICACIÓN</Text>
                <Text style={styles.mainValue}>{stats.total > 0 ? Math.round((stats.verified / stats.total) * 100) : 0}%</Text>
                <Text style={styles.mainSub}>{stats.verified} / {stats.total} UNIDADES ESCANEADAS</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
                {Object.keys(stats.byDiam).sort((a,b)=>parseFloat(a)-parseFloat(b)).map(d => (
                    <View key={d} style={styles.chip}>
                        <Text style={styles.chipTitle}>{d} MM</Text>
                        <Text style={styles.chipVal}>{Math.round((stats.byDiam[d].verified / stats.byDiam[d].total) * 100)}%</Text>
                    </View>
                ))}
            </ScrollView>
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" />
            <View style={styles.header}><Text style={styles.headerTitle}>BASE DE DATOS EN TIEMPO REAL</Text></View>
            <View style={styles.searchBar}>
                <Ionicons name="search-outline" size={18} color="#444" style={{marginRight: 10}} />
                <TextInput style={styles.searchInput} placeholder="Buscar lote o diámetro..." placeholderTextColor="#444" value={search} onChangeText={setSearch} />
            </View>
            <FlatList
                data={filtered}
                renderItem={({ item }) => (
                    <View style={styles.item}>
                        <View style={{flex: 1}}>
                            <Text style={styles.itemLote}>{item.lote}</Text>
                            <Text style={styles.itemSub}>{item.diametro}MM | {item.colada || 'EXC'}</Text>
                        </View>
                        <View style={styles.badge}><Text style={styles.badgeText}>VERIFICADO</Text></View>
                    </View>
                )}
                keyExtractor={item => item.id.toString()}
                ListHeaderComponent={renderHeader}
                refreshing={loading}
                onRefresh={fetchData}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 2, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    searchBar: { flexDirection: 'row', backgroundColor: '#1E1E1E', margin: 20, paddingHorizontal: 15, borderRadius: 10, height: 50, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
    searchInput: { flex: 1, color: 'white', fontWeight: 'bold' },
    statsContainer: { paddingHorizontal: 20, marginBottom: 15 },
    mainStat: { alignItems: 'center', marginBottom: 20, backgroundColor: '#1E1E1E', padding: 20, borderRadius: 12, borderLeftWidth: 5, borderLeftColor: '#D32F2F' },
    mainLabel: { color: '#888', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
    mainValue: { color: '#FFF', fontSize: 40, fontWeight: '900' },
    mainSub: { color: '#D32F2F', fontSize: 10, fontWeight: 'bold', marginTop: 5 },
    scroll: { marginBottom: 10 },
    chip: { backgroundColor: '#1E1E1E', padding: 12, borderRadius: 10, marginRight: 10, alignItems: 'center', minWidth: 80, borderWidth: 1, borderColor: '#333' },
    chipTitle: { color: '#555', fontSize: 9, fontWeight: 'bold' },
    chipVal: { color: '#FFF', fontSize: 16, fontWeight: 'bold', marginTop: 3 },
    item: { flexDirection: 'row', backgroundColor: '#1E1E1E', marginHorizontal: 20, marginVertical: 6, padding: 18, borderRadius: 12, alignItems: 'center', borderLeftWidth: 5, borderLeftColor: '#2E7D32' },
    itemLote: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    itemSub: { color: '#888', fontSize: 11, marginTop: 4 },
    badge: { backgroundColor: 'transparent', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 5, borderWidth: 1, borderColor: '#2E7D32' },
    badgeText: { color: '#2E7D32', fontSize: 8, fontWeight: 'bold' }
});
