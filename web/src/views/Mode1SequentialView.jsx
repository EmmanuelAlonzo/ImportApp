import React, { useState, useEffect } from 'react';
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

  const currentCoilRef = React.useRef(currentCoil);
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

  // Reclamar la siguiente bobina exclusiva mediante RPC claim_next_coil
  const claimNextCoil = async (showLoading = true) => {
    if (!selectedDiam) return;
    if (showLoading) setLoading(true);
    setError('');
    try {
      const activeOpId = String(operatorId || user?.id || user?.nombre || localStorage.getItem('device_session_id'));
      const { data, error: rpcErr } = await supabase.rpc('claim_next_coil', {
        p_sheet_name: selectedDiam,
        p_operator_id: activeOpId,
      });

      if (rpcErr) {
        console.warn('Aviso al invocar claim_next_coil RPC, verificando disponibilidad directa:', rpcErr.message);
      }

      // Supabase puede devolver un objeto o un arreglo de registros
      let coil = null;
      if (!rpcErr && data) {
        if (Array.isArray(data)) {
          coil = data.length > 0 ? data[0] : null;
        } else if (data && typeof data === 'object' && data.id) {
          coil = data;
        }
      }

      // Fallback directo con filtro estricto si la RPC no retornó bobina disponible
      if (!coil) {
        let fallbackQuery = supabase
          .from('registros_importacion')
          .select('*')
          .eq('sheet_name', selectedDiam)
          .eq('is_verified', false);

        if (user?.id) {
          fallbackQuery = fallbackQuery.or(`reserved_by.is.null,reserved_by.eq.${user.id}`);
        } else {
          fallbackQuery = fallbackQuery.is('reserved_by', null);
        }

        const { data: fallbackData } = await fallbackQuery
          .order('lote', { ascending: true })
          .limit(1);

        if (fallbackData && fallbackData.length > 0 && fallbackData[0].is_verified === false) {
          const candidate = fallbackData[0];
          // Reservar atómicamente para este operador si no la tenía ya
          if (!candidate.reserved_by) {
            await supabase
              .from('registros_importacion')
              .update({
                reserved_by: activeOpId,
                reserved_at: new Date().toISOString()
              })
              .eq('id', candidate.id)
              .eq('is_verified', false)
              .is('reserved_by', null);
          }
          coil = candidate;
        }
      }

      // Filtro estricto final: NUNCA mostrar ni sugerir bobinas que tengan is_verified === true
      if (coil && coil.is_verified === true) {
        coil = null;
      }

      setCurrentCoil(coil);
      await fetchUpcomingRolls(coil?.id);
    } catch (err) {
      console.error('Error claiming coil:', err.message);
      setError('No se pudo reclamar la bobina en el servidor.');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Cargar visualización de próximas bobinas disponibles en cola
  const fetchUpcomingRolls = async (excludeId) => {
    if (!selectedDiam) return;
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

      query = query
        .order('lote', { ascending: true })
        .limit(10);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data } = await query;
      if (data) {
        // Doble validación de seguridad: excluir absolutamente cualquier bobina verificada
        setUpcomingRolls(data.filter((r) => r.is_verified === false));
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
      const { error: updateError } = await supabase
        .from('registros_importacion')
        .update({
          is_verified: true,
          verified_at: verifyTimestamp,
          verified_by: operatorName,
          reserved_by: null,
          updated_at: verifyTimestamp,
        })
        .eq('id', targetId);

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
