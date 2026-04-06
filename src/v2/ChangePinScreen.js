import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, SafeAreaView, ActivityIndicator } from 'react-native';
import { supabase } from '../api/supabase';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function ChangePinScreen() {
    const { user } = useAuth();
    const [currentPin, setCurrentPin] = useState('');
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChangePin = async () => {
        if (!currentPin || !newPin || !confirmPin) {
            Alert.alert("Error", "Completa todos los campos");
            return;
        }

        if (newPin !== confirmPin) {
            Alert.alert("Error", "El nuevo PIN no coincide");
            return;
        }

        setLoading(true);
        try {
            // 1. Validar PIN actual
            const { data, error: fetchError } = await supabase
                .from('usuarios_app')
                .select('pin')
                .eq('id', user.id)
                .single();
            
            if (data.pin !== currentPin) {
                throw new Error("El PIN actual es incorrecto");
            }

            // 2. Actualizar a nuevo PIN
            const { error: updateError } = await supabase
                .from('usuarios_app')
                .update({ pin: newPin })
                .eq('id', user.id);

            if (updateError) throw updateError;

            Alert.alert("Éxito", "PIN actualizado correctamente");
            setCurrentPin(''); setNewPin(''); setConfirmPin('');

        } catch (err) {
            Alert.alert("Error", err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>SEGURIDAD: CAMBIAR PIN</Text>
            </View>

            <View style={styles.content}>
                <Ionicons name="lock-closed" size={50} color="#D32F2F" style={{alignSelf: 'center', marginBottom: 30}} />
                
                <View style={styles.form}>
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>PIN ACTUAL:</Text>
                        <TextInput 
                            style={styles.input} 
                            value={currentPin} 
                            onChangeText={setCurrentPin} 
                            secureTextEntry 
                            keyboardType="numeric" 
                            maxLength={4}
                            placeholder="****"
                            placeholderTextColor="#333"
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>NUEVO PIN (4 dígitos):</Text>
                        <TextInput 
                            style={styles.input} 
                            value={newPin} 
                            onChangeText={setNewPin} 
                            secureTextEntry 
                            keyboardType="numeric" 
                            maxLength={4}
                            placeholder="****"
                            placeholderTextColor="#333"
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>CONFIRMAR NUEVO PIN:</Text>
                        <TextInput 
                            style={styles.input} 
                            value={confirmPin} 
                            onChangeText={setConfirmPin} 
                            secureTextEntry 
                            keyboardType="numeric" 
                            maxLength={4}
                            placeholder="****"
                            placeholderTextColor="#333"
                        />
                    </View>

                    <TouchableOpacity style={styles.btnSave} onPress={handleChangePin} disabled={loading}>
                        {loading ? <ActivityIndicator color="white" /> : <Text style={styles.btnText}>ACTUALIZAR MI PIN</Text>}
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    content: { padding: 30 },
    form: { backgroundColor: '#1E1E1E', padding: 25, borderRadius: 20, borderWidth: 1, borderColor: '#222' },
    inputGroup: { marginBottom: 25 },
    label: { color: '#666', fontSize: 10, fontWeight: 'bold', marginBottom: 10 },
    input: { backgroundColor: '#000', borderRadius: 10, padding: 18, color: '#FFF', fontSize: 20, textAlign: 'center', borderWidth: 1, borderColor: '#333' },
    btnSave: { backgroundColor: '#B71C1C', padding: 20, borderRadius: 12, alignItems: 'center', marginTop: 10 },
    btnText: { color: 'white', fontWeight: 'bold', letterSpacing: 1 }
});
