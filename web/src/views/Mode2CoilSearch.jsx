import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { sheetSyncService } from '../services/sheetSyncService';
import {
  Search,
  CheckCircle,
  Barcode,
  AlertTriangle,
  Loader2,
  X,
  Flame,
  Scale,
  Sparkles
} from 'lucide-react';

export default function Mode2CoilSearch({ selectedDiam, onVerifySuccess }) {
  const { user, operatorId: authOperatorId } = useAuth();
  const operatorId = authOperatorId || user?.id || user?.nombre || (typeof localStorage !== 'undefined' ? localStorage.getItem('device_session_id') : null) || 'operador';

  // Búsqueda bajo demanda (On-Demand)
  const [searchColada, setSearchColada] = useState('');
  const [searchCoil, setSearchCoil] = useState('');
  const [searching, setSearching] = useState(false);

  // Bobina seleccionada / reservada para confirmación
  const [selectedRoll, setSelectedRoll] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Mensajes de retroalimentación
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Referencia a la reserva activa del operador en este modo
  const activeReservationIdRef = useRef(null);

  // Liberar la reserva en Supabase para una bobina específica
  const releaseReservation = async (rollId) => {
    if (!rollId) return;
    try {
      await supabase
        .from('registros_importacion')
        .update({ reserved_by: null, reserved_at: null })
        .eq('id', rollId)
        .eq('is_verified', false);
    } catch (e) {
      console.warn('Aviso: Error liberando reserva de bobina en Supabase:', e);
    }
  };

  // Al desmontar el componente (salir del modo), limpiar cualquier reserva activa
  useEffect(() => {
    return () => {
      if (activeReservationIdRef.current) {
        const idToFree = activeReservationIdRef.current;
        activeReservationIdRef.current = null;
        releaseReservation(idToFree);
      }
    };
  }, []);

  // Limpiar selección y estados al cambiar de calibre/diámetro
  useEffect(() => {
    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      releaseReservation(idToFree);
    }
    setSelectedRoll(null);
    setError('');
    setSuccessMsg('');
    setSearchColada('');
    setSearchCoil('');
  }, [selectedDiam]);

  // Búsqueda directa e indexada on-demand (limitada a 1 resultado)
  const handleSearch = async (e) => {
    if (e) e.preventDefault();

    const coladaTrimmed = searchColada.trim();
    const coilTrimmed = searchCoil.trim();

    if (!coladaTrimmed && !coilTrimmed) {
      setError('Ingrese el Código de Colada / Heat o el Número de Bobina / Coil para buscar.');
      return;
    }

    if (!selectedDiam) {
      setError('Seleccione un calibre activo antes de realizar la búsqueda.');
      return;
    }

    // Si ya teníamos otra bobina reservada en este modo, liberarla primero
    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      await releaseReservation(idToFree);
    }

    setSearching(true);
    setError('');
    setSuccessMsg('');
    setSelectedRoll(null);

    try {
      // 1. Consulta directa, indexada y limitada estrictamente a 1 resultado libre
      let query = supabase
        .from('registros_importacion')
        .select('*')
        .eq('sheet_name', selectedDiam)
        .eq('is_verified', false)
        .is('reserved_by', null);

      if (coladaTrimmed) {
        query = query.ilike('colada', `%${coladaTrimmed}%`);
      }
      if (coilTrimmed) {
        query = query.ilike('coil', `%${coilTrimmed}%`);
      }

      const { data, error: searchError } = await query
        .order('lote', { ascending: true })
        .limit(1);

      if (searchError) {
        console.error('Error en búsqueda on-demand de bobina:', searchError);
        setError('Error al consultar el servidor: ' + searchError.message);
        return;
      }

      // Si no existe o ya fue verificada / reservada por otro usuario:
      if (!data || data.length === 0) {
        setError('Bobina no encontrada o ya verificada por otro operario');
        setSelectedRoll(null);
        return;
      }

      const candidate = data[0];
      const operatorIdentifier = user?.id ? String(user.id) : String(operatorId);

      // 2. Asignación atómica al operario actual (evita condiciones de carrera entre terminales)
      const nowIso = new Date().toISOString();
      const { data: updateData, error: updateError } = await supabase
        .from('registros_importacion')
        .update({
          reserved_by: operatorIdentifier,
          reserved_at: nowIso
        })
        .eq('id', candidate.id)
        .eq('is_verified', false)
        .is('reserved_by', null)
        .select();

      if (updateError || !updateData || updateData.length === 0) {
        setError('Bobina no encontrada o ya verificada por otro operario');
        setSelectedRoll(null);
        activeReservationIdRef.current = null;
        return;
      }

      const claimedRoll = updateData[0];
      activeReservationIdRef.current = claimedRoll.id;
      setSelectedRoll(claimedRoll);
      setError('');

      // Retroalimentación háptica en escaneo exitoso
      if (navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (vibErr) {}
      }
    } catch (err) {
      console.error('Excepción al buscar bobina on-demand:', err);
      setError('Error inesperado al buscar la bobina.');
    } finally {
      setSearching(false);
    }
  };

  // Cancelar selección activa y liberar la reserva
  const handleCancelSelection = async () => {
    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      await releaseReservation(idToFree);
    }
    setSelectedRoll(null);
    setError('');
  };

  // Confirmar y verificar la bobina reclamada
  const handleVerify = async () => {
    if (!selectedRoll) return;

    setConfirming(true);
    setError('');
    setSuccessMsg('');

    const targetId = selectedRoll.id;
    const verifyTimestamp = new Date().toISOString();
    const operatorName = user?.nombre || 'Operador';

    // Feedback táctil
    if (navigator.vibrate) {
      try {
        navigator.vibrate(100);
      } catch (e) {}
    }

    try {
      // 1. UPDATE en Supabase marcando is_verified = true y liberando la reserva
      const updatePayload = {
        is_verified: true,
        verified_at: verifyTimestamp,
        verified_by: operatorName,
        verification_mode: 'Modo 2',
        reserved_by: null,
        reserved_at: null,
        updated_at: verifyTimestamp,
      };

      let { error: updateError } = await supabase
        .from('registros_importacion')
        .update(updatePayload)
        .eq('id', targetId);

      // Fallback si la columna verification_mode aún no existe en la base de datos
      if (updateError && (updateError.code === 'PGRST204' || updateError.message?.includes('verification_mode'))) {
        delete updatePayload.verification_mode;
        const { error: fallbackErr } = await supabase
          .from('registros_importacion')
          .update(updatePayload)
          .eq('id', targetId);
        updateError = fallbackErr;
      }

      if (updateError) {
        console.error('Error al verificar bobina en Supabase:', updateError);
        setError('Error al guardar verificación: ' + updateError.message);
        return;
      }

      // 2. Crear el registro verificado
      const verifiedRecord = {
        ...selectedRoll,
        is_verified: true,
        verified_at: verifyTimestamp,
        verified_by: operatorName,
        verification_mode: 'Modo 2',
        sheet_name: selectedRoll.sheet_name || selectedDiam,
        spreadsheet_id: selectedRoll.spreadsheet_id,
      };

      // 3. Agregar a la cola de sincronización
      sheetSyncService.addToQueue(verifiedRecord);

      // 4. Notificar al Dashboard principal
      if (onVerifySuccess) {
        onVerifySuccess(verifiedRecord);
      }

      // 5. Limpieza de estado local
      activeReservationIdRef.current = null;
      setSelectedRoll(null);
      setSearchColada('');
      setSearchCoil('');
      setSuccessMsg(`¡Bobina Lote ${selectedRoll.lote || ''} verificada con éxito!`);
    } catch (err) {
      console.error('Error al confirmar verificación en Modo 2:', err);
      setError('Error al procesar la confirmación: ' + err.message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Formulario de Búsqueda Indexada On-Demand */}
      <form onSubmit={handleSearch} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Barcode className="w-5 h-5 text-sky-400" />
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
              Búsqueda y Escaneo Directo (Modo 2)
            </h3>
          </div>
          <span className="text-[10px] text-slate-400 font-bold bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60 self-start sm:self-auto">
            Calibre: <strong className="text-sky-400">{selectedDiam || '---'} MM</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Input Código de Colada / Heat */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black text-slate-400 tracking-wider uppercase">
              Código de Colada / Heat
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchColada}
                onChange={(e) => setSearchColada(e.target.value)}
                placeholder="Ej. COL-8924 / 45012..."
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3.5 pl-11 font-bold text-sm focus:border-sky-400 focus:outline-none transition"
                disabled={searching || confirming}
                autoComplete="off"
              />
              <Flame className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {searchColada && (
                <button
                  type="button"
                  onClick={() => setSearchColada('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Input Número de Bobina / Coil */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-black text-slate-400 tracking-wider uppercase">
              Número de Bobina / Coil
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchCoil}
                onChange={(e) => setSearchCoil(e.target.value)}
                placeholder="Ej. C-10492 / B-42..."
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3.5 pl-11 font-bold text-sm focus:border-sky-400 focus:outline-none transition"
                disabled={searching || confirming}
                autoComplete="off"
              />
              <Barcode className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {searchCoil && (
                <button
                  type="button"
                  onClick={() => setSearchCoil('')}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Botón de Acción Principal */}
        <button
          type="submit"
          disabled={searching || confirming || (!searchColada.trim() && !searchCoil.trim())}
          className="w-full py-3.5 px-6 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl shadow-lg shadow-sky-500/10 transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {searching ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              <span>CONSULTANDO SERVIDOR...</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4 text-slate-950" />
              <span>BUSCAR / VERIFICAR BOBINA</span>
            </>
          )}
        </button>
      </form>

      {/* Alerta Visual de Error / No encontrada */}
      {error && (
        <div className="bg-red-950/70 border border-red-500/60 text-red-200 text-xs sm:text-sm px-4 py-3.5 rounded-xl text-center font-bold tracking-wide flex items-center justify-center space-x-2 animate-pulse shadow-lg">
          <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Alerta de Éxito */}
      {successMsg && (
        <div className="bg-emerald-950/70 border border-emerald-500/60 text-emerald-200 text-xs sm:text-sm px-4 py-3.5 rounded-xl text-center font-bold tracking-wide flex items-center justify-center space-x-2 shadow-lg">
          <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tarjeta de Confirmación de Peso y Datos (Desplegada al encontrar y asignar bobina) */}
      {selectedRoll ? (
        <div className="bg-slate-800/90 rounded-3xl border-2 border-sky-500/40 shadow-2xl overflow-hidden flex flex-col transition-all">
          {/* Header de la Bobina Reclamada */}
          <div className="bg-slate-950 p-5 sm:p-6 border-b border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-[10px] font-black tracking-widest text-sky-400 block uppercase">
                BOBINA LOCALIZADA & APARTADA
              </span>
              <span className="text-2xl sm:text-3xl font-black tracking-wider text-white">
                Lote {selectedRoll.lote || 'S/N'}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleCancelSelection}
                disabled={confirming}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-850 border border-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                title="Liberar reserva y realizar otra búsqueda"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancelar / Otra búsqueda</span>
              </button>
            </div>
          </div>

          {/* Grid de Detalles Técnicos */}
          <div className="p-5 sm:p-6 grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-850/50">
            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                COIL / BOBINA
              </span>
              <span className="text-base sm:text-lg font-black text-white">
                {selectedRoll.coil || 'S/N'}
              </span>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                COLADA / HEAT
              </span>
              <span className="text-base sm:text-lg font-black text-sky-300">
                {selectedRoll.colada || 'S/N'}
              </span>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                PESO REGISTRADO
              </span>
              <div className="flex items-baseline space-x-1">
                <span className="text-lg sm:text-xl font-black text-emerald-400">
                  {selectedRoll.peso ? parseFloat(selectedRoll.peso).toLocaleString() : '0.00'}
                </span>
                <span className="text-[10px] font-bold text-slate-400">KG</span>
              </div>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                MATERIAL / SAE
              </span>
              <span className="text-base sm:text-lg font-black text-slate-200">
                {selectedRoll.sae || 'EST.'}
              </span>
            </div>

            {selectedRoll.sku && (
              <div className="col-span-2 md:col-span-4 bg-slate-900/40 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
                <span>SKU: <strong className="text-slate-200">{selectedRoll.sku}</strong></span>
                <span>Fila: <strong className="text-slate-200">#{selectedRoll.row_number || '---'}</strong></span>
              </div>
            )}
          </div>

          {/* Botón de Confirmación Definitiva */}
          <div className="p-5 sm:p-6 bg-slate-950 border-t border-slate-800">
            <button
              type="button"
              onClick={handleVerify}
              disabled={confirming}
              className="w-full py-4 sm:py-5 rounded-2xl text-sm sm:text-base font-black tracking-widest bg-sky-400 hover:bg-sky-300 text-slate-950 transition duration-150 flex items-center justify-center space-x-3 shadow-xl shadow-sky-500/20 cursor-pointer disabled:opacity-50"
            >
              {confirming ? (
                <>
                  <Loader2 className="w-5 h-5 text-slate-950 animate-spin" />
                  <span>CONFIRMANDO VERIFICACIÓN...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-slate-950" />
                  <span>CONFIRMAR TOMA DE MATERIAL</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Tarjeta de Espera Limpia (Sin Catálogo Masivo) */
        <div className="bg-slate-900/40 rounded-3xl border border-slate-800/80 p-8 sm:p-12 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-sky-400">
            <Sparkles className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-black text-slate-300 uppercase tracking-wider">
            Modo 2: Validación por Demanda
          </h4>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            Escanee o introduzca el código de colada o el número de bobina para consultar directamente en el servidor y validar sin latencia.
          </p>
        </div>
      )}
    </div>
  );
}
