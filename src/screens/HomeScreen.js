import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator, TouchableOpacity, Switch, KeyboardAvoidingView, Platform, SafeAreaView, Keyboard, Modal, FlatList } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { sheetsAPI } from '../api/sheets';
import { KILL_SWITCH_URL } from '../api/config';
import { Search, Save } from 'lucide-react-native';

export default function HomeScreen() {
    const [sheets, setSheets] = useState([]);
    const [selectedSheet, setSelectedSheet] = useState('');
    const [allSheetsData, setAllSheetsData] = useState({}); // Memoria caché de todas las hojas
    const [sheetData, setSheetData] = useState([]);

    const [searchTerm, setSearchTerm] = useState(''); // El valor F seleccionado en el Picker
    const [selectedRow, setSelectedRow] = useState(null); // La fila específica a editar

    // Form fields
    const [isVerified, setIsVerified] = useState(false);
    const [numberValue, setNumberValue] = useState('');

    // Status
    const [loading, setLoading] = useState(true);
    const [fetchingData, setFetchingData] = useState(false);
    const [saving, setSaving] = useState(false);

    // Switch Kill State
    const [appKilled, setAppKilled] = useState(false);
    const [killMessage, setKillMessage] = useState('');

    // Custom Alert
    const [customAlert, setCustomAlert] = useState({ visible: false, title: '', message: '' });

    // Custom Dropdowns
    const [sheetDropdownVisible, setSheetDropdownVisible] = useState(false);
    const [fValueDropdownVisible, setFValueDropdownVisible] = useState(false);

    const showAlert = (title, message) => {
        setCustomAlert({ visible: true, title, message });
    };

    const hideAlert = () => {
        setCustomAlert({ visible: false, title: '', message: '' });
    };

    useEffect(() => {
        loadInitialData();
    }, []);

    const loadInitialData = async () => {
        try {
            setLoading(true);

            // 0. Validación de Muerte Súbita Remota (Kill Switch)
            if (KILL_SWITCH_URL && String(KILL_SWITCH_URL).trim() !== "") {
                try {
                    // Limpiamos la URL de Gist para que apunte siempre al archivo vivo y no a un Commit Estático (Hash)
                    // Ej. Elimina /raw/7ba954ddcd36.../interruptor.json dejándolo en /raw/interruptor.json
                    const activeUrl = KILL_SWITCH_URL.replace(/\/raw\/[a-f0-9]+\//i, '/raw/');

                    const ksResponse = await fetch(activeUrl, { cache: 'no-store' });
                    const ksText = await ksResponse.text();

                    // Si el gist dice 'false', o tiene el JSON {"active": false}, matamos la app.
                    if (ksText.includes('"active": false') || ksText.trim().toLowerCase() === 'false') {
                        setAppKilled(true);

                        // Intentamos extraer un posible mensaje personalizado del Gist
                        let msg = "Acceso bloqueado por el Administrador.";
                        try {
                            const parsed = JSON.parse(ksText);
                            if (parsed.message) msg = parsed.message;
                        } catch (e) { }

                        setKillMessage(msg);
                        setLoading(false);
                        return; // Aborta la carga de datos y la función entera
                    }
                } catch (e) {
                    console.error("Error al contactar Kill Switch, permitiendo acceso por fallo...", e);
                }
            }

            const data = await sheetsAPI.getInitialData();

            // Ignoramos la primera hoja del documento (Índice 0)
            const filteredSheetNames = data.sheetNames.length > 1 ? data.sheetNames.slice(1) : [];

            setSheets(filteredSheetNames);
            setAllSheetsData(data.sheetsData);

            if (filteredSheetNames.length > 0) {
                const firstSheet = filteredSheetNames[0];
                setSelectedSheet(firstSheet);
                setSheetData(data.sheetsData[firstSheet] || []);
            }
        } catch (error) {
            showAlert("Error - Configuración", "Por favor, verifica la URL de la API o la conexión. Detalle: " + error.message);
        } finally {
            setLoading(false);
            setFetchingData(false);
        }
    };

    const handleSheetChange = (value) => {
        if (value && value !== selectedSheet) {
            setSelectedSheet(value);
            // Cambio de hoja instantáneo usando la memoria local
            setSheetData(allSheetsData[value] || []);

            // Reset de selecciones de formularios al cambiar de hoja
            setSelectedRow(null);
            setSearchTerm('');
            setIsVerified(false);
            setNumberValue('');
        }
    };

    // Obtener valores únicos de la Columna F para el nuevo Desplegable (Ignorando si están verificados en la opción desplegable en sí)
    const uniqueFValues = useMemo(() => {
        if (!sheetData || sheetData.length === 0) return [];
        // Filtramos para asegurar que haya datos reales
        const validItems = sheetData.filter(item => item.valueF && String(item.valueF).trim() !== "");
        // Extraer valores únicos usando Set (Asegurando string final)
        const uniqueKeys = [...new Set(validItems.map(item => String(item.valueF).trim()))];
        return uniqueKeys.sort();
    }, [sheetData]);

    // `manualData` se usa cuando llamamos a la función manualmente con datos frescos.
    // El `<Picker>` por defecto envía (itemValue, itemIndex), por lo que si `manualData` no es un array, usamos `sheetData`.
    const handleSelectValueF = (selectedValue, manualData) => {
        Keyboard.dismiss(); // <-- Prevenir crash del OS al cambiar el picker con teclado activo
        setSearchTerm(selectedValue);

        const dataToUse = Array.isArray(manualData) ? manualData : sheetData;

        if (!selectedValue) {
            setSelectedRow(null);
            setIsVerified(false);
            setNumberValue('');
            return;
        }

        const exactValue = String(selectedValue).trim();

        // Busca el primer registro de arriba hacia abajo que no esté verificado para seleccionar ese
        const firstUnverifiedRow = dataToUse.find(item =>
            String(item.valueF).trim() === exactValue && !item.isVerified
        );

        if (firstUnverifiedRow) {
            setSelectedRow(firstUnverifiedRow);
        } else {
            // Si ya todos están verificados, seleccionamos el último
            const allMatching = dataToUse.filter(item => String(item.valueF).trim() === exactValue);
            if (allMatching.length > 0) {
                setSelectedRow(allMatching[allMatching.length - 1]);
                showAlert("Aviso", "Todos los registros con este valor ya están verificados, se seleccionó el último.");
            } else {
                setSelectedRow(null);
            }
        }

        setIsVerified(false);
        setNumberValue('');
    };

    const handleSave = async () => {
        if (!selectedSheet || !selectedRow) {
            showAlert("Error", "Debes seleccionar un registro primero.");
            return;
        }

        if (!isVerified) {
            showAlert("¡ERROR!", "Habilita la verificación por favor.");
            return;
        }

        const exactRow = selectedRow; // Guardamos referencia por si cambia
        const exactSheet = selectedSheet;
        const exactSearch = searchTerm;
        const num = numberValue ? Number(numberValue) : '';

        // 1. Bloqueamos botón temporalmente
        setSaving(true);

        try {
            // 2. Espera síncrona a Google (Toma los 2-3 segundos solicitados por el usuario)
            const response = await sheetsAPI.updateRow(exactSheet, exactRow.rowIndex, isVerified, num);

            if (!response || !response.updated) {
                throw new Error("La API no confirmó la actualización.");
            }

            // 3. ACTUALIZACIÓN VISUAL (Lote guardado)
            // Extraemos la fila y el lote que REALMENTE se afectaron (importante si hubo concurrencia)
            const actualRowIndex = response.rowIndex || exactRow.rowIndex;
            const actualValueA = response.valueA || exactRow.valueA;

            const updatedSheetData = sheetData.map(item => {
                if (item.rowIndex === actualRowIndex) {
                    return { ...item, isVerified: isVerified, valueA: actualValueA };
                }
                return item;
            });

            setSheetData(updatedSheetData);

            setAllSheetsData(prev => ({
                ...prev,
                [exactSheet]: updatedSheetData
            }));

            // 4. Liberar el botón *inmediatamente* después del guardado (3 segundos)...
            setSaving(false);

            if (response.wasReassigned) {
                showAlert(
                    "🔄 ¡Auto-Reasignación!",
                    `El registro que leíste ya había sido verificado por alguien más.\n\nTus datos se guardaron a salvo en el siguiente libre:\n\nLote: ${actualValueA || "Sin dato"}`
                );
            } else {
                showAlert(
                    "¡Éxito!",
                    `Se guardó correctamente.\n\nLote: ${actualValueA || "Sin dato"}`
                );
            }

            // Transición a la siguiente fila
            handleSelectValueF(exactSearch, updatedSheetData);

            // 5. SINCRONIZACIÓN EN SEGUNDO PLANO (Desvinculada del botón "Guardar")
            sheetsAPI.getSheetData(exactSheet).then(freshData => {
                setAllSheetsData(prev => ({ ...prev, [exactSheet]: freshData }));
                setSheetData(freshData);
            }).catch(e => console.log("Fondo:", e));

        } catch (error) {
            setSaving(false); // Liberar si falla
            showAlert("Error", "No se pudo guardar: " + error.message);
        }
    };

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#e60000" />
                <Text style={{ marginTop: 10, color: 'white' }}>Conectando con Google Sheets...</Text>
            </View>
        );
    }

    if (appKilled) {
        return (
            <View style={styles.center}>
                <Text style={{ fontSize: 50, marginBottom: 10 }}>🛑</Text>
                <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#ff4d4d', marginBottom: 10, textAlign: 'center' }}>ACCESO DENEGADO</Text>
                <Text style={{ fontSize: 16, color: '#ccc', textAlign: 'center', paddingHorizontal: 30 }}>{killMessage}</Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : null}
            >
                <View style={styles.header}>
                    <Text style={styles.title}>Sistema de Importaciones</Text>
                </View>

                <View style={styles.content}>
                    <Text style={styles.label}>1. Selecciona Diámetro:</Text>
                    <TouchableOpacity
                        style={[styles.pickerContainer, { padding: 15, justifyContent: 'center' }]}
                        onPress={() => { if (!fetchingData && !saving) setSheetDropdownVisible(true); }}
                        disabled={fetchingData || saving}
                    >
                        <Text style={{ color: selectedSheet ? 'white' : '#888', fontSize: 16 }}>
                            {selectedSheet ? selectedSheet : "-- Seleccione un Diámetro --"}
                        </Text>
                    </TouchableOpacity>

                    {fetchingData && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 15 }}>
                            <ActivityIndicator size="small" color="#e60000" />
                            <Text style={{ marginLeft: 10, color: '#aaa' }}>Cargando datos de la hoja...</Text>
                        </View>
                    )}

                    <Text style={styles.label}>2. Selecciona Colada:</Text>
                    <TouchableOpacity
                        style={[styles.pickerContainer, { padding: 15, justifyContent: 'center' }]}
                        onPress={() => { if (!fetchingData && !saving && uniqueFValues.length > 0) setFValueDropdownVisible(true); }}
                        disabled={fetchingData || saving || uniqueFValues.length === 0}
                    >
                        <Text style={{ color: searchTerm ? 'white' : '#888', fontSize: 16 }}>
                            {searchTerm ? searchTerm : "-- Seleccione un Valor --"}
                        </Text>
                    </TouchableOpacity>

                    {!fetchingData && sheetData.length > 0 && uniqueFValues.length === 0 && (
                        <Text style={styles.noResults}>No hay datos válidos en esta hoja.</Text>
                    )}

                    {/* Formulario de actualización para el ítem seleccionado */}
                    {selectedRow && (
                        <View style={styles.formCard}>
                            <Text style={styles.selectedTitle}>Registro Seleccionado:</Text>
                            <Text style={styles.selectedValue}>{selectedRow.valueF}</Text>

                            <View style={styles.formRow}>
                                <Text style={styles.formLabel}>Verificación</Text>
                                <Switch
                                    value={isVerified}
                                    onValueChange={setIsVerified}
                                    trackColor={{ false: "#555", true: "#ff9999" }}
                                    thumbColor={isVerified ? "#e60000" : "#f4f3f4"}
                                    disabled={saving}
                                />
                            </View>

                            <View style={styles.formRow}>
                                <Text style={styles.formLabel}>
                                    Coil <Text style={{ fontWeight: 'normal', color: '#888', fontStyle: 'italic', fontSize: 13 }}>(Opcional)</Text>
                                </Text>
                                <TextInput
                                    style={styles.numberInput}
                                    value={numberValue}
                                    onChangeText={setNumberValue}
                                    keyboardType="numeric"
                                    placeholder="Ej. 100"
                                    placeholderTextColor="#888"
                                    editable={!saving}
                                />
                            </View>

                            <TouchableOpacity
                                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                                onPress={handleSave}
                                disabled={saving}
                            >
                                {saving ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <>
                                        <Save color="#fff" size={20} style={{ marginRight: 8 }} />
                                        <Text style={styles.saveButtonText}>Guardar Actualización</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </KeyboardAvoidingView>

            {/* CUSTOM DARK ALERT MODAL */}
            <Modal
                transparent={true}
                visible={customAlert.visible}
                animationType="fade"
                onRequestClose={hideAlert}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={[styles.modalTitle, customAlert.title.includes('RROR') && { color: '#ff4d4d' }]}>
                            {customAlert.title}
                        </Text>
                        <Text style={styles.modalMessage}>{customAlert.message}</Text>
                        <TouchableOpacity style={styles.modalButton} onPress={hideAlert}>
                            <Text style={styles.modalButtonText}>Aceptar</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* SHEET DROPDOWN MODAL */}
            <Modal visible={sheetDropdownVisible} transparent={true} animationType="fade" onRequestClose={() => setSheetDropdownVisible(false)}>
                <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPressOut={() => setSheetDropdownVisible(false)}>
                    <View style={styles.dropdownContent}>
                        <Text style={styles.dropdownTitle}>Seleccione un Diámetro</Text>
                        <FlatList
                            data={[{ label: '-- Seleccione un Diámetro --', value: '' }, ...sheets.map(s => ({ label: s, value: s }))]}
                            keyExtractor={(item) => item.value + 'sheet'}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.dropdownItem}
                                    onPress={() => {
                                        handleSheetChange(item.value);
                                        setSheetDropdownVisible(false);
                                    }}
                                >
                                    <Text style={[styles.dropdownItemText, selectedSheet === item.value && styles.dropdownItemSelectedText]}>{item.label}</Text>
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* F VALUE DROPDOWN MODAL */}
            <Modal visible={fValueDropdownVisible} transparent={true} animationType="fade" onRequestClose={() => setFValueDropdownVisible(false)}>
                <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPressOut={() => setFValueDropdownVisible(false)}>
                    <View style={styles.dropdownContent}>
                        <Text style={styles.dropdownTitle}>Selecciona Colada</Text>
                        <FlatList
                            data={[{ label: '-- Seleccione un Valor --', value: '' }, ...uniqueFValues.map(v => ({ label: v, value: v }))]}
                            keyExtractor={(item) => item.value + 'fval'}
                            renderItem={({ item }) => (
                                <TouchableOpacity
                                    style={styles.dropdownItem}
                                    onPress={() => {
                                        handleSelectValueF(item.value);
                                        setFValueDropdownVisible(false);
                                    }}
                                >
                                    <Text style={[styles.dropdownItemText, searchTerm === item.value && styles.dropdownItemSelectedText]}>{item.label}</Text>
                                </TouchableOpacity>
                            )}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>

        </SafeAreaView >
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' },
    header: { backgroundColor: '#B30000', padding: 20, paddingTop: 50, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#ff4d4d' },
    title: { color: 'white', fontSize: 22, fontWeight: 'bold' },
    content: { padding: 20, flex: 1 },
    label: { fontSize: 16, fontWeight: 'bold', color: '#e0e0e0', marginBottom: 8, marginTop: 10 },
    pickerContainer: { backgroundColor: '#1e1e1e', borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#333', overflow: 'hidden' },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e1e1e', borderRadius: 8, borderWidth: 1, borderColor: '#333', paddingHorizontal: 10, zIndex: 2 },
    searchIcon: { marginRight: 8 },
    searchInput: { flex: 1, paddingVertical: 12, fontSize: 16, color: 'white' },
    resultsContainer: { backgroundColor: '#1e1e1e', borderRadius: 8, borderWidth: 1, borderColor: '#333', maxHeight: 250, marginTop: -5, borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 2, zIndex: 1 },
    resultItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#333' },
    resultText: { fontSize: 16, color: 'white' },
    noResults: { padding: 15, color: '#aaa', textAlign: 'center' },
    formCard: { backgroundColor: '#1e1e1e', padding: 20, borderRadius: 12, marginTop: 20, borderWidth: 1, borderColor: '#333', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4 },
    selectedTitle: { fontSize: 14, color: '#aaa', marginBottom: 4 },
    selectedValue: { fontSize: 18, fontWeight: 'bold', color: '#ff4d4d', marginBottom: 20 },
    formRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    formLabel: { fontSize: 16, color: '#e0e0e0', flex: 1 },
    numberInput: { borderWidth: 1, borderColor: '#444', borderRadius: 8, padding: 10, fontSize: 16, width: 120, textAlign: 'right', color: 'white', backgroundColor: '#2c2c2c' },
    saveButton: { backgroundColor: '#cc0000', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderRadius: 8, marginTop: 10 },
    saveButtonDisabled: { backgroundColor: '#5c0000' },
    saveButtonText: { color: 'white', fontSize: 16, fontWeight: 'bold' },

    // Custom Modal Styles
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { backgroundColor: '#1e1e1e', padding: 24, borderRadius: 12, width: '85%', borderWidth: 1, borderColor: '#333', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 5, elevation: 6 },
    modalTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 12, textAlign: 'center' },
    modalMessage: { color: '#ccc', fontSize: 16, textAlign: 'center', marginBottom: 20, lineHeight: 22 },
    modalButton: { backgroundColor: '#B30000', paddingVertical: 12, paddingHorizontal: 30, borderRadius: 8, width: '100%' },
    modalButtonText: { color: 'white', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },

    // Custom Dropdown Styles
    dropdownOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
    dropdownContent: { backgroundColor: '#1e1e1e', borderRadius: 12, width: '80%', maxHeight: '70%', paddingVertical: 10, borderWidth: 1, borderColor: '#444' },
    dropdownTitle: { color: '#888', fontSize: 14, fontWeight: 'bold', textAlign: 'center', marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#333' },
    dropdownItem: { paddingVertical: 15, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#2c2c2c' },
    dropdownItemText: { color: 'white', fontSize: 16, textAlign: 'center' },
    dropdownItemSelectedText: { color: '#ff4d4d', fontWeight: 'bold' }
});
