import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, StatusBar } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function HomeScreen() {
    const { user, logout } = useAuth();
    const router = useRouter();
    const role = user?.rol?.toUpperCase() || 'OPERADOR';

    const menuItems = [
        { title: 'Verificación Planta', icon: 'shield-checkmark-sharp', color: '#4CAF50', route: '/v2/verification', roles: ['ADMINISTRADOR', 'VERIFICADOR', 'SUPERVISOR', 'OPERADOR', 'AUXILIAR'] },
        { title: 'Ingreso Manual', icon: 'add-circle-sharp', color: '#2196F3', route: '/v2/manual', roles: ['ADMINISTRADOR', 'VERIFICADOR', 'SUPERVISOR', 'DIGITADOR', 'AUXILIAR'] },
        { title: 'Historial / Auditoría', icon: 'list-sharp', color: '#9C27B0', route: '/v2/history', roles: ['ADMINISTRADOR', 'SUPERVISOR', 'VERIFICADOR'] },
        { title: 'Base de Datos', icon: 'stats-chart-sharp', color: '#FFC107', route: '/v2/database', roles: ['ADMINISTRADOR', 'SUPERVISOR'] },
        { title: 'Exportar Reporte', icon: 'cloud-download-sharp', color: '#FF9800', route: '/v2/export', roles: ['ADMINISTRADOR', 'SUPERVISOR'] },
        { title: 'Gestión Global', icon: 'globe-sharp', color: '#D32F2F', route: '/v2/global', roles: ['ADMINISTRADOR'] },
        { title: 'Gestión Usuarios', icon: 'people-sharp', color: '#00BCD4', route: '/v2/users', roles: ['ADMINISTRADOR'] },
        { title: 'Configuración', icon: 'settings-sharp', color: '#607D8B', route: '/v2/settings', roles: ['ADMINISTRADOR', 'VERIFICADOR', 'SUPERVISOR', 'DIGITADOR', 'AUXILIAR'] },
        { title: 'Generar Etiquetas', icon: 'print-sharp', color: '#D32F2F', route: '/v2/bulk', roles: ['ADMINISTRADOR', 'SUPERVISOR'] },
    ];

    const filteredItems = menuItems.filter(item => item.roles.includes(role));

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" />
            <View style={styles.header}>
                <View>
                    <Text style={styles.welcome}>ENTERPRISE v4.0</Text>
                    <Text style={styles.username}>{user?.nombre || 'Operador'}</Text>
                    <Text style={styles.roleTag}>{role}</Text>
                </View>
                <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
                    <Ionicons name="power-sharp" size={24} color="#D32F2F" />
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
                <View style={styles.grid}>
                    {filteredItems.map((item, index) => (
                        <TouchableOpacity 
                            key={index} 
                            style={styles.card} 
                            onPress={() => router.push(item.route)}
                        >
                            <View style={[styles.iconContainer, { backgroundColor: item.color + '10' }]}>
                                <Ionicons name={item.icon} size={32} color={item.color} />
                            </View>
                            <Text style={styles.cardTitle}>{item.title}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </ScrollView>

            <View style={styles.footer}>
                <Text style={styles.footerText}>MOODDARK PRISTINE ENGINE</Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 30, backgroundColor: '#000', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 3, borderBottomColor: '#D32F2F' },
    welcome: { color: '#D32F2F', fontSize: 10, fontWeight: 'bold', letterSpacing: 2 },
    username: { color: '#FFF', fontSize: 20, fontWeight: 'bold', marginTop: 4 },
    roleTag: { color: '#444', fontSize: 9, fontWeight: 'bold', marginTop: 2, letterSpacing: 1 },
    logoutBtn: { backgroundColor: '#1E1E1E', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#222' },
    scrollContent: { paddingBottom: 30 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', padding: 20 },
    card: { width: '48%', backgroundColor: '#1E1E1E', paddingVertical: 30, borderRadius: 20, alignItems: 'center', marginBottom: 15, borderWidth: 1, borderColor: '#222' },
    iconContainer: { width: 66, height: 66, borderRadius: 33, justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
    cardTitle: { color: '#AAA', fontSize: 11, fontWeight: 'bold', textAlign: 'center' },
    footer: { padding: 20, alignItems: 'center' },
    footerText: { color: '#222', fontSize: 10, fontWeight: 'bold', letterSpacing: 3 }
});
