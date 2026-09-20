import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import ReconciliationModal from './ReconciliationModal';
import {
  Tag,
  Scale,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Clock,
  RotateCcw,
  Layers,
  Hash,
  User,
  Barcode
} from 'lucide-react';

export default function Mode3NoLabelView({ selectedDiam, user, onCreatedSuccess }) {
  const [pesoPatio, setPesoPatio] = useState('');
  const [lastGenerated, setLastGenerated] = useState(null);
  const [recentPending, setRecentPending] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);

  const pesoInputRef = useRef(null);

  // Cargar rollos temporales pendientes para el calibre seleccionado
  const fetchRecentPending = async () => {
    if (!selectedDiam) {
      setRecentPending([]);
      return;
    }
    setLoadingList(true);
    try {
      const { data, error: qErr } = await supabase
        .from('rollos_sin_etiqueta')
        .select('*')
        .eq('sheet_name', selectedDiam)
        .eq('status', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(5);

      if (qErr) {
        console.warn('Error consultando rollos sin etiqueta:', qErr);
      } else {
        setRecentPending(data || []);
      }
    } catch (err) {
      console.warn('Excepción al cargar rollos sin etiqueta:', err);
    } finally {
      setLoadingList(false);
    }
  };

  // Efecto al cambiar calibre
  useEffect(() => {
    setLastGenerated(null);
    setError('');
    setPesoPatio('');
    fetchRecentPending();
  }, [selectedDiam]);

  // Suscripción Realtime para actualizar la lista de pendientes automáticamente
  useEffect(() => {
    if (!selectedDiam) return;

    const channel = supabase
      .channel(`mode3_realtime_${selectedDiam}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rollos_sin_etiqueta',
        },
        () => {
          fetchRecentPending();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDiam]);

  // Acción Principal: GENERAR CÓDIGO TEMPORAL
  const handleGenerateCode = async (e) => {
    if (e) e.preventDefault();

    if (!selectedDiam) {
      setError('Por favor, selecciona un calibre activo primero.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const operatorName =
        user?.nombre || user?.username || user?.id || 'Operario';

      const parsedPeso = pesoPatio && !isNaN(parseFloat(pesoPatio))
        ? parseFloat(pesoPatio)
        : null;

      const { data, error: rpcError } = await supabase.rpc('generar_codigo_temporal_bobina', {
        p_sheet_name: selectedDiam,
        p_operator_id: operatorName,
        p_peso: parsedPeso
      });

      if (rpcError) {
        console.error('Error en RPC generar_codigo_temporal_bobina:', rpcError);
        setError('Error al generar código temporal: ' + (rpcError.message || 'Error del servidor'));
        return;
      }

      // Supabase devuelve el objeto generado (o array con 1 elemento si cambiara el tipo)
      const newRoll = Array.isArray(data) ? data[0] : data;

      if (!newRoll || !newRoll.codigo_temporal) {
        setError('No se recibió la confirmación del código desde el servidor.');
        return;
      }

      // Guardar el registro retornado
      setLastGenerated(newRoll);
      setPesoPatio('');

      // Vibración háptica en dispositivos compatibles
      if (navigator.vibrate) {
        try {
          navigator.vibrate([50, 50, 50]);
        } catch (vErr) {
          // Ignorar si el navegador no permite vibración
        }
      }

      // Recargar lista de pendientes
      await fetchRecentPending();

      if (onCreatedSuccess) {
        onCreatedSuccess(newRoll);
      }
    } catch (err) {
      console.error('Excepción al generar código temporal:', err);
      setError('Error de conexión o fallo interno al generar código.');
    } finally {
      setLoading(false);
    }
  };

  // Reiniciar para registrar siguiente bobina
  const handleResetForNext = () => {
    setLastGenerated(null);
    setError('');
    setPesoPatio('');
    setTimeout(() => {
      pesoInputRef.current?.focus();
    }, 100);
  };

  return (
    <div className="space-y-6">
      {/* TARJETA DESTACADA: CÓDIGO GENERADO RECIENTEMENTE (ALTO IMPACTO PATIO) */}
      {lastGenerated ? (
        <div className="bg-gradient-to-b from-amber-950/60 to-slate-900 border-2 border-amber-500/80 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-amber-950/40 text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-center space-x-2">
            <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping"></span>
            <span className="text-xs font-black text-amber-400 uppercase tracking-widest">
              CÓDIGO TEMPORAL ASIGNADO
            </span>
          </div>

          {/* CÓDIGO GIGANTE */}
          <div className="py-2">
            <span className="text-5xl sm:text-7xl font-black font-mono tracking-widest text-amber-300 drop-shadow-[0_0_25px_rgba(245,158,11,0.35)] block select-all">
              {lastGenerated.codigo_temporal}
            </span>
          </div>

          {/* SUBTÍTULO OPERATIVO */}
          <div className="bg-amber-900/40 border border-amber-500/40 rounded-2xl py-3 px-4 max-w-lg mx-auto">
            <p className="text-xs sm:text-sm font-black text-amber-200 uppercase tracking-wide">
              ✍️ Marca la bobina física con este código usando tiza o marcador industrial
            </p>
          </div>

          {/* DETALLES DE LA BOBINA */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-lg mx-auto text-left">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Calibre</span>
              <span className="text-sm font-black text-white">{lastGenerated.sheet_name}</span>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Peso Báscula</span>
              <span className="text-sm font-black text-emerald-400">
                {lastGenerated.peso_patio ? `${Number(lastGenerated.peso_patio).toLocaleString()} kg` : 'Sin pesar'}
              </span>
            </div>
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 col-span-2 sm:col-span-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Operario</span>
              <span className="text-sm font-black text-sky-400 truncate block">
                {lastGenerated.created_by || 'Operador'}
              </span>
            </div>
          </div>

          {/* BOTÓN REGISTRAR SIGUIENTE BOBINA */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleResetForNext}
              className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl shadow-amber-500/20 transition active:scale-95 cursor-pointer flex items-center justify-center space-x-2 mx-auto"
            >
              <RotateCcw className="w-5 h-5" />
              <span>REGISTRAR SIGUIENTE BOBINA</span>
            </button>
          </div>
        </div>
      ) : (
        /* FORMULARIO DE GENERACIÓN */
        <form
          onSubmit={handleGenerateCode}
          className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Tag className="w-5 h-5 text-amber-400" />
              <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
                Recepción de Bobinas sin Etiqueta / Rezagos
              </h3>
            </div>
            <span className="text-[10px] text-slate-400 font-bold bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60 self-start sm:self-auto">
              Calibre Activo: <strong className="text-amber-400">{selectedDiam || '---'}</strong>
            </span>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-400 tracking-wider uppercase">
                Peso en Báscula / Grúa (Opcional - kg)
              </label>
              <div className="relative">
                <input
                  ref={pesoInputRef}
                  type="number"
                  step="any"
                  value={pesoPatio}
                  onChange={(e) => setPesoPatio(e.target.value)}
                  placeholder="Ej. 1850.5 (dejar vacío si no se pesó aún)"
                  className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3.5 pl-11 font-bold text-sm focus:border-amber-400 focus:outline-none transition"
                  disabled={loading}
                />
                <Scale className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Si cuentas con báscula o celda de carga en grúa, registra el peso para facilitar la conciliación posterior.
              </p>
            </div>

            {/* BOTÓN PRINCIPAL */}
            <button
              type="submit"
              disabled={loading || !selectedDiam}
              className="w-full py-4 px-6 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-slate-950 font-black text-xs sm:text-sm uppercase tracking-widest rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-slate-950" />
                  <span>GENERANDO CORRELATIVO...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 text-slate-950" />
                  <span>GENERAR CÓDIGO TEMPORAL</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* MENSAJE DE ERROR */}
      {error && (
        <div className="bg-red-950/70 border border-red-500/60 text-red-200 text-xs sm:text-sm px-4 py-3.5 rounded-xl text-center font-bold tracking-wide flex items-center justify-center space-x-2 animate-pulse shadow-lg">
          <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* LISTA COMPACTA DE ROLLOS TEMPORALES PENDIENTES */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-black text-slate-300 uppercase tracking-wider">
              Bobinas Temporales Pendientes de Conciliar ({recentPending.length})
            </h4>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setIsReconcileOpen(true)}
              className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-emerald-500 hover:from-amber-400 hover:to-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-md shadow-amber-500/10 transition active:scale-95 flex items-center space-x-1.5 cursor-pointer"
            >
              <Scale className="w-3.5 h-3.5 text-slate-950" />
              <span>⚖️ CONCILIAR Y ASIGNAR ETIQUETAS</span>
            </button>
            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
              Calibre: {selectedDiam}
            </span>
          </div>
        </div>

        {loadingList ? (
          <div className="py-6 flex items-center justify-center space-x-2 text-slate-400 text-xs font-bold">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            <span>Consultando bobinas pendientes...</span>
          </div>
        ) : recentPending.length === 0 ? (
          <div className="py-6 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
            No hay bobinas sin etiqueta pendientes para este calibre.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 px-3">Código Temp.</th>
                  <th className="py-2.5 px-3">Peso Patio</th>
                  <th className="py-2.5 px-3">Registrado Por</th>
                  <th className="py-2.5 px-3">Hora</th>
                  <th className="py-2.5 px-3 text-right">Estatus</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {recentPending.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-850/50 transition">
                    <td className="py-3 px-3">
                      <span className="font-mono font-black text-amber-300 text-sm bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30">
                        {item.codigo_temporal}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      {item.peso_patio ? (
                        <span className="text-emerald-400 font-bold font-mono">
                          {Number(item.peso_patio).toLocaleString()} kg
                        </span>
                      ) : (
                        <span className="text-slate-500 italic">No pesado</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-400 truncate max-w-[120px]">
                      {item.created_by}
                    </td>
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                      {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-950/80 text-amber-300 border border-amber-500/40">
                        Pendiente
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Conciliación y Tabla de Equivalencias */}
      <ReconciliationModal
        selectedDiam={selectedDiam}
        user={user}
        isOpen={isReconcileOpen}
        onClose={() => setIsReconcileOpen(false)}
        onSuccess={async () => {
          await fetchRecentPending();
          if (onCreatedSuccess) {
            onCreatedSuccess();
          }
        }}
      />
    </div>
  );
}

