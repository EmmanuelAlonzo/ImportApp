import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, SafeAreaView, TextInput, Modal, FlatList, ScrollView, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { supabase } from '../api/supabase';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

export default function AuthScreen() {
    const { login } = useAuth();
    const [users, setUsers] = useState([]);
    const [selectedUser, setSelectedUser] = useState(null);
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);

    useEffect(() => { fetchUsers(); }, []);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            // Consulta exclusiva a 'usuarios_app' v4.8.2
            const { data, error } = await supabase
                .from('usuarios_app')
                .select('*')
                .eq('activo', true)
                .neq('rol', 'SUSPENDIDO')
                .order('nombre', { ascending: true });
            
            if (error) throw error;

            setUsers(data || []);
            if (data?.length > 0) setSelectedUser(data[0]);
        } catch (err) {
            console.log("Error de Sincronización Auth:", err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async () => {
        if (!selectedUser) return Alert.alert("Error", "Elige un perfil.");
        if (pin.length < 4) return;

        setVerifying(true);
        try {
            // Validación atómica contra la única tabla existente
            const { data, error } = await supabase
                .from('usuarios_app')
                .select('*')
                .eq('id', selectedUser.id)
                .eq('pin', pin.trim())
                .single();

            if (error || !data) {
                Alert.alert('PIN INCORRECTO', 'Acceso denegado.');
                setPin('');
            } else if (data.activo === false || (data.rol && data.rol.toUpperCase() === 'SUSPENDIDO')) {
                Alert.alert('ACCESO RESTRINGIDO', 'Este perfil está suspendido activamente.');
                setPin('');
                fetchUsers(); 
            } else {
                login(data);
            }
        } catch (err) {
            Alert.alert('Fallo Técnico', 'Servidor no disponible.');
        } finally {
            setVerifying(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" />
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.content}>
                    
                    <View style={styles.logoContainer}>
                        <View style={styles.logoCircle}>
                            <Ionicons name="keypad-sharp" size={50} color="#D32F2F" />
                        </View>
                        <Text style={styles.appName}>ACCESO INSTITUCIONAL v4.8.2</Text>
                    </View>

                    {loading ? (
                        <ActivityIndicator size="large" color="#D32F2F" />
                    ) : (
                        <View style={styles.card}>
                            <Text style={styles.label}>SELECCIÓN DE OPERARIO:</Text>
                            <TouchableOpacity style={styles.picker} onPress={() => setModalVisible(true)}>
                                <Text style={styles.pickerText}>{selectedUser ? (selectedUser.nombre || selectedUser.Nombre) : "Seleccionar..."}</Text>
                                <Ionicons name="chevron-down-circle" size={20} color="#D32F2F" />
                            </TouchableOpacity>

                            <Text style={[styles.label, {marginTop: 25}]}>CÓDIGO DE IDENTIFICACIÓN:</Text>
                            <TextInput
                                style={styles.input}
                                value={pin}
                                onChangeText={(v) => { 
                                    setPin(v); 
                                    if(v.length === 4) handleLogin();
                                }}
                                keyboardType="numeric"
                                secureTextEntry
                                maxLength={4}
                                placeholder="----"
                                placeholderTextColor="#111"
                                editable={!verifying}
                            />

                            <TouchableOpacity 
                                style={[styles.btn, verifying && {opacity: 0.5}]} 
                                onPress={handleLogin}
                                disabled={verifying}
                            >
                                {verifying ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>ENTRAR AL PANEL</Text>}
                            </TouchableOpacity>
                        </View>
                    )}

                    <Modal visible={modalVisible} transparent animationType="fade">
                        <View style={styles.modalOverlay}>
                            <View style={styles.modalContent}>
                                <Text style={styles.modalTitle}>CATÁLOGO DE PERSONAL</Text>
                                <FlatList
                                    data={users}
                                    keyExtractor={item => item.id.toString()}
                                    renderItem={({ item }) => (
                                        <TouchableOpacity style={styles.userRow} onPress={() => { setSelectedUser(item); setModalVisible(false); }}>
                                            <Ionicons name="person-sharp" size={24} color="#D32F2F" style={{marginRight: 15}} />
                                            <Text style={styles.userText}>{item.nombre || item.Nombre}</Text>
                                        </TouchableOpacity>
                                    )}
                                />
                                <TouchableOpacity style={styles.closeBtn} onPress={() => setModalVisible(false)}>
                                    <Text style={styles.closeText}>CANCELAR</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </Modal>

                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    content: { flexGrow: 1, justifyContent: 'center', padding: 25 },
    logoContainer: { alignItems: 'center', marginBottom: 40 },
    logoCircle: { width: 90, height: 90, borderRadius: 25, backgroundColor: '#1E1E1E', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#D32F2F', marginBottom: 20 },
    appName: { color: '#FFF', fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
    card: { backgroundColor: '#1E1E1E', padding: 25, borderRadius: 15, borderTopWidth: 5, borderTopColor: '#D32F2F' },
    label: { color: '#444', fontSize: 9, fontWeight: 'bold', marginBottom: 10, letterSpacing: 1 },
    picker: { backgroundColor: '#000', borderRadius: 8, padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#222' },
    pickerText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    input: { backgroundColor: '#000', borderRadius: 8, padding: 15, fontSize: 32, textAlign: 'center', color: '#D32F2F', letterSpacing: 12, borderWidth: 1, borderColor: '#222', marginTop: 5, fontWeight: '900' },
    btn: { backgroundColor: '#D32F2F', padding: 20, borderRadius: 10, marginTop: 30, alignItems: 'center' },
    btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 13, letterSpacing: 1 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.98)', justifyContent: 'center', padding: 25 },
    modalContent: { backgroundColor: '#1E1E1E', borderRadius: 30, padding: 30, maxHeight: '80%', borderWidth: 1, borderColor: '#D32F2F' },
    modalTitle: { color: '#FFF', fontSize: 15, fontWeight: 'bold', textAlign: 'center', marginBottom: 25 },
    userRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#222' },
    userText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
    closeBtn: { marginTop: 25, padding: 15, alignItems: 'center' },
    closeText: { color: '#D32F2F', fontWeight: 'bold', fontSize: 12 }
});
