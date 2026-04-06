import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function KillSwitchScreen() {
    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.content}>
                <Ionicons name="lock-closed" size={100} color="#E60000" />
                <Text style={styles.title}>ACCESO RESTRINGIDO</Text>
                <Text style={styles.message}>
                    Esta aplicación ha sido desactivada remotamente o requiere una actualización crítica.
                    Por favor, contacta con el administrador del sistema para más información.
                </Text>
                <Text style={styles.copy}>ImportApp v2 - MULTI</Text>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212', justifyContent: 'center', alignItems: 'center' },
    content: { padding: 40, alignItems: 'center' },
    title: { color: 'white', fontSize: 24, fontWeight: 'bold', marginVertical: 20 },
    message: { color: '#888', fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
    copy: { color: '#333', fontSize: 12, fontWeight: 'bold' }
});
