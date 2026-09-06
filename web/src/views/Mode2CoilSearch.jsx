import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { sheetSyncService } from '../services/sheetSyncService';
import { Search, CheckCircle, Barcode, AlertTriangle, Loader2 } from 'lucide-react';

export default function Mode2CoilSearch({ selectedDiam, onVerifySuccess }) {
  const { user, operatorId: authOperatorId } = useAuth();
  const operatorId = authOperatorId || user?.id || user?.nombre || (typeof localStorage !== 'undefined' ? localStorage.getItem('device_session_id') : null) || 'operador';

  const [pendingRolls, setPendingRolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reserving, setReserving] = useState(false);

  // Búsqueda
  const [coladaInput, setColadaInput] = useState('');
  const [coilInput, setCoilInput] = useState('');
  const [showColadaSuggestions, setShowColadaSuggestions] = useState(false);
  const [showCoilSuggestions, setShowCoilSuggestions] = useState(false);

  // Selección y Reserva
  const [selectedRoll, setSelectedRoll] = useState(null);
  const [reservedByOther, setReservedByOther] = useState(false);
  const [reservedByOtherMsg, setReservedByOtherMsg] = useState('');
  const [error, setError] = useState('');
  const [reassignedMsg, setReassignedMsg] = useState('');

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

  // Al cambiar de diámetro o desmontar el componente (salir del modo), limpiar cualquier reserva activa
  useEffect(() => {
    return () => {
      if (activeReservationIdRef.current) {
        const idToFree = activeReservationIdRef.current;
        activeReservationIdRef.current = null;
        releaseReservation(idToFree);
      }
    };
  }, [operatorId, selectedDiam]);

  // Limpiar selección local y cargar bobinas al cambiar de diámetro
  useEffect(() => {
    if (activeReservationIdRef.current) {
      releaseReservation(activeReservationIdRef.current);
      activeReservationIdRef.current = null;
    }
    fetchPendingRolls();
    setSelectedRoll(null);
    setReservedByOther(false);
    setReservedByOtherMsg('');
    setColadaInput('');
    setCoilInput('');
    setError('');
    setReassignedMsg('');
  }, [selectedDiam]);

  // Suscribirse a cambios en tiempo real para mantener la lista local fresca
  useEffect(() => {
    if (!selectedDiam) return;

    const channel = supabase
      .channel('mode2_realtime_refrescador')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'registros_importacion',
        },
        () => {
          fetchPendingRolls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDiam]);

  const fetchPendingRolls = async () => {
    if (!selectedDiam) return;
    setLoading(true);
    try {
      let query = supabase
        .from('registros_importacion')
        .select('*')
        .eq('sheet_name', selectedDiam)
        .eq('is_verified', false);

      if (user?.id) {
        query = query.or(`reserved_by.is.null,reserved_by.eq.${user.id}`);
      } else {
        query = query.is('reserved_by', null);
      }

      const { data, error } = await query.order('lote', { ascending: true });

      if (error) throw error;
      // Filtro estricto: nunca mostrar ni sugerir bobinas que tengan is_verified === true
      const availableOnly = (data || []).filter((r) => r.is_verified === false);
      setPendingRolls(availableOnly);
    } catch (err) {
      console.error('Error fetching pending rolls for autocomplete:', err.message);
      setError('Error al cargar datos de autocompletado.');
    } finally {
      setLoading(false);
    }
  };

  // Autocompletado reactivo de Coladas
  const coladaSuggestions = useMemo(() => {
    const searchVal = coladaInput.trim().toLowerCase();
    const matches = pendingRolls
      .filter((r) => {
        if (!r.colada) return false;
        if (!searchVal) return true;
        return r.colada.toLowerCase().includes(searchVal);
      })
      .map((r) => r.colada);
    return [...new Set(matches)].sort();
  }, [coladaInput, pendingRolls]);

  // Autocompletado reactivo de Coils
  const coilSuggestions = useMemo(() => {
    const searchVal = coilInput.trim().toLowerCase();
    const matches = pendingRolls
      .filter((r) => {
        if (!r.coil) return false;
        if (!searchVal) return true;
        return r.coil.toLowerCase().includes(searchVal);
      })
      .map((r) => r.coil);
    return [...new Set(matches)].sort();
  }, [coilInput, pendingRolls]);

  // Lista de bobinas filtradas para exploración directa
  const filteredRollsList = useMemo(() => {
    const cInput = coladaInput.trim().toLowerCase();
    const kInput = coilInput.trim().toLowerCase();
    return pendingRolls.filter((r) => {
      const matchColada = !cInput || (r.colada && r.colada.toLowerCase().includes(cInput));
      const matchCoil = !kInput || (r.coil && r.coil.toLowerCase().includes(kInput));
      return matchColada && matchCoil;
    });
  }, [pendingRolls, coladaInput, coilInput]);

  // Selección y Reserva Atómica de un Rollo
  const handleSelectCoil = async (targetRoll) => {
    if (!targetRoll) return;

    // Si ya teníamos otro rollo reservado, liberarlo en BD
    if (activeReservationIdRef.current && activeReservationIdRef.current !== targetRoll.id) {
      await releaseReservation(activeReservationIdRef.current);
      activeReservationIdRef.current = null;
    }

    setReserving(true);
    setError('');
    setReassignedMsg('');
    setReservedByOther(false);
    setReservedByOtherMsg('');

    try {
      // 1. Consultar estado fresco en BD
      const { data: freshRecord, error: freshErr } = await supabase
        .from('registros_importacion')
        .select('*')
        .eq('id', targetRoll.id)
        .single();

      if (freshErr) throw freshErr;

      if (freshRecord.is_verified) {
        setError('Esta bobina ya fue verificada por otro operario.');
        setSelectedRoll(null);
        return;
      }

      // 2. Verificar si está reservada por otro operador
      const isCurrentOperator = freshRecord.reserved_by === operatorId;
      const isReservedByAnother = Boolean(freshRecord.reserved_by && !isCurrentOperator);

      if (isReservedByAnother) {
        setReservedByOther(true);
        setReservedByOtherMsg(`Material en proceso por otro operador (${freshRecord.reserved_by})`);
        setSelectedRoll(freshRecord);
        setColadaInput(freshRecord.colada || '');
        setCoilInput(freshRecord.coil || '');
        return;
      }

      // 3. Reservar atómicamente en Supabase si no la teníamos ya
      if (!isCurrentOperator) {
        const { error: reserveErr } = await supabase
          .from('registros_importacion')
          .update({
            reserved_by: operatorId,
            reserved_at: new Date().toISOString()
          })
          .eq('id', freshRecord.id)
          .is('reserved_by', null);

        if (reserveErr) {
          console.warn('Aviso: Conflicto al reservar rollo:', reserveErr);
          setReservedByOther(true);
          setReservedByOtherMsg('Material en proceso por otro operador');
          setSelectedRoll(freshRecord);
          return;
        }
      }

      // Reserva exitosa para este operador
      activeReservationIdRef.current = freshRecord.id;
      setReservedByOther(false);
      setReservedByOtherMsg('');
      setSelectedRoll(freshRecord);
      setColadaInput(freshRecord.colada || '');
      setCoilInput(freshRecord.coil || '');
    } catch (err) {
      console.error('Error al seleccionar bobina:', err);
      setError('Error al consultar estado de la bobina: ' + err.message);
    } finally {
      setReserving(false);
    }
  };

  // Deseleccionar rollo y liberar la reserva
  const handleDeselectRoll = async () => {
    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      await releaseReservation(idToFree);
    }
    setSelectedRoll(null);
    setReservedByOther(false);
    setReservedByOtherMsg('');
  };

  const selectColada = (colada) => {
    setColadaInput(colada);
    setShowColadaSuggestions(false);
    const matched = pendingRolls.find((r) => r.colada === colada);
    if (matched) {
      handleSelectCoil(matched);
    }
  };

  const selectCoil = (coil) => {
    setCoilInput(coil);
    setShowCoilSuggestions(false);
    const matched = pendingRolls.find((r) => r.coil === coil);
    if (matched) {
      handleSelectCoil(matched);
    }
  };

  const handleVerify = async () => {
    if (!selectedRoll || reservedByOther) return;
    setConfirming(true);
    setError('');
    setReassignedMsg('');

    try {
      let rollToVerify = { ...selectedRoll };

      // Consultar estado en tiempo real del ID seleccionado
      const { data: checkData, error: checkError } = await supabase
        .from('registros_importacion')
        .select('is_verified, reserved_by')
        .eq('id', selectedRoll.id)
        .single();

      if (checkError) throw checkError;

      if (checkData.is_verified) {
        // Si ya fue verificado, buscar el siguiente pendiente con la misma colada y diámetro con filtro estricto
        let altQuery = supabase
          .from('registros_importacion')
          .select('*')
          .eq('sheet_name', selectedDiam)
          .eq('colada', selectedRoll.colada)
          .eq('is_verified', false);

        if (user?.id) {
          altQuery = altQuery.or(`reserved_by.is.null,reserved_by.eq.${user.id}`);
        } else {
          altQuery = altQuery.is('reserved_by', null);
        }

        const { data: altData, error: altError } = await altQuery
          .order('lote', { ascending: true })
          .limit(1);

        if (altError) throw altError;

        if (altData && altData.length > 0 && altData[0].is_verified === false) {
          rollToVerify = altData[0];
          setReassignedMsg(`Reasignado automáticamente al lote: ${rollToVerify.lote}`);
        } else {
          throw new Error('Todos los registros de esta colada ya fueron confirmados por otros operarios.');
        }
      }

      const targetId = rollToVerify.id;
      const verifyTimestamp = new Date().toISOString();
      const operatorName = user?.nombre || 'Operador';

      // 1. Actualización optimista inmediata
      setPendingRolls((prev) => prev.filter((r) => r.id !== targetId));
      setSelectedRoll(null);
      activeReservationIdRef.current = null;
      setColadaInput('');
      setCoilInput('');

      // 2. Feedback táctil
      if (navigator.vibrate) {
        try {
          navigator.vibrate(100);
        } catch (e) {}
      }

      // 3. UPDATE en Supabase liberando la reserva y marcando is_verified = true
      const { error: updateError } = await supabase
        .from('registros_importacion')
        .update({
          is_verified: true,
          verified_at: verifyTimestamp,
          verified_by: operatorName,
          reserved_by: null,
          reserved_at: null,
          updated_at: verifyTimestamp,
        })
        .eq('id', targetId);

      if (updateError) {
        console.error('Error al actualizar bobina en Supabase:', updateError);
        alert('Error al guardar verificación: ' + updateError.message);
        fetchPendingRolls();
        return;
      }

      // 4. Crear el registro verificado
      const verifiedRecord = {
        ...rollToVerify,
        is_verified: true,
        verified_at: verifyTimestamp,
        verified_by: operatorName,
        sheet_name: rollToVerify.sheet_name || selectedDiam,
        spreadsheet_id: rollToVerify.spreadsheet_id,
      };

      // 5. Agregar a la cola de sincronización
      sheetSyncService.addToQueue(verifiedRecord);

      // Notificar al Dashboard principal de la verificación exitosa
      if (onVerifySuccess) {
        onVerifySuccess(verifiedRecord);
      }

      // 6. Recargar catálogo en segundo plano
      await fetchPendingRolls();
    } catch (err) {
      console.error('Error confirming search verify:', err.message);
      alert('Error al procesar la confirmación: ' + err.message);
      await fetchPendingRolls();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Search by Colada */}
        <div className="space-y-2 relative">
          <label className="block text-[10px] font-black text-slate-400 tracking-wider">FILTRAR POR COLADA</label>
          <div className="relative">
            <input
              type="text"
              value={coladaInput}
              onChange={(e) => {
                setColadaInput(e.target.value);
                setShowColadaSuggestions(true);
                if (selectedRoll) {
                  handleDeselectRoll();
                }
              }}
              onFocus={() => setShowColadaSuggestions(true)}
              onBlur={() => setTimeout(() => setShowColadaSuggestions(false), 200)}
              placeholder="Escriba colada (mín. 2 caracteres)..."
              className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-4 pl-12 font-bold focus:border-sky-400 focus:outline-none"
              disabled={loading || confirming}
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          </div>

          {/* Suggestions Dropdown */}
          {showColadaSuggestions && coladaSuggestions.length > 0 && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.stopPropagation()}
              className="absolute z-30 w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto touch-pan-y overscroll-contain divide-y divide-slate-800"
              style={{
                overflowY: 'auto',
                touchAction: 'pan-y',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {coladaSuggestions.map((colada) => (
                <button
                  key={colada}
                  type="button"
                  onClick={() => selectColada(colada)}
                  className="w-full text-left p-3 hover:bg-slate-900 active:bg-slate-800 font-bold text-sm text-sky-400 transition flex items-center justify-between cursor-pointer"
                >
                  <span>Colada: {colada}</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {pendingRolls.filter((r) => r.colada === colada).length} bobinas
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search by Coil */}
        <div className="space-y-2 relative">
          <label className="block text-[10px] font-black text-slate-400 tracking-wider">FILTRAR POR COIL / BOBINA</label>
          <div className="relative">
            <input
              type="text"
              value={coilInput}
              onChange={(e) => {
                setCoilInput(e.target.value);
                setShowCoilSuggestions(true);
                if (selectedRoll) {
                  handleDeselectRoll();
                }
              }}
              onFocus={() => setShowCoilSuggestions(true)}
              onBlur={() => setTimeout(() => setShowCoilSuggestions(false), 300)}
              placeholder="Escriba bobina..."
              className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-4 pl-12 font-bold focus:border-sky-400 focus:outline-none"
              disabled={loading || confirming}
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          </div>

          {/* Suggestions Dropdown */}
          {showCoilSuggestions && coilSuggestions.length > 0 && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              onTouchStart={(e) => e.stopPropagation()}
              className="absolute z-30 w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto touch-pan-y overscroll-contain divide-y divide-slate-800"
              style={{
                overflowY: 'auto',
                touchAction: 'pan-y',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {coilSuggestions.map((coil) => (
                <button
                  key={coil}
                  type="button"
                  onClick={() => selectCoil(coil)}
                  className="w-full text-left p-3 hover:bg-slate-900 active:bg-slate-800 font-bold text-sm text-sky-400 transition flex items-center justify-between cursor-pointer"
                >
                  <span>Coil: {coil}</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {pendingRolls.find((r) => r.coil === coil)?.colada ? `Colada: ${pendingRolls.find((r) => r.coil === coil)?.colada}` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-red-950/60 border border-red-500/50 text-red-200 text-sm px-4 py-3 rounded-xl text-center font-bold tracking-wide animate-pulse">
          {error}
        </div>
      )}

      {reassignedMsg && (
        <div className="bg-yellow-950/60 border border-yellow-500/50 text-yellow-200 text-sm px-4 py-3 rounded-xl text-center font-bold tracking-wide flex items-center justify-center space-x-2">
          <AlertTriangle className="w-5 h-5 text-yellow-500 animate-bounce" />
          <span>{reassignedMsg}</span>
        </div>
      )}

      {/* Selected Roll Confirmation Card */}
      <div className="flex-1 flex flex-col justify-center py-2">
        {loading ? (
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-12 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-10 h-10 border-4 border-slate-600 border-t-sky-400 rounded-full animate-spin"></div>
            <p className="text-slate-400 font-bold tracking-wide">Actualizando catálogo...</p>
          </div>
        ) : selectedRoll ? (
          <div className="bg-slate-800 rounded-3xl border-2 border-sky-500/30 shadow-2xl overflow-hidden flex flex-col space-y-0">
            {/* Header Lote & Deselect Action */}
            <div className="bg-slate-950 p-6 border-b border-slate-800 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black tracking-widest text-sky-400 block uppercase">
                  LOTE FILTRADO
                </span>
                <span className="text-3xl font-black tracking-wider text-white">
                  {selectedRoll.lote}
                </span>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={handleDeselectRoll}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-850 border border-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
                  title="Liberar reserva y volver al catálogo"
                >
                  <span>✕ Cancelar Selección</span>
                </button>
                <Barcode className="w-10 h-10 text-slate-600 hidden sm:block" />
              </div>
            </div>

            {/* Advertencia si está reservado por otro operador */}
            {reservedByOther && (
              <div className="bg-red-950/90 border-y border-red-500/60 p-4 text-center flex items-center justify-center space-x-2 text-red-200 font-bold text-xs tracking-wide">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <span>{reservedByOtherMsg || 'Material en proceso por otro operador'}</span>
              </div>
            )}

            {/* Grid de Detalles */}
            <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6 bg-slate-800/40">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">COIL / BOBINA</span>
                <span className="text-lg font-bold text-slate-200">{selectedRoll.coil || 'S/N'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">SAE / MAT.</span>
                <span className="text-lg font-bold text-slate-200">{selectedRoll.sae || 'EST.'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">PESO (KG)</span>
                <span className="text-lg font-bold text-slate-200">
                  {selectedRoll.peso ? parseFloat(selectedRoll.peso).toLocaleString() : '0.00'}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">SKU</span>
                <span className="text-xs font-mono font-bold text-slate-400">{selectedRoll.sku || '---'}</span>
              </div>
            </div>

            {/* Botón de Confirmación con Bloqueo si otro operador lo tiene reservado */}
            <div className="p-6 bg-slate-950 border-t border-slate-800">
              <button
                type="button"
                onClick={handleVerify}
                disabled={confirming || reserving || reservedByOther}
                className={`w-full py-5 rounded-2xl text-base font-black tracking-widest text-slate-900 transition duration-150 flex items-center justify-center space-x-3 shadow-lg ${
                  reservedByOther
                    ? 'bg-slate-800 border border-red-500/40 text-red-400 cursor-not-allowed'
                    : 'bg-sky-400 hover:bg-sky-300 active:scale-98 shadow-sky-500/10 cursor-pointer'
                } ${confirming || reserving ? 'opacity-50 pointer-events-none' : ''}`}
              >
                {confirming || reserving ? (
                  <div className="flex items-center space-x-2">
                    <Loader2 className="w-5 h-5 text-slate-900 animate-spin" />
                    <span>{reserving ? 'RESERVANDO BOBINA...' : 'CONFIRMANDO...'}</span>
                  </div>
                ) : reservedByOther ? (
                  <>
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                    <span>MATERIAL EN PROCESO POR OTRO OPERADOR</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-6 h-6 text-slate-900" />
                    <span>CONFIRMAR TOMA DE MATERIAL</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-3xl border border-slate-700 shadow-xl overflow-hidden flex flex-col">
            <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black tracking-widest text-sky-400 block uppercase">
                  CATÁLOGO DE BOBINAS PENDIENTES
                </span>
                <span className="text-sm font-bold text-slate-200">
                  {selectedDiam} MM ({filteredRollsList.length} disponibles)
                </span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                Toca cualquier bobina para seleccionar y apartar
              </span>
            </div>

            <div
              className="divide-y divide-slate-800/80 max-h-[50vh] sm:max-h-[60vh] overflow-y-auto touch-pan-y overscroll-contain"
              style={{
                overflowY: 'auto',
                touchAction: 'pan-y',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {filteredRollsList.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-500 font-bold uppercase tracking-wider">
                  No hay bobinas pendientes que coincidan con el filtro.
                </div>
              ) : (
                filteredRollsList.map((roll) => {
                  const isOtherReserved = roll.reserved_by && roll.reserved_by !== operatorId;
                  return (
                    <button
                      key={roll.id}
                      type="button"
                      onClick={() => handleSelectCoil(roll)}
                      className={`w-full text-left p-3.5 transition flex items-center justify-between cursor-pointer group ${
                        isOtherReserved ? 'bg-slate-900/40 opacity-70 hover:bg-slate-900/60' : 'hover:bg-slate-900/70 active:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-xs font-mono font-bold text-sky-400 group-hover:border-sky-500">
                          {roll.row_number || '#'}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-white text-sm">Lote: {roll.lote}</span>
                            {roll.colada && (
                              <span className="text-[9px] bg-slate-900 border border-slate-700 text-sky-300 px-1.5 py-0.5 rounded font-bold">
                                Colada: {roll.colada}
                              </span>
                            )}
                            {isOtherReserved && (
                              <span className="text-[8px] bg-yellow-950/80 border border-yellow-500/50 text-yellow-400 px-1.5 py-0.5 rounded font-bold uppercase">
                                En proceso
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400">
                            Coil: {roll.coil || 'S/N'} • {roll.sae || 'SAE'} • SKU: {roll.sku || '---'}
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-black text-slate-200 text-sm block">
                          {roll.peso ? parseFloat(roll.peso).toLocaleString() : '0.00'} KG
                        </span>
                        <span className={`text-[10px] font-bold group-hover:underline ${isOtherReserved ? 'text-yellow-400' : 'text-sky-400'}`}>
                          {isOtherReserved ? 'EN PROCESO →' : 'SELECCIONAR →'}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
