import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, SafeAreaView, ActivityIndicator } from 'react-native';
import { supabase } from '../api/supabase';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen() {
    const { user } = useAuth();
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChangePin = async () => {
        if (!currentPin || !newPin) {
            Alert.alert("Error", "Completa los campos");
            return;
        }

        setLoading(true);
        try {
            // 1. Validar PIN actual (Tabla 'usuarios')
            const { data } = await supabase.from('usuarios').select('pin').eq('id', user.id).single();
            if (data.pin !== currentPin) throw new Error("PIN actual incorrecto");

            // 2. Actualizar
            const { error } = await supabase.from('usuarios').update({ pin: newPin }).eq('id', user.id);
            if (error) throw error;

            Alert.alert("Éxito", "Tu PIN ha sido actualizado.");
            setCurrentPin(''); setNewPin('');

        } catch (err) {
            Alert.alert("Error", err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>CONFIGURACIÓN / SEGURIDAD</Text>
            </View>

            <View style={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionLabel}>SEGURIDAD DE ACCESO</Text>
                    <View style={styles.card}>
                        <Text style={styles.label}>PIN ACTUAL:</Text>
                        <TextInput style={styles.input} value={currentPin} onChangeText={setCurrentPin} secureTextEntry keyboardType="numeric" maxLength={4} placeholder="****" placeholderTextColor="#333" />
                        
                        <Text style={[styles.label, {marginTop: 20}]}>NUEVO PIN:</Text>
                        <TextInput style={styles.input} value={newPin} onChangeText={setNewPin} secureTextEntry keyboardType="numeric" maxLength={4} placeholder="****" placeholderTextColor="#333" />
                        
                        <TouchableOpacity style={styles.btnAction} onPress={handleChangePin} disabled={loading}>
                            {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>GUARDAR NUEVO PIN</Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#607D8B', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    content: { padding: 20 },
    section: { marginBottom: 30 },
    sectionLabel: { color: '#607D8B', fontSize: 10, fontWeight: 'bold', marginBottom: 15, letterSpacing: 1 },
    card: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: '#222' },
    label: { color: '#666', fontSize: 10, fontWeight: 'bold', marginBottom: 10 },
    input: { backgroundColor: '#000', borderRadius: 10, padding: 15, color: '#FFF', fontSize: 18, textAlign: 'center', borderWidth: 1, borderColor: '#333' },
    btnAction: { backgroundColor: '#607D8B', padding: 18, borderRadius: 10, marginTop: 25, alignItems: 'center' },
    btnText: { color: 'white', fontWeight: 'bold', fontSize: 14 }
});
