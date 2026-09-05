import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { sheetSyncService } from '../services/sheetSyncService';
import { useAuth } from '../context/AuthContext';
import { Users, CheckCircle2, Clock, Plus, Trash2, ShieldCheck, Eye, EyeOff, Loader2, Database, RefreshCw, Folder, Save, ExternalLink, AlertCircle, AlertTriangle } from 'lucide-react';

export default function AdminDashboardView() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [activeSheets, setActiveSheets] = useState([]);
  const [settings, setSettings] = useState(null);

  // Formulario Usuario
  const [userName, setUserName] = useState('');
  const [userPin, setUserPin] = useState('');
  const [userRole, setUserRole] = useState('OPERADOR');
  const [editingUser, setEditingUser] = useState(null);

  // Configuración Google Sheet Activo (Carpeta de Drive / URL)
  const [driveFolderInput, setDriveFolderInput] = useState('');
  const [savingFolder, setSavingFolder] = useState(false);
  const [updatingSheet, setUpdatingSheet] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Contexto de autenticación y rol
  const { user } = useAuth();
  const isAdmin = (user?.rol || '').toLowerCase() === 'admin' || (user?.rol || '').toLowerCase() === 'administrador';

  // Modal para limpieza de embarque (Zona de Peligro)
  const [showClearShipmentModal, setShowClearShipmentModal] = useState(false);
  const [confirmDeleteInput, setConfirmDeleteInput] = useState('');
  const [clearingShipment, setClearingShipment] = useState(false);

  const roles = ['OPERADOR', 'ADMINISTRADOR', 'VERIFICADOR', 'SUPERVISOR', 'DIGITADOR', 'AUXILIAR'];

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      await Promise.all([
        fetchUsers(),
        fetchAppSettings()
      ]);
    } catch (err) {
      console.error('Error fetching admin data:', err.message);
      setErrorMsg('Fallo al sincronizar datos administrativos.');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('usuarios_app')
      .select('*')
      .order('nombre', { ascending: true });
    if (error) throw error;
    setUsers(data || []);
  };

  const fetchAppSettings = async () => {
    const { data, error } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .single();
    
    if (error) throw error;
    if (data) {
      setSettings(data);
      // Guardar en localStorage para que el syncService lo lea dinámicamente
      localStorage.setItem('active_spreadsheet_id', data.active_spreadsheet_id || '');

      // Extraer folder_id de drive_folder_id o active_sheet_name o localStorage
      const savedFolder = data.drive_folder_id || data.active_sheet_name || sheetSyncService.getDriveFolderId() || '';
      setDriveFolderInput(savedFolder);
      if (savedFolder) {
        sheetSyncService.saveDriveFolderId(savedFolder);
      }

      let list = [];
      if (Array.isArray(data.active_sheets)) {
        list = data.active_sheets;
      } else {
        try {
          list = JSON.parse(data.active_sheets || '[]');
        } catch (e) {
          list = [];
        }
      }
      // Normalizar lista a objetos { name, visible }
      const normalized = list.map((s) => 
        typeof s === 'string' ? { name: s, visible: true } : s
      );
      setActiveSheets(normalized);
    }
  };

  // Guardar configuración de Carpeta o Enlace de Drive en app_settings
  const handleSaveDriveFolder = async (e) => {
    if (e) e.preventDefault();
    setSavingFolder(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const folderVal = driveFolderInput.trim();
      sheetSyncService.saveDriveFolderId(folderVal);

      // Intentar guardar con drive_folder_id y fallback a active_sheet_name si la columna no existe en BD
      let saveError = null;
      try {
        const { error } = await supabase
          .from('app_settings')
          .update({
            drive_folder_id: folderVal,
            active_sheet_name: folderVal,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);
        saveError = error;
      } catch (err) {
        saveError = err;
      }

      // Si falló por no existir la columna drive_folder_id (PGRST204), actualizar solo active_sheet_name
      if (saveError && (saveError.code === 'PGRST204' || saveError.message?.includes('drive_folder_id'))) {
        const { error: fallbackError } = await supabase
          .from('app_settings')
          .update({
            active_sheet_name: folderVal,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);
        if (fallbackError) throw fallbackError;
      } else if (saveError) {
        throw saveError;
      }

      setSuccessMsg('Carpeta / Enlace de Drive guardado correctamente en configuración.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error('Error guardando configuración de Drive:', err);
      setErrorMsg(`Error al guardar configuración: ${err.message}`);
    } finally {
      setSavingFolder(false);
    }
  };

  // Sincronizar importación desde Drive mediante la Edge Function import-sheet
  const handleSyncFromDrive = async () => {
    setUpdatingSheet(true);
    setErrorMsg('');
    setSuccessMsg('');
    setSyncFeedback(null);
    try {
      const folderVal = driveFolderInput.trim() || settings?.drive_folder_id || settings?.active_sheet_name || sheetSyncService.getDriveFolderId();

      if (!folderVal) {
        throw new Error('Ingrese el ID o enlace de la Carpeta de Drive (o URL del archivo) antes de sincronizar.');
      }

      sheetSyncService.saveDriveFolderId(folderVal);

      const data = await sheetSyncService.syncImportFromDrive(folderVal);

      const msg = `Sincronizado: "${data.spreadsheet_name || 'Spreadsheet'}" (${data.total || 0} bobinas/lotes importados)`;
      setSuccessMsg(msg);
      setSyncFeedback({
        type: 'success',
        title: 'Sincronización Exitosa',
        message: msg,
        spreadsheetId: data.spreadsheet_id,
        spreadsheetName: data.spreadsheet_name,
        total: data.total
      });

      await fetchAppSettings();
      setTimeout(() => setSuccessMsg(''), 6000);
    } catch (err) {
      console.error('Error en sincronización desde Drive:', err);
      const msg = err.message || 'Error desconocido al conectar con Google Drive.';
      setErrorMsg(`Alerta: ${msg}`);
      setSyncFeedback({
        type: 'error',
        title: 'Error de Sincronización',
        message: msg
      });
    } finally {
      setUpdatingSheet(false);
    }
  };

  // Guardar/Actualizar Usuario
  const handleSaveUser = async (e) => {
    e.preventDefault();
    if (!userName.trim() || !userPin.trim()) {
      setErrorMsg('Complete todos los campos del formulario.');
      return;
    }
    if (userPin.length !== 4 || isNaN(userPin)) {
      setErrorMsg('El PIN debe ser estrictamente de 4 dígitos numéricos.');
      return;
    }

    const userData = {
      nombre: userName.toUpperCase().trim(),
      pin: userPin.trim(),
      rol: userRole,
      activo: true
    };

    try {
      if (editingUser) {
        // Editar
        const { error } = await supabase
          .from('usuarios_app')
          .update(userData)
          .eq('id', editingUser.id);
        if (error) throw error;
        setSuccessMsg(`Operario ${userData.nombre} actualizado.`);
      } else {
        // Alta
        const { error } = await supabase
          .from('usuarios_app')
          .insert([userData]);
        if (error) throw error;
        setSuccessMsg(`Operario ${userData.nombre} registrado con éxito.`);
      }

      setUserName('');
      setUserPin('');
      setUserRole('OPERADOR');
      setEditingUser(null);
      fetchUsers();
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setErrorMsg(`Error al guardar operario: ${err.message}`);
      setTimeout(() => setErrorMsg(''), 5000);
    }
  };

  // Toggle Suspensión de Personal (Confirmación estricta en Supabase)
  const handleToggleUserStatus = async (user) => {
    const nuevoEstado = !user.activo;
    try {
      const { data, error } = await supabase
        .from('usuarios_app')
        .update({ activo: nuevoEstado })
        .eq('id', user.id)
        .select();

      if (error) {
        console.error("Error al actualizar estado en Supabase:", error);
        alert("Error al cambiar estado en base de datos: " + error.message);
        return;
      }

      console.log("Respuesta Supabase suspension:", data);

      // Solo si Supabase confirmó el cambio:
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, activo: nuevoEstado } : u))
      );
      setSuccessMsg(`Operario ${user.nombre || user.Nombre || ''} ${nuevoEstado ? 'reactivado' : 'suspendido'} exitosamente.`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error("Error al actualizar estado en Supabase:", err);
      alert("Error al cambiar estado en base de datos: " + err.message);
    }
  };

  // Limpiar Datos de Embarque (Solo Administrador)
  const handleClearShipmentData = async () => {
    if (confirmDeleteInput.trim().toUpperCase() !== 'BORRAR') return;
    setClearingShipment(true);
    setErrorMsg('');
    try {
      const { error: delError } = await supabase
        .from('registros_importacion')
        .delete()
        .not('id', 'is', null);

      if (delError) throw delError;

      setShowClearShipmentModal(false);
      setConfirmDeleteInput('');
      setSuccessMsg('Datos del embarque eliminados exitosamente. El sistema está listo para un nuevo embarque.');
      setTimeout(() => setSuccessMsg(''), 6000);
    } catch (err) {
      console.error('Error al limpiar datos de embarque:', err);
      setErrorMsg(`Fallo al vaciar embarque: ${err.message}`);
    } finally {
      setClearingShipment(false);
    }
  };

  // Eliminar Personal
  const handleDeleteUser = async (userId) => {
    if (!window.confirm("¿Seguro que deseas eliminar a este usuario?")) return;

    try {
      const { data, error } = await supabase
        .from('usuarios_app')
        .delete()
        .eq('id', userId)
        .select();

      if (error) {
        console.error("Error al eliminar usuario en Supabase:", error);
        alert("No se pudo eliminar el usuario: " + error.message);
        return;
      }

      setUsers(prev => prev.filter(u => u.id !== userId));
      setSuccessMsg('Usuario eliminado exitosamente.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error("Error inesperado al eliminar usuario:", err);
      alert("No se pudo eliminar el usuario: " + (err?.message || err));
    }
  };

  // Toggle Visibilidad del Diámetro
  const handleToggleDiameterVisibility = async (index, currentVal) => {
    try {
      const updatedSheets = [...activeSheets];
      updatedSheets[index] = { 
        ...updatedSheets[index], 
        visible: !currentVal 
      };

      const { error } = await supabase
        .from('app_settings')
        .update({ active_sheets: updatedSheets })
        .eq('id', 1);

      if (error) throw error;

      setActiveSheets(updatedSheets);
      setSuccessMsg('Visibilidad de diámetros actualizada en planta.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg(`Fallo al cambiar visibilidad de diámetro: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Messages */}
      {errorMsg && (
        <div className="bg-red-950/40 border border-red-500/50 p-4 rounded-2xl text-red-400 text-xs font-bold shadow-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg('')} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-950/40 border border-emerald-500/50 p-4 rounded-2xl text-emerald-400 text-xs font-bold shadow-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-emerald-200">✕</button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-sky-400" />
          <span className="text-xs font-mono tracking-widest uppercase">Cargando Panel de Control...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Col 1 & 2: User Catalog & Add/Edit User */}
          <div className="lg:col-span-2 space-y-6">
            {/* Form */}
            <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl">
              <div className="border-b border-slate-700 pb-3 mb-4 flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
                  <Users className="w-4 h-4 mr-2 text-sky-400" />
                  {editingUser ? 'Modificar Operario' : 'Alta de Nuevo Operario'}
                </h3>
                {editingUser && (
                  <span className="text-[10px] bg-yellow-950/60 border border-yellow-500/40 text-yellow-400 px-2 py-0.5 rounded font-bold">
                    MODO EDICIÓN
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveUser} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    NOMBRE COMPLETO
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Ej. JUAN PÉREZ"
                    className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 font-bold focus:border-sky-400 focus:outline-none uppercase"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    PIN ACCESO (4 DÍGITOS)
                  </label>
                  <input
                    type="password"
                    maxLength={4}
                    value={userPin}
                    onChange={(e) => setUserPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 font-mono font-bold tracking-widest text-center focus:border-sky-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block mb-1">
                    ROL / PRIVILEGIO
                  </label>
                  <select
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value)}
                    className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 font-bold focus:border-sky-400 focus:outline-none appearance-none"
                  >
                    {roles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3 flex justify-end space-x-3 pt-2">
                  {editingUser && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingUser(null);
                        setUserName('');
                        setUserPin('');
                        setUserRole('OPERADOR');
                      }}
                      className="px-6 py-3 border border-slate-650 hover:bg-slate-700 text-slate-350 rounded-xl text-xs font-black tracking-wider transition"
                    >
                      CANCELAR
                    </button>
                  )}
                  <button
                    type="submit"
                    className="px-6 py-3 bg-sky-500 hover:bg-sky-400 text-slate-900 rounded-xl text-xs font-black tracking-wider transition shadow-lg shadow-sky-500/10"
                  >
                    {editingUser ? 'GUARDAR CAMBIOS' : 'REGISTRAR OPERARIO'}
                  </button>
                </div>
              </form>
            </div>

            {/* User List */}
            <div className="bg-slate-800 rounded-3xl border border-slate-700 overflow-hidden shadow-xl">
              <div className="p-4 bg-slate-950/30 border-b border-slate-700">
                <span className="text-[10px] font-black text-slate-455 tracking-widest uppercase">CATÁLOGO DE PERSONAL</span>
              </div>
              <div className="divide-y divide-slate-700/50 max-h-96 overflow-y-auto">
                {users.map((item) => {
                  const role = (item.rol || '').toUpperCase();
                  const isSuspended = role === 'SUSPENDIDO' || item.activo === false;

                  return (
                    <div
                      key={item.id}
                      className={`p-4 flex items-center justify-between hover:bg-slate-900/30 transition ${
                        isSuspended ? 'bg-red-950/15 border-l-4 border-red-600' : ''
                      }`}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className={`font-bold text-sm ${isSuspended ? 'text-slate-400 line-through' : 'text-white'}`}>
                            {item.nombre || item.Nombre}
                          </span>
                          {isSuspended && (
                            <span className="text-[8px] bg-red-950 border border-red-500/40 text-red-400 px-1.5 py-0.5 rounded font-black tracking-wider uppercase">
                              BAJA
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">
                          {isSuspended ? 'Rango Suspendido' : role} • PIN: {item.pin}
                        </span>
                      </div>

                      <div className="flex items-center space-x-3">
                        {/* Editar */}
                        <button
                          onClick={() => {
                            setEditingUser(item);
                            setUserName(item.nombre || item.Nombre || '');
                            setUserPin(item.pin || '');
                            setUserRole(role === 'SUSPENDIDO' ? 'OPERADOR' : role);
                          }}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-650 rounded-lg text-slate-350 text-[10px] font-bold transition"
                        >
                          EDITAR
                        </button>

                        {/* Suspender/Activar */}
                        <button
                          type="button"
                          onClick={() => handleToggleUserStatus(item)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider transition cursor-pointer ${
                            isSuspended
                              ? 'bg-emerald-600/25 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-600/40'
                              : 'bg-red-600/25 border border-red-500/50 text-red-400 hover:bg-red-600/40'
                          }`}
                        >
                          {isSuspended ? 'ACTIVAR' : 'SUSPENDER'}
                        </button>

                        {/* Eliminar */}
                        <button
                          onClick={() => handleDeleteUser(item.id, item.nombre || item.Nombre)}
                          className="p-2 text-slate-555 hover:text-red-400 rounded-lg transition"
                          title="Eliminar operario"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Col 3: Settings & Diameter control */}
          <div className="space-y-6">
            {/* active spreadsheet url manager */}
            <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl space-y-4">
              <div className="border-b border-slate-700 pb-3 flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
                  <Database className="w-4 h-4 mr-2 text-sky-400" />
                  Google Sheet Activo
                </h3>
                {settings?.active_spreadsheet_id && (
                  <span className="text-[9px] font-mono bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded font-bold">
                    VINCULADO
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Configure la carpeta de Google Drive donde se depositan las hojas de importación. El sistema detectará automáticamente el archivo de cálculo más reciente en esa carpeta y sincronizará sus diámetros y lotes.
              </p>

              {/* Input Carpeta Drive o URL directa */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center">
                    <Folder className="w-3.5 h-3.5 mr-1.5 text-sky-400" />
                    Carpeta de Drive (ID o Enlace)
                  </span>
                  <span className="text-[9px] text-slate-500 font-normal">
                    o URL directa
                  </span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={driveFolderInput}
                    onChange={(e) => setDriveFolderInput(e.target.value)}
                    placeholder="ID de carpeta o https://drive.google.com/..."
                    className="flex-1 bg-slate-950 text-white text-xs rounded-xl border border-slate-700 p-3 font-mono focus:border-sky-400 focus:outline-none placeholder-slate-600 transition"
                  />
                  <button
                    type="button"
                    onClick={handleSaveDriveFolder}
                    disabled={savingFolder}
                    className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-bold tracking-wider transition flex items-center space-x-1.5 shrink-0"
                    title="Guardar ID en base de datos"
                  >
                    {savingFolder ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span className="hidden sm:inline">GUARDAR</span>
                  </button>
                </div>
                <p className="text-[10px] text-slate-500">
                  Guarda en configuración persistente de la planta (<code className="text-sky-400">app_settings</code>).
                </p>
              </div>

              {/* Sheet activo actual info */}
              {settings?.active_spreadsheet_id && (
                <div className="bg-slate-950/70 border border-slate-700/70 rounded-xl p-3 text-[11px] space-y-1">
                  <div className="text-slate-400 font-mono text-[9px] uppercase tracking-wider">
                    Spreadsheet Activo en Planta:
                  </div>
                  <div className="text-slate-200 font-mono text-[10px] break-all flex items-center justify-between">
                    <span>ID: {settings.active_spreadsheet_id}</span>
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${settings.active_spreadsheet_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:text-sky-300 ml-2 shrink-0 flex items-center text-[10px]"
                    >
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </a>
                  </div>
                </div>
              )}

              {/* Feedback dinámico tras sincronizar */}
              {syncFeedback && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1 ${
                    syncFeedback.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-red-950/40 border-red-500/40 text-red-300'
                  }`}
                >
                  <div className="font-bold flex items-center space-x-1.5">
                    {syncFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                    )}
                    <span>{syncFeedback.title}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{syncFeedback.message}</p>
                </div>
              )}

              {/* Botón principal de sincronización */}
              <button
                type="button"
                onClick={handleSyncFromDrive}
                disabled={updatingSheet}
                className="w-full py-4 bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 rounded-2xl text-xs font-black tracking-widest transition flex items-center justify-center space-x-2 shadow-lg shadow-sky-500/10 cursor-pointer disabled:cursor-not-allowed"
              >
                {updatingSheet ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>BUSCANDO Y SINCRONIZANDO EN DRIVE...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-5 h-5" />
                    <span>SINCRONIZAR IMPORTACIÓN DESDE DRIVE</span>
                  </>
                )}
              </button>
            </div>

            {/* Diameter Control */}
            <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl space-y-4">
              <div className="border-b border-slate-700 pb-3 flex justify-between items-center">
                <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
                  <Eye className="w-4 h-4 mr-2 text-sky-400" />
                  Control de Diámetros
                </h3>
              </div>
              
              <p className="text-xs text-slate-500 leading-relaxed">
                Active o desactive los diámetros de alambrón. Los diámetros desactivados se ocultarán en el menú de verificación en vivo de planta.
              </p>

              <div className="divide-y divide-slate-700/50 pt-2">
                {activeSheets.map((sheet, index) => {
                  const isVisible = sheet.visible !== false;
                  return (
                    <div key={index} className="py-3.5 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-slate-200 block text-sm">{sheet.name} MM</span>
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                          HOJA DE PRODUCCIÓN
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleDiameterVisibility(index, isVisible)}
                        className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-all duration-300 ${
                          isVisible ? 'bg-sky-500 justify-end' : 'bg-slate-950 justify-start'
                        }`}
                      >
                        <div className="bg-white w-4 h-4 rounded-full shadow-md" />
                      </button>
                    </div>
                  );
                })}
                {activeSheets.length === 0 && (
                  <div className="py-6 text-center text-xs text-slate-500 uppercase tracking-widest font-black">
                    Cargando diámetros...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zona de Peligro: Gestión y Limpieza de Embarque (Solo Administrador) */}
      {isAdmin && (
        <div className="bg-red-950/20 border-2 border-red-900/60 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-3 text-red-400 border-b border-red-900/40 pb-3">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 className="text-xs font-black tracking-widest uppercase">
              Zona de Peligro / Gestión de Embarque
            </h3>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-bold text-white">
                Limpiar Datos de Embarque
              </p>
              <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
                Elimina permanentemente todas las bobinas y registros del embarque actual (<code className="text-red-300">registros_importacion</code>). Las cuentas de usuario y configuraciones de planta se mantendrán intactas. Use esta opción antes de cargar un nuevo embarque.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setConfirmDeleteInput('');
                setShowClearShipmentModal(true);
              }}
              className="px-5 py-3 bg-red-600/20 hover:bg-red-600 border border-red-500/60 hover:border-red-500 text-red-400 hover:text-white rounded-xl text-xs font-black tracking-wider transition duration-150 active:scale-95 flex items-center justify-center space-x-2 shrink-0 cursor-pointer shadow-lg shadow-red-950/50"
            >
              <Trash2 className="w-4 h-4" />
              <span>LIMPIAR DATOS DE EMBARQUE</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal Confirmación Estricta: Limpiar Embarque */}
      {showClearShipmentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex justify-center items-center p-6">
          <div className="w-full max-w-md bg-slate-800 border-2 border-red-600/60 rounded-3xl p-8 shadow-2xl space-y-6">
            <div className="w-14 h-14 bg-red-950 border border-red-500/60 rounded-2xl flex items-center justify-center mx-auto text-red-400">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-black text-white tracking-wide uppercase">
                ¿LIMPIAR DATOS DE EMBARQUE?
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Esta acción eliminará todos los rollos y registros de verificación de la base de datos para preparar el nuevo embarque. Esta operación <span className="text-red-400 font-bold">NO SE PUEDE DESHACER</span>.
              </p>
              <p className="text-xs text-slate-400 pt-2">
                Para confirmar, escribe la palabra <strong className="text-red-400 font-black">BORRAR</strong>:
              </p>
            </div>

            <div className="space-y-3">
              <input
                type="text"
                value={confirmDeleteInput}
                onChange={(e) => setConfirmDeleteInput(e.target.value)}
                placeholder="Escribe BORRAR"
                autoFocus
                className="w-full bg-slate-950 text-white text-center text-sm font-black tracking-widest rounded-xl border border-red-500/50 p-3.5 focus:border-red-400 focus:outline-none placeholder-slate-600 uppercase"
              />

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowClearShipmentModal(false);
                    setConfirmDeleteInput('');
                  }}
                  disabled={clearingShipment}
                  className="py-3 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  CANCELAR
                </button>

                <button
                  type="button"
                  onClick={handleClearShipmentData}
                  disabled={confirmDeleteInput.trim().toUpperCase() !== 'BORRAR' || clearingShipment}
                  className="py-3 bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 disabled:border-slate-700 border border-red-500 text-white rounded-xl text-xs font-black tracking-wider transition cursor-pointer disabled:cursor-not-allowed shadow-lg shadow-red-600/30 flex items-center justify-center space-x-1"
                >
                  {clearingShipment ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      <span>BORRANDO...</span>
                    </>
                  ) : (
                    <span>CONFIRMAR Y VACIAR</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
