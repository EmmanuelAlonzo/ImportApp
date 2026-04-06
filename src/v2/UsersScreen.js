import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, TextInput, Alert, SafeAreaView, ActivityIndicator, StatusBar } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';

export default function UsersScreen() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [formData, setFormData] = useState({ nombre: '', pin: '', rol: 'AUXILIAR', activo: true });

    useEffect(() => { fetchUsers(); }, []);

    const fetchUsers = async () => {
        setLoading(true);
        const { data } = await supabase.from('usuarios_app').select('*').order('nombre', { ascending: true });
        setUsers(data || []);
        setLoading(false);
    };

    const handleSave = async () => {
        if (!formData.nombre || !formData.pin) { Alert.alert('Error', 'Faltan datos'); return; }
        setLoading(true);
        const { error } = editingUser 
            ? await supabase.from('usuarios_app').update(formData).eq('id', editingUser.id) 
            : await supabase.from('usuarios_app').insert([formData]);
        if (!error) { setModalVisible(false); fetchUsers(); }
        else Alert.alert('Error', error.message);
        setLoading(false);
    };

    const openModal = (user = null) => {
        setEditingUser(user);
        setFormData(user ? { nombre: user.nombre, pin: user.pin, rol: user.rol, activo: user.activo } : { nombre: '', pin: '', rol: 'AUXILIAR', activo: true });
        setModalVisible(true);
    };

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar barStyle="light-content" />
            <View style={styles.header}><Text style={styles.headerTitle}>GESTIÓN DE PERSONAL</Text></View>
            <FlatList
                data={users}
                renderItem={({ item }) => (
                    <TouchableOpacity style={styles.item} onPress={() => openModal(item)}>
                        <View style={{flex: 1}}>
                            <Text style={styles.name}>{item.nombre}</Text>
                            <Text style={styles.role}>{item.rol}</Text>
                        </View>
                        <Ionicons name="chevron-forward" color="#D32F2F" size={20} />
                    </TouchableOpacity>
                )}
                keyExtractor={item => item.id.toString()}
                contentContainerStyle={{padding: 20}}
            />
            <TouchableOpacity style={styles.addBtn} onPress={() => openModal()}>
                <Ionicons name="person-add" size={24} color="white" />
            </TouchableOpacity>

            <Modal visible={modalVisible} animationType="slide" transparent>
                <View style={styles.modalOverlay}><View style={styles.modalContent}>
                    <Text style={styles.modalTitle}>{editingUser ? 'EDITAR PERFIL' : 'NUEVO OPERARIO'}</Text>
                    <TextInput style={styles.input} value={formData.nombre} placeholder="Nombre Completo" placeholderTextColor="#444" onChangeText={v => setFormData({...formData, nombre: v})} />
                    <TextInput style={styles.input} value={formData.pin} placeholder="PIN (4 dígitos)" placeholderTextColor="#444" keyboardType="numeric" maxLength={4} onChangeText={v => setFormData({...formData, pin: v})} />
                    <View style={styles.roleGrid}>
                        {['ADMINISTRADOR', 'SUPERVISOR', 'VERIFICADOR', 'AUXILIAR', 'DIGITADOR'].map(r => (
                            <TouchableOpacity key={r} style={[styles.roleBtn, formData.rol === r && styles.roleActive]} onPress={() => setFormData({...formData, rol: r})}>
                                <Text style={[styles.roleText, formData.rol === r && {color: 'white'}]}>{r}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <TouchableOpacity style={styles.saveBtn} onPress={handleSave}><Text style={styles.saveBtnText}>{editingUser ? 'ACTUALIZAR' : 'CREAR USUARIO'}</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => setModalVisible(false)}><Text style={styles.cancelText}>CANCELAR</Text></TouchableOpacity>
                </View></View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 2, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 1 },
    item: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 12, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 5, borderLeftColor: '#D32F2F' },
    name: { color: 'white', fontWeight: 'bold', fontSize: 16 },
    role: { color: '#D32F2F', fontSize: 10, fontWeight: 'bold', marginTop: 4 },
    addBtn: { position: 'absolute', bottom: 30, right: 30, backgroundColor: '#D32F2F', width: 65, height: 65, borderRadius: 33, justifyContent: 'center', alignItems: 'center', elevation: 10 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 25 },
    modalContent: { backgroundColor: '#1E1E1E', padding: 30, borderRadius: 20, borderWidth: 1, borderColor: '#D32F2F' },
    modalTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 25 },
    input: { backgroundColor: '#2C2C2C', color: 'white', padding: 15, borderRadius: 10, marginBottom: 15, borderWidth: 1, borderColor: '#444', fontWeight: 'bold' },
    roleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 30, justifyContent: 'center' },
    roleBtn: { backgroundColor: '#333', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
    roleActive: { backgroundColor: '#D32F2F' },
    roleText: { color: '#888', fontSize: 9, fontWeight: 'bold' },
    saveBtn: { backgroundColor: '#D32F2F', padding: 18, borderRadius: 10, alignItems: 'center', marginBottom: 15 },
    saveBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
    cancelText: { color: '#888', textAlign: 'center', fontWeight: 'bold', fontSize: 12 }
});
