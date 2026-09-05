import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import { sheetSyncService } from '../services/sheetSyncService';
import Mode1SequentialView from './Mode1SequentialView';
import Mode2CoilSearch from './Mode2CoilSearch';
import ExportView from './ExportView';
import AdminDashboardView from './AdminDashboardView';
import ErrorBoundary from '../components/ErrorBoundary';
import { LogOut, RefreshCw, Shield, Layers, Search, CheckCircle, CheckCircle2, Loader2, AlertCircle, AlertTriangle, Send, FileSpreadsheet, Settings, UploadCloud, Clock, ShieldCheck, Database } from 'lucide-react';

export default function MainDashboard() {
  const { user, operatorId, logout, checkPermission } = useAuth();
  
  // Vistas activas: 'verification' | 'reports' | 'admin'
  const [activeView, setActiveView] = useState('verification');
  
  // Estados de Verificación (Modo 1 & 2)
  const [selectedDiam, setSelectedDiam] = useState('');
  const [diameters, setDiameters] = useState([]);
  const [mode, setMode] = useState('sequential'); // 'sequential' (Modo 1) o 'search' (Modo 2)
  const [history, setHistory] = useState([]);
  
  // Estado de sincronización en vivo
  const [queueLength, setQueueLength] = useState(sheetSyncService.getQueueLength());
  
  // Estados de Carga y Feedback
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showFinalizeTurnModal, setShowFinalizeTurnModal] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [finalizingTurn, setFinalizingTurn] = useState(false);
  const [loadingDiams, setLoadingDiams] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [finalizeError, setFinalizeError] = useState('');
  const [finalizeSuccessMsg, setFinalizeSuccessMsg] = useState('');

  // Panel de Avance Global (Métricas exactas)
  const [metrics, setMetrics] = useState({ total: 0, verified: 0, pending: 0, efficiency: 0 });

  // Matriz de Jerarquía de Roles
  const userRole = (user?.rol || '').toLowerCase().trim();
  const isAdmin = userRole === 'admin' || userRole === 'administrador';
  const isSupervisor = userRole === 'supervisor';
  const isVerificador = userRole === 'verificador';
  const isDigitador = userRole === 'digitador';
  const isAuxiliar = userRole === 'auxiliar';

  const canAccessReports = isDigitador || isVerificador || isSupervisor || isAdmin;
  const canFinalizeTurn = isVerificador || isSupervisor || isAdmin;
  const isAdminOrSupervisor = isSupervisor || isAdmin;
  const canAccessAdmin = isAdmin;

  // Redirección de seguridad si la vista activa no está permitida para el rol
  useEffect(() => {
    if (activeView === 'reports' && !canAccessReports) {
      setActiveView('verification');
    }
    if (activeView === 'admin' && !canAccessAdmin) {
      setActiveView('verification');
    }
  }, [activeView, canAccessReports, canAccessAdmin]);

  // 1. Obtener diámetros y métricas en tiempo real
  useEffect(() => {
    fetchActiveDiameters(true);
    fetchMetrics();

    // Suscribirse a cambios del servicio de sincronización (sheetSyncService)
    const unsubscribeSync = sheetSyncService.subscribe((event, data) => {
      setQueueLength(sheetSyncService.getQueueLength());

      if (event === 'synced') {
        const { syncedIds } = data;
        setHistory((prev) =>
          prev.map((item) =>
            syncedIds.includes(item.id) ? { ...item, syncStatus: 'synced' } : item
          )
        );
      } else if (event === 'error') {
        setDashboardError(`Fallo al sincronizar lote de Sheets: ${data.error}`);
        setTimeout(() => setDashboardError(''), 5000);
      }
    });

    // Suscribirse en tiempo real a Supabase para actualizar diámetros activos y cambios de configuración
    const channel = supabase
      .channel('dashboard_realtime_diams')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'registros_importacion',
        },
        () => {
          fetchActiveDiameters(false);
          fetchMetrics();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_settings',
        },
        () => {
          fetchActiveDiameters(false);
        }
      )
      .subscribe();

    return () => {
      unsubscribeSync();
      supabase.removeChannel(channel);
    };
  }, []);

  // Refrescar diámetros automáticamente al navegar a la vista de verificación
  useEffect(() => {
    if (activeView === 'verification') {
      fetchActiveDiameters(false);
    }
  }, [activeView]);

  // Consulta exacta de métricas para el Panel de Avance Global
  const fetchMetrics = async () => {
    try {
      const [{ count: total, error: errTotal }, { count: verified, error: errVerif }] = await Promise.all([
        supabase
          .from('registros_importacion')
          .select('id', { count: 'exact', head: true }),
        supabase
          .from('registros_importacion')
          .select('id', { count: 'exact', head: true })
          .eq('is_verified', true)
      ]);

      if (errTotal) throw errTotal;
      if (errVerif) throw errVerif;

      const totalCount = typeof total === 'number' ? total : 0;
      const verifiedCount = typeof verified === 'number' ? verified : 0;
      const pendingCount = Math.max(0, totalCount - verifiedCount);
      const efficiency = totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0;

      setMetrics({
        total: totalCount,
        verified: verifiedCount,
        pending: pendingCount,
        efficiency
      });
    } catch (err) {
      console.error('Error calculando métricas globales en MainDashboard:', err.message);
    }
  };

  const fetchActiveDiameters = async (selectFirst = false) => {
    setLoadingDiams(true);
    try {
      // 1. Obtener diámetros configurados y visibles en app_settings
      let configuredSheets = [];
      const { data: settingsData, error: settingsError } = await supabase
        .from('app_settings')
        .select('active_sheets')
        .eq('id', 1)
        .single();

      if (!settingsError && settingsData?.active_sheets) {
        let list = [];
        if (Array.isArray(settingsData.active_sheets)) {
          list = settingsData.active_sheets;
        } else {
          try {
            list = JSON.parse(settingsData.active_sheets || '[]');
          } catch (e) {
            list = [];
          }
        }

        const ignoredKeywords = ['RESUMEN', 'DATOS', 'UNI DESCARGADAS', 'PORTADA', 'TOTAL'];
        configuredSheets = list
          .filter((s) => {
            const name = (typeof s === 'string' ? s : s.name || '').trim();
            const isVisible = typeof s === 'string' ? true : (s.visible !== false && s.enabled !== false);
            const isIgnored = ignoredKeywords.some((k) => name.toUpperCase().includes(k));
            return isVisible && !isIgnored && name.length > 0;
          })
          .map((s) => (typeof s === 'string' ? s.trim() : s.name.trim()));
      }

      // 2. Consultar registros_importacion para incluir cualquier medida existente en la BD
      let dbSheets = [];
      try {
        const { data: recordsData } = await supabase
          .from('registros_importacion')
          .select('sheet_name')
          .limit(2000);

        if (recordsData) {
          dbSheets = [...new Set(recordsData.map((d) => d.sheet_name))].filter(Boolean);
        }
      } catch (dbErr) {
        console.warn('Error consultando registros_importacion para diámetros:', dbErr);
      }

      // 3. Unir respetando el orden de configuración de hojas activas
      let combined = [];
      if (configuredSheets.length > 0) {
        combined = [...configuredSheets];
        dbSheets.forEach((sheet) => {
          if (!combined.includes(sheet)) {
            combined.push(sheet);
          }
        });
      } else {
        combined = dbSheets;
      }

      const uniqueDiams = [...new Set(combined)].filter(Boolean);
      setDiameters(uniqueDiams);

      if (uniqueDiams.length > 0) {
        if (selectFirst || !selectedDiam || !uniqueDiams.includes(selectedDiam)) {
          setSelectedDiam(uniqueDiams[0]);
        }
      } else {
        setSelectedDiam('');
      }
    } catch (err) {
      console.error('Error al cargar diámetros activos:', err.message);
    } finally {
      setLoadingDiams(false);
    }
  };

  // Callback ejecutado al realizar una verificación exitosa en Modo 1 o 2
  const handleVerifySuccess = (verifiedRecord) => {
    // Agregar al historial local de este turno marcado como "pending" (en cola)
    setHistory((prev) => [
      { ...verifiedRecord, syncStatus: 'pending' },
      ...prev
    ]);
    
    // Refrescar diámetros activos y métricas globales
    fetchActiveDiameters(false);
    fetchMetrics();
  };

  // Alternar entre Modo 1 y Modo 2 con liberación atómica de bobinas
  const handleModeChange = async (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    try {
      if (operatorId) {
        await supabase.rpc('release_operator_coils', { p_operator_id: operatorId });
      }
    } catch (e) {
      console.warn('Aviso: Error liberando bobinas al alternar modos:', e);
    }
  };

  // Cerrar sesión con flujo incondicional a prueba de fallos de red o RPC
  const handleConfirmCloseTurn = async () => {
    setFlushing(true);
    setDashboardError('');
    try {
      // 1. Intentar vaciar el buffer pendiente con timeout corto (1.5s) para no demorar la salida
      try {
        await Promise.race([
          sheetSyncService.flushQueue(),
          new Promise((resolve) => setTimeout(() => resolve({ success: false, timeout: true }), 1500))
        ]);
      } catch (syncErr) {
        console.warn('Aviso: Sincronización en salida no completada, continuando cierre:', syncErr);
      }
    } catch (err) {
      console.warn('Error en preparación de cierre de sesión:', err);
    } finally {
      // 2. El cierre de sesión NUNCA se detiene ni se cancela
      setShowCloseModal(false);
      setFlushing(false);
      await logout();
    }
  };

  // Finalizar turno forzando la inyección de todos los pendientes en Supabase a Google Drive (Admin / Supervisor / Verificador)
  const handleConfirmFinalizeTurn = async () => {
    setFinalizingTurn(true);
    setFinalizeError('');
    setDashboardError('');
    try {
      const result = await sheetSyncService.finalizeShiftSync();
      if (!result?.success) {
        const errorMsg = result?.error || 'No se pudo completar la sincronización con Google Drive.';
        setFinalizeError(errorMsg);
        setDashboardError(`Error al inyectar a Google Drive: ${errorMsg}`);
        return;
      }

      const count = result?.count ?? 0;
      const countInfo = count > 0 ? ` (${count} registros sincronizados)` : '';
      setShowFinalizeTurnModal(false);
      setFinalizeSuccessMsg(`Turno finalizado: Google Drive actualizado con éxito${countInfo}`);
      setTimeout(() => setFinalizeSuccessMsg(''), 6000);

      // Refrescar métricas y diámetros
      if (typeof fetchMetrics === 'function') await fetchMetrics();
      if (typeof fetchActiveDiameters === 'function') await fetchActiveDiameters(false);
    } catch (err) {
      console.error('Error finalizando turno hacia Google Drive:', err);
      const errMsg = err?.message || 'Error inesperado al sincronizar con Google Drive.';
      setFinalizeError(errMsg);
      setDashboardError(`Error al inyectar a Google Drive: ${errMsg}`);
    } finally {
      setFinalizingTurn(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header Turno */}
      <header className="bg-slate-950 p-4 border-b-2 border-red-600 flex flex-col md:flex-row justify-between items-center gap-4 shadow-lg">
        <div className="flex items-center space-x-3 w-full md:w-auto">
          <div className="w-10 h-10 bg-slate-900 border border-slate-700 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-widest text-red-500 uppercase">ENTERPRISE v4.8</h1>
            <p className="text-lg font-bold text-white leading-tight">{user?.nombre}</p>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-black tracking-wide">
              {user?.rol?.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Top Navbar Section & Control Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto justify-end">
          {/* Navigation Bar */}
          <nav className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveView('verification')}
              className={`px-4 py-2 rounded-lg text-xs font-black tracking-wider transition cursor-pointer ${
                activeView === 'verification'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-450 hover:text-white'
              }`}
            >
              VERIFICACIÓN
            </button>
            {canAccessReports && (
              <button
                onClick={() => setActiveView('reports')}
                className={`px-4 py-2 rounded-lg text-xs font-black tracking-wider transition flex items-center space-x-1.5 cursor-pointer ${
                  activeView === 'reports'
                    ? 'bg-slate-800 text-emerald-400'
                    : 'text-slate-450 hover:text-white'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>REPORTERÍA</span>
              </button>
            )}
            {canAccessAdmin && (
              <button
                onClick={() => setActiveView('admin')}
                className={`px-4 py-2 rounded-lg text-xs font-black tracking-wider transition flex items-center space-x-1.5 cursor-pointer ${
                  activeView === 'admin'
                    ? 'bg-slate-800 text-emerald-400'
                    : 'text-slate-450 hover:text-white'
                }`}
              >
                <Settings className="w-3.5 h-3.5" />
                <span>ADMINISTRACIÓN</span>
              </button>
            )}
          </nav>

          {/* Action Buttons */}
          <div className="flex items-center space-x-3">
            {canFinalizeTurn && (
              <button
                type="button"
                onClick={() => {
                  setFinalizeError('');
                  setShowFinalizeTurnModal(true);
                }}
                className="p-2.5 bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-400 border border-emerald-600/50 hover:border-emerald-500 rounded-xl transition duration-150 active:scale-95 flex items-center space-x-2 cursor-pointer shadow-md shadow-emerald-950/30"
                title="Finalizar turno y volcar datos a Google Drive"
              >
                <UploadCloud className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-black tracking-wider hidden sm:inline">Finalizar Turno</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCloseModal(true)}
              className="p-2.5 bg-slate-900 hover:bg-slate-800 text-red-400 border border-slate-800 hover:border-slate-700 rounded-xl transition duration-150 active:scale-95 flex items-center space-x-2 cursor-pointer"
              title="Cerrar sesión de operario"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-xs font-bold hidden sm:inline">Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 p-6 max-w-5xl w-full mx-auto flex flex-col space-y-6">
        
        {/* Panel de Avance Global (Visible para todos los roles) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          {/* Eficiencia */}
          <div className="bg-slate-800 border border-slate-700 p-4 sm:p-5 rounded-2xl sm:rounded-3xl flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[9px] sm:text-[10px] font-black text-slate-400 block tracking-wider uppercase">EFICIENCIA GLOBAL</span>
              <span className="text-2xl sm:text-3xl font-black text-white">{metrics.efficiency}%</span>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-900 border border-slate-700 rounded-xl sm:rounded-2xl flex items-center justify-center text-sky-400">
              <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>

          {/* Registros Totales */}
          <div className="bg-slate-800 border border-slate-700 p-4 sm:p-5 rounded-2xl sm:rounded-3xl flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[9px] sm:text-[10px] font-black text-slate-400 block tracking-wider uppercase">REGISTROS TOTALES</span>
              <span className="text-2xl sm:text-3xl font-black text-white">{metrics.total}</span>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-900 border border-slate-700 rounded-xl sm:rounded-2xl flex items-center justify-center text-indigo-400">
              <Database className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>

          {/* Verificados */}
          <div className="bg-slate-800 border border-slate-700 p-4 sm:p-5 rounded-2xl sm:rounded-3xl flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[9px] sm:text-[10px] font-black text-slate-400 block tracking-wider uppercase">VERIFICADOS</span>
              <span className="text-2xl sm:text-3xl font-black text-emerald-400">{metrics.verified}</span>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-900 border border-slate-700 rounded-xl sm:rounded-2xl flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>

          {/* Pendientes Planta */}
          <div className="bg-slate-800 border border-slate-700 p-4 sm:p-5 rounded-2xl sm:rounded-3xl flex items-center justify-between shadow-lg">
            <div>
              <span className="text-[9px] sm:text-[10px] font-black text-slate-400 block tracking-wider uppercase">PENDIENTES PLANTA</span>
              <span className="text-2xl sm:text-3xl font-black text-yellow-400">{metrics.pending}</span>
            </div>
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-900 border border-slate-700 rounded-xl sm:rounded-2xl flex items-center justify-center text-yellow-400">
              <Clock className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </div>
        </div>

        {/* Notificación de Éxito al Finalizar Turno */}
        {finalizeSuccessMsg && (
          <div className="bg-emerald-950/80 border border-emerald-500/60 text-emerald-200 text-sm px-4 py-3.5 rounded-2xl text-center font-bold tracking-wide flex items-center justify-center space-x-2 shadow-lg shadow-emerald-950/40">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span>{finalizeSuccessMsg}</span>
          </div>
        )}

        {/* Errores del Dashboard */}
        {dashboardError && (
          <div className="bg-red-950/60 border border-red-500/50 text-red-200 text-sm px-4 py-3 rounded-xl text-center font-bold tracking-wide animate-pulse flex items-center justify-center space-x-2">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <span>{dashboardError}</span>
          </div>
        )}

        {/* Renderizado Condicional de las Vistas */}
        {activeView === 'verification' && (
          <div className="space-y-6 flex-1 flex flex-col justify-start">
            {/* Selector de Modos (Tabs) con liberación atómica */}
            <div className="bg-slate-950 p-1 rounded-2xl border border-slate-850 flex grid grid-cols-2 gap-2 shadow-inner">
              <button
                type="button"
                onClick={() => handleModeChange('sequential')}
                className={`py-3.5 rounded-xl text-sm font-black tracking-wider transition-all duration-150 flex items-center justify-center space-x-2 cursor-pointer ${
                  mode === 'sequential'
                    ? 'bg-slate-800 text-emerald-400 border border-slate-700 shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>MODO 1: SECUENCIAL</span>
              </button>
              
              <button
                type="button"
                onClick={() => handleModeChange('search')}
                className={`py-3.5 rounded-xl text-sm font-black tracking-wider transition-all duration-150 flex items-center justify-center space-x-2 cursor-pointer ${
                  mode === 'search'
                    ? 'bg-slate-800 text-sky-400 border border-slate-700 shadow-md'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/40'
                }`}
              >
                <Search className="w-4 h-4" />
                <span>MODO 2: COLADA/COIL</span>
              </button>
            </div>

            {/* Selector de Diámetro Activo */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
                  <Layers className="w-4 h-4 mr-2 text-sky-400" />
                  Diámetro Activo Seleccionado
                </h2>
                <button
                  onClick={() => fetchActiveDiameters(false)}
                  className="p-1 text-slate-400 hover:text-white rounded transition duration-150"
                  title="Refrescar diámetros"
                  disabled={loadingDiams}
                >
                  <RefreshCw className={`w-4 h-4 ${loadingDiams ? 'animate-spin text-sky-400' : ''}`} />
                </button>
              </div>

              {(!diameters || diameters.length === 0) ? (
                <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 text-center text-slate-400 font-bold text-sm">
                  Sin registros pendientes de verificación en planta.
                </div>
              ) : (
                <div
                  className="flex space-x-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x overscroll-contain"
                  style={{
                    overflowX: 'auto',
                    touchAction: 'pan-x',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {diameters.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelectedDiam(d)}
                      className={`px-6 py-3 rounded-full text-sm font-black tracking-wider transition-all border whitespace-nowrap active:scale-95 cursor-pointer ${
                        selectedDiam === d
                          ? 'bg-sky-500 text-slate-900 border-sky-400 font-extrabold shadow-lg shadow-sky-500/20'
                          : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-750 hover:text-white'
                      }`}
                    >
                      {d.toUpperCase().includes('MM') ? d : `${d} MM`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Renderizado de Vistas según Modo */}
            {selectedDiam ? (
              <div className="flex-grow flex flex-col justify-center py-4">
                {mode === 'sequential' ? (
                  <Mode1SequentialView
                    selectedDiam={selectedDiam}
                    onVerifySuccess={handleVerifySuccess}
                  />
                ) : (
                  <Mode2CoilSearch
                    selectedDiam={selectedDiam}
                    onVerifySuccess={handleVerifySuccess}
                  />
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center items-center py-16 text-slate-500 font-bold text-sm uppercase">
                Selecciona o refresca un diámetro activo para operar.
              </div>
            )}

            {/* Historial Compartido del Turno (Solo visible en pestaña Verificación) */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-bold text-slate-400 tracking-widest uppercase">
                  AUDITADOS EN ESTE TURNO ({history?.length ?? 0})
                </h2>
                {(queueLength ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => sheetSyncService.flushQueue()}
                    className="text-xs font-black text-yellow-400 hover:text-yellow-350 tracking-wider flex items-center space-x-1 transition"
                  >
                    <span>FORZAR SINCRONIZACIÓN</span>
                    <RefreshCw className="w-3.5 h-3.5 ml-1 animate-spin" />
                  </button>
                )}
              </div>
              
              <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden">
                {(!history || history.length === 0) ? (
                  <div className="p-8 text-center text-xs text-slate-500 font-bold uppercase tracking-wider">
                    Ningún rollo verificado en este turno todavía.
                  </div>
                ) : (
                  <div
                    className="divide-y divide-slate-900 max-h-60 sm:max-h-72 overflow-y-auto touch-pan-y overscroll-contain"
                    style={{
                      overflowY: 'auto',
                      touchAction: 'pan-y',
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
                    {history.map((h, i) => (
                      <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-900/50 transition">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-white text-sm tracking-wide">{h.lote}</span>
                            {/* Estado de Sincronización en Badge */}
                            {h.syncStatus === 'synced' ? (
                              <span className="text-[9px] font-black px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 flex items-center space-x-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                <span>Sincronizado ✔</span>
                              </span>
                            ) : (
                              <span className="text-[9px] font-black px-2 py-0.5 rounded bg-yellow-950/60 border border-yellow-500/35 text-yellow-400 animate-pulse">
                                Pendiente sincronizar
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {h.sheet_name} MM | {h.sae || 'SAE'} | COIL: {h.coil || 'S/N'}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="font-black text-slate-200 text-sm block">
                            {h.peso ? parseFloat(h.peso).toLocaleString() : '0.00'} KG
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(h.verified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeView === 'reports' && canAccessReports && (
          <ErrorBoundary fallbackTitle="Error al cargar Reportería">
            <ExportView />
          </ErrorBoundary>
        )}

        {activeView === 'admin' && canAccessAdmin && (
          <ErrorBoundary fallbackTitle="Error en el Panel de Administración">
            <AdminDashboardView />
          </ErrorBoundary>
        )}

      </main>

      {/* Modal de Confirmación Cerrar Sesión */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex justify-center items-center p-6">
          <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-3xl p-8 shadow-2xl space-y-6">
            <div className="w-14 h-14 bg-red-950 border border-red-500/40 rounded-2xl flex items-center justify-center mx-auto text-red-500">
              <LogOut className="w-6 h-6" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-xl font-bold text-white tracking-wide">¿CONFIRMAR CIERRE DE SESIÓN?</h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                Se liberarán las bobinas que tengas asignadas para que queden disponibles para los demás operadores y se cerrará tu sesión de forma segura.
              </p>
            </div>

            <div className="flex flex-col space-y-3">
              <button
                type="button"
                onClick={handleConfirmCloseTurn}
                disabled={flushing}
                className="w-full py-4 bg-red-600 hover:bg-red-500 text-slate-900 rounded-2xl font-black tracking-widest text-sm transition flex items-center justify-center space-x-2 cursor-pointer"
              >
                {flushing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>CERRANDO SESIÓN...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span>CERRAR SESIÓN</span>
                  </>
                )}
              </button>
              
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                disabled={flushing}
                className="w-full py-4 bg-slate-700 hover:bg-slate-650 text-white rounded-2xl font-black tracking-widest text-sm transition cursor-pointer"
              >
                CANCELAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Confirmación Finalizar Turno (Admin / Supervisor / Verificador) */}
      {showFinalizeTurnModal && canFinalizeTurn && (
        <ErrorBoundary fallbackTitle="Error en el modal de Finalizar Turno">
          <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex justify-center items-center p-4 sm:p-6">
            <div className="w-full max-w-lg bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
              <div className="w-14 h-14 bg-emerald-950 border border-emerald-500/40 rounded-2xl flex items-center justify-center mx-auto text-emerald-400">
                <UploadCloud className="w-7 h-7" />
              </div>

              <div className="text-center space-y-2">
                <h3 className="text-xl font-bold text-white tracking-wide">¿FINALIZAR TURNO E INYECTAR A GOOGLE DRIVE?</h3>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Esta acción volcará todas las bobinas verificadas en la base de datos directamente a la hoja de cálculo de Google Drive para la reportería interna de planta.
                </p>
              </div>

              {/* Resumen del Turno con optional chaining y valores seguros por defecto */}
              <div className="bg-slate-900/80 border border-slate-700/80 rounded-2xl p-4 space-y-3">
                <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase border-b border-slate-800 pb-2 flex justify-between items-center">
                  <span>RESUMEN DEL TURNO</span>
                  <span className="text-emerald-400 font-mono">{user?.rol?.toUpperCase() ?? 'OPERADOR'}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-800/60 p-2.5 rounded-xl">
                    <span className="text-slate-400 text-[10px] block">Operario Activo:</span>
                    <span className="font-bold text-white truncate block">{user?.nombre ?? 'No identificado'}</span>
                  </div>
                  <div className="bg-slate-800/60 p-2.5 rounded-xl">
                    <span className="text-slate-400 text-[10px] block">Auditados en Sesión:</span>
                    <span className="font-bold text-emerald-400 font-mono">{history?.length ?? 0} bobinas</span>
                  </div>
                  <div className="bg-slate-800/60 p-2.5 rounded-xl">
                    <span className="text-slate-400 text-[10px] block">Pendientes en Planta:</span>
                    <span className="font-bold text-yellow-400 font-mono">{metrics?.pending ?? 0} bobinas</span>
                  </div>
                  <div className="bg-slate-800/60 p-2.5 rounded-xl">
                    <span className="text-slate-400 text-[10px] block">Eficiencia Global:</span>
                    <span className="font-bold text-sky-400 font-mono">{metrics?.efficiency ?? 0}%</span>
                  </div>
                </div>
              </div>

              {/* Mensaje de Error dentro del modal si falla write-verification */}
              {finalizeError && (
                <div className="bg-red-950/70 border border-red-500/60 text-red-200 text-xs p-4 rounded-2xl space-y-1.5 animate-pulse">
                  <div className="flex items-center space-x-2 font-bold text-red-400">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>Error al procesar sincronización:</span>
                  </div>
                  <p className="text-[11px] font-mono leading-relaxed pl-6">{finalizeError}</p>
                </div>
              )}

              <div className="flex flex-col space-y-3">
                <button
                  type="button"
                  onClick={handleConfirmFinalizeTurn}
                  disabled={finalizingTurn}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 rounded-2xl font-black tracking-widest text-sm transition flex items-center justify-center space-x-2 cursor-pointer shadow-lg shadow-emerald-500/20"
                >
                  {finalizingTurn ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-slate-900" />
                      <span>INYECTANDO A GOOGLE DRIVE...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5 text-slate-900" />
                      <span>{finalizeError ? 'REINTENTAR SINCRONIZACIÓN' : 'FINALIZAR TURNO Y ENVIAR'}</span>
                    </>
                  )}
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    setShowFinalizeTurnModal(false);
                    setFinalizeError('');
                  }}
                  disabled={finalizingTurn}
                  className="w-full py-4 bg-slate-700 hover:bg-slate-650 text-white rounded-2xl font-black tracking-widest text-sm transition cursor-pointer"
                >
                  CANCELAR
                </button>
              </div>
            </div>
          </div>
        </ErrorBoundary>
      )}
    </div>
  );
}
