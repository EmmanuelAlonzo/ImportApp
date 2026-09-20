import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { sheetSyncService } from '../services/sheetSyncService';
import {
  Scale,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  Layers,
  Sparkles,
  RefreshCw,
  HelpCircle,
  Tag
} from 'lucide-react';

export default function ReconciliationModal({
  selectedDiam,
  user,
  isOpen,
  onClose,
  onSuccess
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Datos crudos consultados
  const [pendingNoLabel, setPendingNoLabel] = useState([]);
  const [availableCoils, setAvailableCoils] = useState([]);

  // Estado de emparejamiento: Array de { rollo: Object, matchedCoilId: number | null }
  const [matches, setMatches] = useState([]);

  // Cargar datos al abrir el modal o cambiar calibre
  useEffect(() => {
    if (isOpen && selectedDiam) {
      loadData();
    } else {
      setMatches([]);
      setPendingNoLabel([]);
      setAvailableCoils([]);
      setError('');
      setSuccessMsg('');
    }
  }, [isOpen, selectedDiam]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      // 1. Consultar rollos temporales pendientes
      const { data: noLabelData, error: noLabelErr } = await supabase
        .from('rollos_sin_etiqueta')
        .select('*')
        .eq('sheet_name', selectedDiam)
        .eq('status', 'pendiente')
        .order('created_at', { ascending: true });

      if (noLabelErr) {
        throw new Error('Error al cargar rollos sin etiqueta: ' + noLabelErr.message);
      }

      // 2. Consultar bobinas de importación no verificadas y no reservadas
      const { data: coilsData, error: coilsErr } = await supabase
        .from('registros_importacion')
        .select('id, colada, coil, lote, peso, peso_neto, sae, sku, spreadsheet_id, sheet_name, reserved_by')
        .eq('sheet_name', selectedDiam)
        .eq('is_verified', false)
        .is('reserved_by', null)
        .order('id', { ascending: true });

      if (coilsErr) {
        throw new Error('Error al consultar manifiesto de bobinas: ' + coilsErr.message);
      }

      const rawNoLabel = noLabelData || [];
      const rawCoils = coilsData || [];

      setPendingNoLabel(rawNoLabel);
      setAvailableCoils(rawCoils);

      // 3. Ejecutar Algoritmo de Auto-Emparejamiento
      const initialMatches = runAutoMatching(rawNoLabel, rawCoils);
      setMatches(initialMatches);
    } catch (err) {
      console.error('Error cargando datos de conciliación:', err);
      setError(err.message || 'Error al preparar la conciliación.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Algoritmo de Auto-Emparejamiento:
   * 1. Rollos con peso_patio: buscar el coil disponible con menor |peso_patio - peso_manifiesto|.
   * 2. Rollos sin peso_patio: emparejar secuencialmente por orden de llegada con los coils restantes.
   */
  const runAutoMatching = (noLabelList, coilList) => {
    const assignedCoilIds = new Set();
    const result = [];

    // Separar los que tienen peso registrado y los que no
    const withWeight = [];
    const withoutWeight = [];

    noLabelList.forEach((rollo, idx) => {
      const pesoNum = rollo.peso_patio ? parseFloat(rollo.peso_patio) : null;
      if (pesoNum && !isNaN(pesoNum) && pesoNum > 0) {
        withWeight.push({ rollo, pesoNum, originalIndex: idx });
      } else {
        withoutWeight.push({ rollo, originalIndex: idx });
      }
    });

    const matchesMap = new Map();

    // 1. Emparejar primero por cercanía de peso
    for (const item of withWeight) {
      let bestCoil = null;
      let minDiff = Infinity;

      for (const coil of coilList) {
        if (assignedCoilIds.has(coil.id)) continue;
        const coilPeso = parseFloat(coil.peso_neto || coil.peso || 0);
        if (coilPeso > 0) {
          const diff = Math.abs(item.pesoNum - coilPeso);
          if (diff < minDiff) {
            minDiff = diff;
            bestCoil = coil;
          }
        }
      }

      // Si no se encontró coil con peso pero hay coils libres, tomar el primero libre
      if (!bestCoil) {
        bestCoil = coilList.find((c) => !assignedCoilIds.has(c.id)) || null;
      }

      if (bestCoil) {
        assignedCoilIds.add(bestCoil.id);
        matchesMap.set(item.rollo.id, bestCoil.id);
      } else {
        matchesMap.set(item.rollo.id, null);
      }
    }

    // 2. Emparejar secuencialmente los rollos sin peso
    for (const item of withoutWeight) {
      const bestCoil = coilList.find((c) => !assignedCoilIds.has(c.id)) || null;
      if (bestCoil) {
        assignedCoilIds.add(bestCoil.id);
        matchesMap.set(item.rollo.id, bestCoil.id);
      } else {
        matchesMap.set(item.rollo.id, null);
      }
    }

    // Conservar el orden cronológico original de rollos sin etiqueta
    noLabelList.forEach((rollo) => {
      result.push({
        rollo,
        matchedCoilId: matchesMap.get(rollo.id) || null
      });
    });

    return result;
  };

  // Manejar cambio manual de bobina asignada en el <select>
  const handleCoilChange = (rolloId, newCoilId) => {
    const parsedId = newCoilId ? Number(newCoilId) : null;

    setMatches((prev) => {
      return prev.map((item) => {
        if (item.rollo.id === rolloId) {
          return { ...item, matchedCoilId: parsedId };
        }
        // Si otro rollo ya tenía asignado este coil, desasignarlo para evitar duplicados
        if (parsedId && item.matchedCoilId === parsedId) {
          return { ...item, matchedCoilId: null };
        }
        return item;
      });
    });
  };

  // Acción: Confirmar Reetiquetado Masivo
  const handleConfirmReconciliation = async () => {
    const validMatches = matches.filter((m) => m.matchedCoilId);

    if (validMatches.length === 0) {
      setError('No hay ninguna bobina emparejada para conciliar.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccessMsg('');

    try {
      const nowIso = new Date().toISOString();
      const operatorName = user?.nombre || user?.username || 'Operario';

      // Procesar cada match de forma atómica
      for (const item of validMatches) {
        const targetCoil = availableCoils.find((c) => c.id === item.matchedCoilId);
        if (!targetCoil) continue;

        // 1. Actualizar registros_importacion
        const updateImportPayload = {
          is_verified: true,
          codigo_temporal_origen: item.rollo.codigo_temporal,
          verified_by: operatorName,
          verified_at: nowIso,
          verification_mode: 'Conciliación Rezagos',
          updated_at: nowIso,
          reserved_by: null,
          reserved_at: null
        };

        const { error: updateImpErr } = await supabase
          .from('registros_importacion')
          .update(updateImportPayload)
          .eq('id', item.matchedCoilId);

        if (updateImpErr) {
          throw new Error(`Error al verificar bobina #${targetCoil.coil}: ${updateImpErr.message}`);
        }

        // 2. Actualizar rollos_sin_etiqueta
        const { error: updateRolloErr } = await supabase
          .from('rollos_sin_etiqueta')
          .update({
            status: 'conciliado',
            matched_registro_id: item.matchedCoilId,
            matched_by: operatorName,
            matched_at: nowIso
          })
          .eq('id', item.rollo.id);

        if (updateRolloErr) {
          throw new Error(`Error al conciliar rollo ${item.rollo.codigo_temporal}: ${updateRolloErr.message}`);
        }

        // 3. Agregar al servicio de sincronización hacia Google Sheets
        const verifiedRecord = {
          ...targetCoil,
          ...updateImportPayload,
          sheet_name: targetCoil.sheet_name || selectedDiam
        };
        sheetSyncService.addToQueue(verifiedRecord);
      }

      // Feedback háptico
      if (navigator.vibrate) {
        try {
          navigator.vibrate([100, 50, 100]);
        } catch (_) {}
      }

      setSuccessMsg(`¡${validMatches.length} bobina(s) conciliada(s) y reetiquetada(s) con éxito!`);

      if (onSuccess) {
        onSuccess(validMatches);
      }

      // Cerrar modal automáticamente tras 1.5 segundos
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Error en reconciliación masiva:', err);
      setError(err.message || 'Ocurrió un error al guardar la conciliación.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const validMatchesCount = matches.filter((m) => m.matchedCoilId).length;
  const hasExcessPhysical = pendingNoLabel.length > availableCoils.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wider flex items-center gap-2">
                Conciliación y Tabla de Equivalencias
                <span className="text-[10px] bg-slate-800 text-amber-400 px-2 py-0.5 rounded-lg border border-amber-500/30 font-mono">
                  {selectedDiam}
                </span>
              </h2>
              <p className="text-xs text-slate-400 font-medium">
                Asigna a cada código temporal su bobina oficial del manifiesto de importación.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Advertencia si hay más rollos físicos que registros pendientes en manifiesto */}
        {hasExcessPhysical && (
          <div className="bg-amber-950/70 border-b border-amber-500/50 px-4 py-3 flex items-center space-x-2.5 text-amber-200 text-xs font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Atención: Hay más rollos físicos ({pendingNoLabel.length}) que registros pendientes en el manifiesto ({availableCoils.length}). Solo se podrán conciliar las bobinas con cupo oficial.
            </span>
          </div>
        )}

        {/* Errores y Notificaciones */}
        {error && (
          <div className="bg-red-950/70 border-b border-red-500/50 px-4 py-3 flex items-center space-x-2.5 text-red-200 text-xs font-bold animate-pulse">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="bg-emerald-950/80 border-b border-emerald-500/50 px-4 py-3 flex items-center space-x-2.5 text-emerald-200 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
              <p className="text-xs font-bold uppercase tracking-wider">
                Analizando coincidencias y pesos de báscula...
              </p>
            </div>
          ) : pendingNoLabel.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mx-auto text-slate-500">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-slate-300">
                No hay bobinas sin etiqueta pendientes para este calibre.
              </p>
              <p className="text-xs text-slate-500">
                Todos los rollos físicos registrados en patio ya han sido conciliados con el manifiesto.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Tabla de Equivalencias */}
              <div className="overflow-x-auto border border-slate-800 rounded-2xl bg-slate-950/40">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-[10px] font-black uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-3">Código Temporal</th>
                      <th className="py-3 px-3">Peso Báscula Patio</th>
                      <th className="py-3 px-2 text-center">➜</th>
                      <th className="py-3 px-3">Bobina Manifiesto (Colada / Coil)</th>
                      <th className="py-3 px-3">Peso Teórico</th>
                      <th className="py-3 px-3 text-right">Diferencia de Peso</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {matches.map((item) => {
                      const matchedCoil = availableCoils.find((c) => c.id === item.matchedCoilId);
                      const pesoPatioNum = item.rollo.peso_patio ? parseFloat(item.rollo.peso_patio) : null;
                      const pesoTeoricoNum = matchedCoil ? parseFloat(matchedCoil.peso_neto || matchedCoil.peso || 0) : null;

                      let diffText = '---';
                      let diffColor = 'text-slate-500';

                      if (pesoPatioNum !== null && pesoTeoricoNum !== null) {
                        const diff = pesoPatioNum - pesoTeoricoNum;
                        const absDiff = Math.abs(diff);
                        if (absDiff <= 5) {
                          diffText = `Exacto (${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg)`;
                          diffColor = 'text-emerald-400 font-bold';
                        } else if (absDiff <= 25) {
                          diffText = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg`;
                          diffColor = 'text-yellow-400 font-bold';
                        } else {
                          diffText = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kg`;
                          diffColor = 'text-red-400 font-bold';
                        }
                      } else if (matchedCoil && pesoPatioNum === null) {
                        diffText = 'Sin báscula patio';
                        diffColor = 'text-slate-400 italic';
                      }

                      return (
                        <tr key={item.rollo.id} className="hover:bg-slate-850/40 transition">
                          {/* Código Temporal */}
                          <td className="py-3 px-3">
                            <span className="font-mono font-black text-amber-300 text-xs sm:text-sm bg-amber-950/50 px-2 py-0.5 rounded border border-amber-500/30">
                              {item.rollo.codigo_temporal}
                            </span>
                          </td>

                          {/* Peso Patio */}
                          <td className="py-3 px-3">
                            {pesoPatioNum ? (
                              <span className="font-mono font-bold text-white">
                                {pesoPatioNum.toLocaleString()} kg
                              </span>
                            ) : (
                              <span className="text-slate-500 italic">No registrado</span>
                            )}
                          </td>

                          {/* Flecha */}
                          <td className="py-3 px-2 text-center text-slate-600">
                            <ArrowRight className="w-4 h-4 mx-auto text-amber-500/60" />
                          </td>

                          {/* Selector de Bobina de Manifiesto */}
                          <td className="py-2.5 px-3 min-w-[260px]">
                            <select
                              value={item.matchedCoilId || ''}
                              onChange={(e) => handleCoilChange(item.rollo.id, e.target.value)}
                              disabled={saving}
                              className={`w-full bg-slate-900 text-white rounded-xl border p-2 text-xs font-bold focus:outline-none transition cursor-pointer ${
                                item.matchedCoilId
                                  ? 'border-emerald-500/50 focus:border-emerald-400'
                                  : 'border-amber-500/50 focus:border-amber-400 text-amber-300'
                              }`}
                            >
                              <option value="">-- Sin asignar --</option>
                              {availableCoils.map((c) => {
                                const isAssignedElsewhere = matches.some(
                                  (m) => m.matchedCoilId === c.id && m.rollo.id !== item.rollo.id
                                );
                                const cPeso = c.peso_neto || c.peso || '0';
                                return (
                                  <option key={c.id} value={c.id}>
                                    Coil #{c.coil} | Colada: {c.colada} | {cPeso} kg {isAssignedElsewhere ? '⚠️ (Asignado)' : ''}
                                  </option>
                                );
                              })}
                            </select>
                          </td>

                          {/* Peso Teórico */}
                          <td className="py-3 px-3">
                            {matchedCoil ? (
                              <span className="font-mono text-slate-300">
                                {(matchedCoil.peso_neto || matchedCoil.peso || 0).toLocaleString()} kg
                              </span>
                            ) : (
                              <span className="text-slate-600">---</span>
                            )}
                          </td>

                          {/* Diferencia de Peso */}
                          <td className={`py-3 px-3 text-right font-mono text-[11px] ${diffColor}`}>
                            {diffText}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-400 font-bold">
            Emparejadas:{' '}
            <strong className="text-emerald-400 font-mono">{validMatchesCount}</strong> de{' '}
            <span className="font-mono">{pendingNoLabel.length}</span> bobinas temporales
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 sm:flex-none px-5 py-3 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleConfirmReconciliation}
              disabled={saving || validMatchesCount === 0}
              className="flex-1 sm:flex-none px-6 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-emerald-500/20 transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>CONCILIANDO {validMatchesCount} BOBINAS...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-slate-950" />
                  <span>CONFIRMAR REETIQUETADO ({validMatchesCount})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
