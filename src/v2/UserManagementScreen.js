import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, SafeAreaView, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { supabase } from '../api/supabase';
import { Ionicons } from '@expo/vector-icons';

export default function UserManagementScreen() {
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState(['OPERADOR', 'ADMINISTRADOR', 'VERIFICADOR', 'SUPERVISOR', 'DIGITADOR', 'AUXILIAR']); 
    const [loading, setLoading] = useState(false);
    
    const [userName, setUserName] = useState('');
    const [userPin, setUserPin] = useState('');
    const [userRole, setUserRole] = useState('OPERADOR');
    const [editingUser, setEditingUser] = useState(null);

    const industrialRed = '#D32F2F';

    useEffect(() => { fetchInitialData(); }, []);

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            // Sincronización Directa v4.8.2: Solo 'usuarios_app' (La única real)
            const { data, error } = await supabase
                .from('usuarios_app')
                .select('*')
                .order('nombre', { ascending: true }); 

            if (data) {
                setUsers(data);
                const uniqueRoles = [...new Set(data.map(u => (u.rol || u.Rol || '').toUpperCase()))];
                const base = ['OPERADOR', 'ADMINISTRADOR', 'VERIFICADOR', 'SUPERVISOR', 'DIGITADOR', 'AUXILIAR'];
                setRoles([...new Set([...base, ...uniqueRoles])]);
            } else if (error) {
                console.log("Error SQL:", error.message);
            }
        } catch (err) {
            console.log("Fallo crítico:", err.message);
        } finally {
            setLoading(false);
        }
    };

    const toggleStatus = async (item) => {
        const currentRol = (item.rol || item.Rol || '').toUpperCase();
        const currentActive = item.activo !== undefined ? item.activo : true;
        
        const isSuspended = currentRol === 'SUSPENDIDO' || currentActive === false;
        const targetActive = isSuspended ? true : false;
        const targetRole = isSuspended ? 'OPERADOR' : 'SUSPENDIDO';

        Alert.alert(
            isSuspended ? "Reactivar Personal" : "SUSPENDER ACCESO",
            `¿Estás seguro de cambiar el estatus de ${item.nombre || item.Nombre}?`,
            [
                { text: "Cancelar", style: "cancel" },
                { text: "EJECUTAR ORDEN", onPress: async () => {
                    setLoading(true);
                    try {
                        const { error } = await supabase.rpc('admin_manage_user', {
                            user_id: item.id,
                            new_active: targetActive,
                            new_role: targetRole
                        });

                        if (error) {
                            // Si el RPC falla porque no se ha inyectado el script corregido
                            Alert.alert("Error de Persistencia", "Asegúrate de inyectar el script SQL v4.8.2 corregido en Supabase.");
                        } else {
                            Alert.alert("Sincronizado", "Cambio guardado con autoridad.");
                            fetchInitialData();
                        }
                    } catch (e) {
                        Alert.alert("Fallo", e.message);
                        fetchInitialData();
                    }
                }}
            ]
        );
    };

    const handleDelete = async (item) => {
        Alert.alert("ELIMINAR PERFIL", `¿Borrar permanentemente a ${item.nombre || item.Nombre}?`, [
            { text: "Cancelar" },
            { text: "CONFIRMAR BORRADO", style: "destructive", onPress: async () => {
                setLoading(true);
                try {
                    await supabase.from('usuarios_app').delete().eq('id', item.id);
                    Alert.alert("Éxito", "Usuario eliminado.");
                } catch (e) {
                    Alert.alert("Error", "Fallo al borrar.");
                } finally {
                    fetchInitialData();
                }
            }}
        ]);
    };

    const handleSave = async () => {
        if (!userName || !userPin) return Alert.alert("Error", "Datos incompletos.");
        const userData = { nombre: userName.toUpperCase().trim(), pin: userPin, rol: userRole, activo: true };

        try {
            if (editingUser) {
                await supabase.from('usuarios_app').update(userData).eq('id', editingUser.id);
                setEditingUser(null);
            } else {
                await supabase.from('usuarios_app').insert([userData]);
            }
            setUserName(''); setUserPin('');
            fetchInitialData();
        } catch (e) {
            Alert.alert("Error", e.message);
        }
    };

    const renderItem = ({ item }) => {
        const name = item.nombre || item.Nombre || '---';
        const role = (item.rol || item.Rol || 'OPERADOR').toUpperCase();
        const active = item.activo !== undefined ? item.activo : true;
        const isSuspended = role === 'SUSPENDIDO' || active === false;

        return (
            <View style={[
                styles.userCard, 
                isSuspended && { borderColor: '#FFF', backgroundColor: '#420F0F', borderLeftWidth: 15 }
            ]}>
                <View style={styles.userInfo}>
                    <Text style={[styles.userName, isSuspended && { color: '#FFF' }]}>{name}</Text>
                    <View style={styles.roleRow}>
                        <Text style={[
                            styles.userRoleText, 
                            isSuspended ? { color: '#FFBABA' } : { color: '#888' }
                        ]}>
                            {isSuspended ? '>>> BAJA ADMINISTRATIVA <<<' : role}
                        </Text>
                        {!isSuspended && <Text style={styles.pinText}> • PIN: {item.pin}</Text>}
                    </View>
                </View>
                <View style={styles.actions}>
                    <TouchableOpacity onPress={() => { setEditingUser(item); setUserName(name); setUserPin(item.pin); setUserRole(role); }} style={styles.iconBtn}>
                        <Ionicons name="settings-sharp" size={20} color={isSuspended ? "#FFF" : "#444"} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => toggleStatus(item)} style={styles.iconBtn}>
                        <Ionicons 
                            name={isSuspended ? "play-circle" : "pause-circle"} 
                            size={32} 
                            color={isSuspended ? "#4CAF50" : industrialRed} 
                        />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(item)} style={styles.iconBtn}>
                        <Ionicons name="trash-sharp" size={20} color={isSuspended ? "#FFBABA" : "#444"} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>ADMINISTRACIÓN DE PERSONAL v4.8.2</Text>
            </View>

            <View style={styles.addUserForm}>
                <View style={styles.row}>
                    <TextInput 
                        style={[styles.input, {flex: 2, marginRight: 10}]}
                        placeholder="IDENTIFICACIÓN"
                        placeholderTextColor="#444"
                        value={userName}
                        onChangeText={setUserName}
                    />
                    <TextInput 
                        style={[styles.input, {flex: 1}]}
                        placeholder="PIN"
                        placeholderTextColor="#444"
                        keyboardType="numeric"
                        maxLength={4}
                        value={userPin}
                        onChangeText={setUserPin}
                    />
                </View>
                
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginVertical: 15, paddingBottom: 10}}>
                    {roles.map(r => (
                        <TouchableOpacity 
                            key={r} 
                            onPress={() => setUserRole(r)}
                            style={[styles.roleBtn, userRole === r && {backgroundColor: industrialRed, borderColor: industrialRed}]}
                        >
                            <Text style={[styles.roleText, userRole === r && {color: '#FFF'}]}>{r}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
                
                <TouchableOpacity style={styles.btnAdd} onPress={handleSave}>
                    <Text style={styles.btnAddText}>{editingUser ? 'GUARDAR EDICIÓN' : 'REGISTRAR OPERARIO'}</Text>
                </TouchableOpacity>
            </View>

            <FlatList 
                data={users}
                renderItem={renderItem}
                keyExtractor={item => item.id?.toString() || Math.random().toString()}
                contentContainerStyle={{padding: 20}}
                onRefresh={fetchInitialData}
                refreshing={loading}
                ListEmptyComponent={<ActivityIndicator color={industrialRed} style={{marginTop: 50}} />}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { padding: 25, backgroundColor: '#000', borderBottomWidth: 3, borderBottomColor: '#D32F2F', alignItems: 'center' },
    headerTitle: { color: '#FFF', fontSize: 13, fontWeight: 'bold', letterSpacing: 2 },
    addUserForm: { padding: 20, backgroundColor: '#1E1E1E' },
    row: { flexDirection: 'row', alignItems: 'center' },
    input: { backgroundColor: '#000', padding: 15, borderRadius: 10, color: '#FFF', borderWidth: 1, borderColor: '#333', fontSize: 12 },
    roleBtn: { paddingVertical: 10, paddingHorizontal: 15, backgroundColor: '#000', borderRadius: 8, borderWidth: 1, borderColor: '#333', marginRight: 8 },
    roleText: { color: '#444', fontWeight: 'bold', fontSize: 9 },
    btnAdd: { backgroundColor: '#D32F2F', padding: 18, borderRadius: 10, alignItems: 'center' },
    btnAddText: { color: '#FFF', fontWeight: 'bold', fontSize: 13, letterSpacing: 1 },
    userCard: { backgroundColor: '#1E1E1E', padding: 20, borderRadius: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#222' },
    userInfo: { flex: 1 },
    userName: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
    roleRow: { flexDirection: 'row', marginTop: 5, alignItems: 'center' },
    userRoleText: { color: '#888', fontSize: 9, fontWeight: 'bold', letterSpacing: 1 },
    pinText: { color: '#444', fontSize: 9 },
    actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
    iconBtn: { marginLeft: 15 }
});
