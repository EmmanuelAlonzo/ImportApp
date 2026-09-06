import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { sheetSyncService } from '../services/sheetSyncService';
import { CheckCircle, Barcode, AlertTriangle } from 'lucide-react';

export default function Mode1SequentialView({ selectedDiam, onVerifySuccess }) {
  const { user, operatorId } = useAuth();
  const [currentCoil, setCurrentCoil] = useState(null);
  const [upcomingRolls, setUpcomingRolls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const currentCoilRef = useRef(currentCoil);
  const isClaimingRef = useRef(false);

  useEffect(() => {
    currentCoilRef.current = currentCoil;
  }, [currentCoil]);

  // Cargar siguiente bobina al cambiar de diámetro
  useEffect(() => {
    if (selectedDiam) {
      claimNextCoil(true);
    } else {
      setCurrentCoil(null);
      setUpcomingRolls([]);
    }
    setError('');
  }, [selectedDiam]);

  // Suscribirse a cambios en tiempo real en Supabase
  useEffect(() => {
    if (!selectedDiam) return;

    const channel = supabase
      .channel(`mode1_realtime_${selectedDiam}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'registros_importacion',
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new;
            if (updated.sheet_name === selectedDiam && updated.is_verified) {
              // Si la bobina en pantalla fue verificada externamente, solicitar siguiente
              if (currentCoilRef.current && updated.id === currentCoilRef.current.id) {
                claimNextCoil(false);
              }
              // Quitar de la vista previa de próximas
              setUpcomingRolls((prev) => prev.filter((c) => c.id !== updated.id));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDiam]);

  // Reclamar la siguiente bobina con restricción estricta de 1 bobina por operario
  const claimNextCoil = async (showLoading = true) => {
    if (!selectedDiam) return;

    // Evitar ejecuciones simultáneas / dobles llamadas consecutivas en useEffect o montaje
    if (isClaimingRef.current) {
      console.log('claimNextCoil ya en progreso, ignorando llamada duplicada.');
      return;
    }
    isClaimingRef.current = true;

    if (showLoading) setLoading(true);
    setError('');

    try {
      const activeOpId = String(operatorId || user?.id || user?.nombre || sessionStorage.getItem('device_session_id') || localStorage.getItem('device_session_id'));
      const operatorIdentifier = user?.id ? String(user.id) : activeOpId;

      // 1. RESTRICCIÓN ESTRICTA: Consultar primero si el usuario YA TIENE una bobina reservada pendiente
      // (reserved_by === user.id y is_verified === false)
      const idCandidates = [
        user?.id ? String(user.id) : null,
        activeOpId,
        user?.nombre ? String(user.nombre) : null,
        operatorId ? String(operatorId) : null,
      ].filter((v, idx, arr) => v && arr.indexOf(v) === idx);

      let existingQuery = supabase
        .from('registros_importacion')
        .select('*')
        .eq('is_verified', false);

      if (idCandidates.length === 1) {
        existingQuery = existingQuery.eq('reserved_by', idCandidates[0]);
      } else {
        existingQuery = existingQuery.or(idCandidates.map((id) => `reserved_by.eq.${id}`).join(','));
      }

      const { data: existingCoils, error: existErr } = await existingQuery.order('reserved_at', { ascending: false });

      if (!existErr && existingCoils && existingCoils.length > 0) {
        // Si ya tiene una bobina asignada, NO reserves otra: reutiliza y muestra esa bobina en pantalla
        const assignedCoil = existingCoils.find((c) => c.sheet_name === selectedDiam) || existingCoils[0];

        // Si hubiera más de una reserva activa por anomalías pasadas, depurar las excedentes
        if (existingCoils.length > 1) {
          const surplusIds = existingCoils.filter((c) => c.id !== assignedCoil.id).map((c) => c.id);
          try {
            await supabase
              .from('registros_importacion')
              .update({ reserved_by: null, reserved_at: null })
              .in('id', surplusIds)
              .eq('is_verified', false);
          } catch (cleanErr) {
            console.warn('Aviso limpiando reservas duplicadas previas:', cleanErr);
          }
        }

        setCurrentCoil(assignedCoil);
        await fetchUpcomingRolls(assignedCoil.id);
        return;
      }

      // 2. Si no tiene ninguna, antes de apartar la nueva, ejecuta release_operator_coils para asegurar contador en cero
      try {
        await supabase.rpc('release_operator_coils', { p_operator_id: operatorIdentifier });
        if (activeOpId !== operatorIdentifier) {
          await supabase.rpc('release_operator_coils', { p_operator_id: activeOpId });
        }
      } catch (relErr) {
        console.warn('Aviso ejecutando release_operator_coils preventivo:', relErr);
      }

      // 3. Apartar la siguiente bobina estrictamente disponible (.is('reserved_by', null).eq('is_verified', false))
      let coil = null;

      // Intentar RPC claim_next_coil si existe
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('claim_next_coil', {
          p_sheet_name: selectedDiam,
          p_operator_id: operatorIdentifier,
        });

        if (!rpcErr && rpcData) {
          if (Array.isArray(rpcData) && rpcData.length > 0) {
            coil = rpcData[0];
          } else if (rpcData && typeof rpcData === 'object' && rpcData.id) {
            coil = rpcData;
          }
        }
      } catch (rpcEx) {}

      // Fallback directo atómico con verificación de exclusividad
      if (!coil) {
        const { data: availableData, error: availErr } = await supabase
          .from('registros_importacion')
          .select('*')
          .eq('sheet_name', selectedDiam)
          .eq('is_verified', false)
          .is('reserved_by', null)
          .order('lote', { ascending: true })
          .limit(1);

        if (!availErr && availableData && availableData.length > 0) {
          const candidate = availableData[0];

          // Reservar condicionalmente verificando que siga libre en ese milisegundo
          const { data: updatedCoil, error: updateErr } = await supabase
            .from('registros_importacion')
            .update({
              reserved_by: operatorIdentifier,
              reserved_at: new Date().toISOString(),
            })
            .eq('id', candidate.id)
            .eq('is_verified', false)
            .is('reserved_by', null)
            .select();

          if (!updateErr && updatedCoil && updatedCoil.length > 0) {
            coil = updatedCoil[0];
          } else {
            // Reintento atómico en caso de colisión instantánea con otro dispositivo
            const { data: retryData } = await supabase
              .from('registros_importacion')
              .select('*')
              .eq('sheet_name', selectedDiam)
              .eq('is_verified', false)
              .is('reserved_by', null)
              .order('lote', { ascending: true })
              .limit(1);

            if (retryData && retryData.length > 0) {
              const { data: retryUpdated } = await supabase
                .from('registros_importacion')
                .update({
                  reserved_by: operatorIdentifier,
                  reserved_at: new Date().toISOString(),
                })
                .eq('id', retryData[0].id)
                .eq('is_verified', false)
                .is('reserved_by', null)
                .select();

              if (retryUpdated && retryUpdated.length > 0) {
                coil = retryUpdated[0];
              }
            }
          }
        }
      }

      // Filtro estricto de seguridad: NUNCA mostrar bobinas ya verificadas
      if (coil && coil.is_verified === true) {
        coil = null;
      }

      setCurrentCoil(coil);
      await fetchUpcomingRolls(coil?.id);
    } catch (err) {
      console.error('Error claiming coil:', err.message);
      setError('No se pudo reclamar la bobina en el servidor.');
    } finally {
      isClaimingRef.current = false;
      if (showLoading) setLoading(false);
    }
  };

  // Cargar visualización de próximas bobinas disponibles en cola (estrictamente no reservadas y no verificadas)
  const fetchUpcomingRolls = async (excludeId) => {
    if (!selectedDiam) return;
    try {
      let query = supabase
        .from('registros_importacion')
        .select('*')
        .eq('sheet_name', selectedDiam)
        .eq('is_verified', false)
        .is('reserved_by', null)
        .order('lote', { ascending: true })
        .limit(10);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data } = await query;
      if (data) {
        // Doble validación de seguridad: excluir absolutamente cualquier bobina verificada o reservada
        setUpcomingRolls(data.filter((r) => r.is_verified === false && r.reserved_by === null));
      }
    } catch (e) {
      console.warn('Error refrescando próximas bobinas en cola:', e);
    }
  };

  const handleVerify = async () => {
    if (!currentCoil) return;
    setConfirming(true);
    setError('');

    const targetCoil = { ...currentCoil };
    const targetId = targetCoil.id;
    const verifyTimestamp = new Date().toISOString();
    const operatorName = user?.nombre || 'Operador';

    // Feedback táctil
    if (navigator.vibrate) {
      try {
        navigator.vibrate(100);
      } catch (e) {}
    }

    try {
      // 1. UPDATE de verificación en Supabase liberando la reserva
      const updatePayload = {
        is_verified: true,
        verified_at: verifyTimestamp,
        verified_by: operatorName,
        verification_mode: 'Modo 1',
        reserved_by: null,
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
        console.error('Error al actualizar bobina en Supabase:', updateError);
        alert('Error al guardar verificación: ' + updateError.message);
        return;
      }

      // 2. Registro verificado para cola de sincronización de Sheets y Dashboard
      const verifiedRecord = {
        ...targetCoil,
        is_verified: true,
        verified_at: verifyTimestamp,
        verified_by: operatorName,
        verification_mode: 'Modo 1',
        sheet_name: targetCoil.sheet_name || selectedDiam,
        spreadsheet_id: targetCoil.spreadsheet_id,
      };

      sheetSyncService.addToQueue(verifiedRecord);

      if (onVerifySuccess) {
        onVerifySuccess(verifiedRecord);
      }

      // 3. Forzar INMEDIATAMENTE la búsqueda del siguiente disponible sin depender de realtime
      await claimNextCoil(false);
      await fetchUpcomingRolls(null);
    } catch (err) {
      console.error('Error en confirmación:', err.message);
      alert('Error al guardar verificación: ' + err.message);
      await claimNextCoil(true);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert notifications */}
      {error && (
        <div className="bg-red-950/60 border border-red-500/50 text-red-200 text-sm px-4 py-3 rounded-xl text-center font-bold tracking-wide animate-pulse">
          {error}
        </div>
      )}

      {/* Pending Roll Layout */}
      <div className="flex-1 flex flex-col justify-center">
        {loading && !currentCoil ? (
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-12 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 border-4 border-slate-600 border-t-emerald-500 rounded-full animate-spin"></div>
            <p className="text-slate-400 font-bold tracking-wide">Cargando cola de bobinas...</p>
          </div>
        ) : currentCoil ? (
          <div className="bg-slate-800 rounded-3xl border-2 border-emerald-500/35 hover:border-emerald-500/50 transition-all duration-350 shadow-2xl overflow-hidden flex flex-col">
            {/* Lote Code */}
            <div className="bg-slate-950 p-6 border-b border-slate-800 flex justify-between items-center">
              <div>
                <span className="text-[10px] font-black tracking-widest text-emerald-400 block uppercase">
                  LOTE SIGUIENTE EN COLA
                </span>
                <span className="text-3xl font-black tracking-wider text-white">
                  {currentCoil.lote}
                </span>
              </div>
              <Barcode className="w-10 h-10 text-slate-600" />
            </div>

            {/* Data Specifications Grid */}
            <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-6 bg-slate-800/40">
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">COIL / BOBINA</span>
                <span className="text-lg font-bold text-slate-200">{currentCoil.coil || 'S/N'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">SAE / MAT.</span>
                <span className="text-lg font-bold text-slate-200">{currentCoil.sae || 'EST.'}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">PESO (KG)</span>
                <span className="text-lg font-bold text-slate-200">
                  {currentCoil.peso ? parseFloat(currentCoil.peso).toLocaleString() : '0.00'}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] font-bold text-slate-400 tracking-wider block">SKU</span>
                <span className="text-xs font-mono font-bold text-slate-400">{currentCoil.sku || '---'}</span>
              </div>
            </div>

            {/* Green Quick Confirm button */}
            <div className="p-6 bg-slate-950 border-t border-slate-800">
              <button
                type="button"
                onClick={handleVerify}
                disabled={confirming}
                className={`w-full py-5 rounded-2xl text-base font-black tracking-widest text-slate-900 bg-emerald-500 hover:bg-emerald-400 active:scale-98 transition duration-150 flex items-center justify-center space-x-3 shadow-lg shadow-emerald-500/20 cursor-pointer ${
                  confirming ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                {confirming ? (
                  <div className="w-6 h-6 border-3 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <CheckCircle className="w-6 h-6 text-slate-900" />
                    <span>CONFIRMAR TOMA DE MATERIAL</span>
                  </>
                )}
              </button>
            </div>

            {/* Próximas bobinas en cola secuencial con scroll táctil */}
            {upcomingRolls.length > 0 && (
              <div className="mt-4 bg-slate-950/60 rounded-2xl border border-slate-800 p-4">
                <div className="text-[10px] font-black tracking-widest text-slate-400 uppercase mb-2 flex justify-between items-center">
                  <span>PRÓXIMAS EN COLA ({upcomingRolls.length})</span>
                  <span className="text-[9px] text-slate-500 font-mono">Orden secuencial</span>
                </div>
                <div
                  className="divide-y divide-slate-800/60 max-h-48 overflow-y-auto touch-pan-y overscroll-contain"
                  style={{
                    overflowY: 'auto',
                    touchAction: 'pan-y',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  {upcomingRolls.map((roll, idx) => (
                    <div key={roll.id} className="py-2.5 px-1 flex items-center justify-between text-xs">
                      <div className="flex items-center space-x-2">
                        <span className="text-slate-500 font-mono text-[10px]">+{idx + 1}</span>
                        <span className="font-bold text-slate-200">Lote: {roll.lote}</span>
                        {roll.colada && (
                          <span className="text-[9px] bg-slate-900 border border-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                            Col: {roll.colada}
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 font-mono text-[11px]">
                        {roll.peso ? `${parseFloat(roll.peso).toLocaleString()} KG` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-slate-800 rounded-3xl border border-slate-700 p-12 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-slate-900 border border-slate-700 rounded-full flex items-center justify-center shadow-inner">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <h3 className="text-xl font-bold text-white">SIN PENDIENTES</h3>
            <p className="text-sm text-slate-400 max-w-xs mx-auto leading-relaxed">
              Todas las tomas de diámetro seleccionado ({selectedDiam} MM) han sido confirmadas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
