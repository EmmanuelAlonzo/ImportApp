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
  Sparkles,
  Layers,
  ArrowRight
} from 'lucide-react';

// Función utilitaria para resaltar coincidencias de búsqueda en alto contraste
function renderHighlightedText(text, query) {
  if (!text) return '';
  const str = String(text);
  if (!query || !query.trim()) return str;
  const q = query.trim();
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = str.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <span key={i} className="text-amber-400 font-extrabold">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export default function Mode2CoilSearch({ selectedDiam, onVerifySuccess }) {
  const { user, operatorId: authOperatorId } = useAuth();
  const operatorId =
    authOperatorId ||
    user?.id ||
    user?.nombre ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('device_session_id') : null) ||
    'operador';

  // Entradas de búsqueda
  const [searchColada, setSearchColada] = useState('');
  const [searchCoil, setSearchCoil] = useState('');
  const [searching, setSearching] = useState(false);

  // 1. Estados locales para sugerencias flotantes
  const [coladaSuggestions, setColadaSuggestions] = useState([]);
  const [coilSuggestions, setCoilSuggestions] = useState([]);
  const [showColadaMenu, setShowColadaMenu] = useState(false);
  const [showCoilMenu, setShowCoilMenu] = useState(false);

  // Opciones de desambiguación (cuando hay múltiples Coils idénticos)
  const [disambiguationOptions, setDisambiguationOptions] = useState([]);

  // Bobina seleccionada y apartada
  const [selectedRoll, setSelectedRoll] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Mensajes de retroalimentación
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Referencias para timers y control de reserva
  const coilInputRef = useRef(null);
  const activeReservationIdRef = useRef(null);

  // Liberar bobina apartada en Supabase
  const releaseReservation = async (rollId) => {
    if (!rollId) return;
    try {
      await supabase
        .from('registros_importacion')
        .update({ reserved_by: null, reserved_at: null })
        .eq('id', rollId)
        .eq('is_verified', false);
    } catch (e) {
      console.warn('Aviso: Error liberando bobina en Supabase:', e);
    }
  };

  // Limpieza al desmontar componente
  useEffect(() => {
    return () => {
      if (activeReservationIdRef.current) {
        const idToFree = activeReservationIdRef.current;
        activeReservationIdRef.current = null;
        releaseReservation(idToFree);
      }
    };
  }, []);

  // Limpieza al cambiar de calibre
  useEffect(() => {
    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      releaseReservation(idToFree);
    }
    setSelectedRoll(null);
    setDisambiguationOptions([]);
    setShowColadaMenu(false);
    setShowCoilMenu(false);
    setColadaSuggestions([]);
    setCoilSuggestions([]);
    setError('');
    setSuccessMsg('');
    setSearchColada('');
    setSearchCoil('');
  }, [selectedDiam]);

  // -------------------------------------------------------------
  // 1. CONSULTA BLINDADA DE SUGERENCIAS (Conversión de tipos segura)
  // -------------------------------------------------------------
  // Al buscar Colada
  const fetchColadaSug = async (val) => {
    if (!val || val.trim().length < 2) {
      setColadaSuggestions([]);
      setShowColadaMenu(false);
      return;
    }
    if (!selectedDiam) return;
    try {
      // Traer candidatos filtrando por sheet_name y no verificados
      let { data, error: qErr } = await supabase
        .from('registros_importacion')
        .select('id, colada, coil, lote, peso, sae, sku')
        .eq('sheet_name', selectedDiam)
        .eq('is_verified', false)
        .is('reserved_by', null)
        .limit(500);

      if (qErr) {
        // Fallback genérico select *
        const res = await supabase
          .from('registros_importacion')
          .select('*')
          .eq('sheet_name', selectedDiam)
          .eq('is_verified', false)
          .is('reserved_by', null)
          .limit(500);
        data = res.data;
      }

      // Filtrar en memoria como String para evitar fallos de tipo en PostgreSQL
      const term = val.trim().toLowerCase();
      const matches = (data || []).filter((item) =>
        String(item.colada || '').toLowerCase().includes(term)
      ).slice(0, 50);

      setColadaSuggestions(matches);
      setShowColadaMenu(matches.length > 0);
    } catch (err) {
      console.error('Error buscando sugerencias de colada:', err);
    }
  };

  // Al buscar Coil
  const fetchCoilSug = async (val) => {
    if (!val || val.trim().length < 1) {
      setCoilSuggestions([]);
      setShowCoilMenu(false);
      return;
    }
    if (!selectedDiam) return;
    try {
      let { data, error: qErr } = await supabase
        .from('registros_importacion')
        .select('id, colada, coil, lote, peso, sae, sku')
        .eq('sheet_name', selectedDiam)
        .eq('is_verified', false)
        .is('reserved_by', null)
        .limit(500);

      if (qErr) {
        const res = await supabase
          .from('registros_importacion')
          .select('*')
          .eq('sheet_name', selectedDiam)
          .eq('is_verified', false)
          .is('reserved_by', null)
          .limit(500);
        data = res.data;
      }

      const term = val.trim().toLowerCase();
      const matches = (data || []).filter((item) =>
        String(item.coil || '').toLowerCase().includes(term)
      ).slice(0, 50);

      setCoilSuggestions(matches);
      setShowCoilMenu(matches.length > 0);
    } catch (err) {
      console.error('Error buscando sugerencias de coil:', err);
    }
  };

  // -------------------------------------------------------------
  // 2. APARTAR BOBINA DIRECTAMENTE (handleSelectCoilDirect)
  // -------------------------------------------------------------
  const handleSelectCoilDirect = async (item) => {
    if (!item?.id) return;
    setSearchColada(String(item.colada || '').trim());
    setSearchCoil(String(item.coil || '').trim());
    setShowColadaMenu(false);
    setShowCoilMenu(false);
    await claimSpecificCoil(item);
  };

  // Ejecuta la reserva atómica del registro por ID y monta la tarjeta de confirmación
  const claimSpecificCoil = async (candidate) => {
    if (!candidate?.id) return;

    // Si ya teníamos otra bobina apartada, liberarla primero
    if (activeReservationIdRef.current && activeReservationIdRef.current !== candidate.id) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      await releaseReservation(idToFree);
    }

    setSearching(true);
    setError('');
    setSuccessMsg('');
    setDisambiguationOptions([]);
    setShowColadaMenu(false);
    setShowCoilMenu(false);

    try {
      const operatorIdentifier = user?.id ? String(user.id) : String(operatorId);
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
        setError('Coil no encontrado o ya verificado por otro operario');
        setSelectedRoll(null);
        activeReservationIdRef.current = null;
        return;
      }

      const claimedRoll = updateData[0];
      activeReservationIdRef.current = claimedRoll.id;
      setSelectedRoll(claimedRoll);
      setSearchColada(String(claimedRoll.colada || '').trim());
      setSearchCoil(String(claimedRoll.coil || '').trim());
      setError('');

      if (navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (vibErr) {}
      }
    } catch (err) {
      console.error('Error al apartar bobina:', err);
      setError('No se pudo apartar el rollo en el servidor.');
    } finally {
      setSearching(false);
    }
  };

  // -------------------------------------------------------------
  // 3. BÚSQUEDA DIRECTA (Al presionar Enter o botón BUSCAR)
  // -------------------------------------------------------------
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    setShowColadaMenu(false);
    setShowCoilMenu(false);

    const coladaTrimmed = searchColada.trim().toLowerCase();
    const coilTrimmed = searchCoil.trim().toLowerCase();

    if (!coladaTrimmed && !coilTrimmed) {
      setError('Ingresa la Colada o el Coil para buscar.');
      return;
    }

    if (!selectedDiam) {
      setError('Selecciona un calibre activo antes de realizar la búsqueda.');
      return;
    }

    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      await releaseReservation(idToFree);
    }

    setSearching(true);
    setError('');
    setSuccessMsg('');
    setSelectedRoll(null);
    setDisambiguationOptions([]);

    try {
      const { data, error: searchError } = await supabase
        .from('registros_importacion')
        .select('*')
        .eq('sheet_name', selectedDiam)
        .eq('is_verified', false)
        .is('reserved_by', null)
        .limit(100);

      if (searchError) {
        console.error('Error al buscar bobinas:', searchError);
        setError('Error al consultar el servidor: ' + searchError.message);
        return;
      }

      // Filtrar en memoria para asegurar compatibilidad de tipos (números, strings)
      const filtered = (data || []).filter((item) => {
        const matchColada = !coladaTrimmed || String(item.colada || '').toLowerCase().includes(coladaTrimmed);
        const matchCoil = !coilTrimmed || String(item.coil || '').toLowerCase().includes(coilTrimmed);
        return matchColada && matchCoil;
      });

      if (!filtered || filtered.length === 0) {
        setError('Coil no encontrado o ya verificado por otro operario');
        setSelectedRoll(null);
        return;
      }

      // Caso 1: Coincidencia única
      if (filtered.length === 1) {
        await claimSpecificCoil(filtered[0]);
        return;
      }

      // Caso 2: Múltiples coincidencias -> Desplegar opciones
      setDisambiguationOptions(filtered);
    } catch (err) {
      console.error('Excepción en handleSearch:', err);
      setError('Error al realizar la búsqueda.');
    } finally {
      setSearching(false);
    }
  };

  // Cancelar bobina apartada
  const handleCancelSelection = async () => {
    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      await releaseReservation(idToFree);
    }
    setSelectedRoll(null);
    setError('');
  };

  // -------------------------------------------------------------
  // 4. CONFIRMAR Y GUARDAR VERIFICACIÓN
  // -------------------------------------------------------------
  const handleVerify = async () => {
    if (!selectedRoll) return;

    setConfirming(true);
    setError('');
    setSuccessMsg('');

    const targetId = selectedRoll.id;
    const verifyTimestamp = new Date().toISOString();
    const operatorName = user?.nombre || 'Operador';

    if (navigator.vibrate) {
      try {
        navigator.vibrate(100);
      } catch (e) {}
    }

    try {
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

      if (updateError && (updateError.code === 'PGRST204' || updateError.message?.includes('verification_mode'))) {
        delete updatePayload.verification_mode;
        const { error: fallbackErr } = await supabase
          .from('registros_importacion')
          .update(updatePayload)
          .eq('id', targetId);
        updateError = fallbackErr;
      }

      if (updateError) {
        console.error('Error al guardar verificación en Supabase:', updateError);
        setError('Error al guardar la verificación: ' + updateError.message);
        return;
      }

      const verifiedRecord = {
        ...selectedRoll,
        is_verified: true,
        verified_at: verifyTimestamp,
        verified_by: operatorName,
        verification_mode: 'Modo 2',
        sheet_name: selectedRoll.sheet_name || selectedDiam,
        spreadsheet_id: selectedRoll.spreadsheet_id,
      };

      sheetSyncService.addToQueue(verifiedRecord);

      if (onVerifySuccess) {
        onVerifySuccess(verifiedRecord);
      }

      activeReservationIdRef.current = null;
      setSelectedRoll(null);
      setSearchColada('');
      setSearchCoil('');
      setSuccessMsg(`¡Coil Lote ${selectedRoll.lote || ''} confirmado y guardado con éxito!`);
    } catch (err) {
      console.error('Error al confirmar en Modo 2:', err);
      setError('Error al guardar: ' + err.message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6 relative overflow-visible">
      {/* Formulario de Búsqueda y Sugerencias */}
      <form
        onSubmit={handleSearch}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setShowColadaMenu(false);
            setShowCoilMenu(false);
          }
        }}
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 relative overflow-visible"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Barcode className="w-5 h-5 text-sky-400" />
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
              Búsqueda y Escaneo de Coils
            </h3>
          </div>
          <span className="text-[10px] text-slate-400 font-bold bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60 self-start sm:self-auto">
            Calibre: <strong className="text-sky-400">{selectedDiam || '---'} MM</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative overflow-visible">
          {/* Input Colada con Menú Flotante */}
          <div className="space-y-1.5 relative overflow-visible">
            <label className="block text-[10px] font-black text-slate-400 tracking-wider uppercase">
              Colada
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchColada}
                onChange={(e) => {
                  setSearchColada(e.target.value);
                  fetchColadaSug(e.target.value);
                }}
                onFocus={() => {
                  if (searchColada.trim().length >= 2) fetchColadaSug(searchColada);
                }}
                onBlur={() => setTimeout(() => setShowColadaMenu(false), 200)}
                placeholder="Escribe colada (mín. 2 letras/números)..."
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3.5 pl-11 font-bold text-sm focus:border-sky-400 focus:outline-none transition"
                disabled={searching || confirming}
                autoComplete="off"
              />
              <Flame className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {searchColada && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchColada('');
                    setColadaSuggestions([]);
                    setShowColadaMenu(false);
                  }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Menú Flotante de Colada */}
            {showColadaMenu && coladaSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-[100] max-h-80 overflow-y-auto overscroll-contain touch-pan-y rounded-xl shadow-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-md divide-y divide-slate-800/80">
                {coladaSuggestions.map((item) => {
                  const pesoVal = item.peso || item.peso_neto;
                  return (
                    <div
                      key={item.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectCoilDirect(item)}
                      className="min-h-[50px] py-3 px-4 flex items-center justify-between gap-3 hover:bg-slate-800/80 active:bg-cyan-900/40 cursor-pointer transition-colors duration-150 text-slate-200"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <span className="bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-black text-base px-2.5 py-1 rounded-lg shrink-0">
                          Rollo #{item.coil || 'S/N'}
                        </span>
                        <div className="flex items-baseline space-x-1.5 truncate">
                          <span className="text-xs text-slate-400 font-bold uppercase">Colada:</span>
                          <span className="font-bold text-slate-100 text-base">
                            {renderHighlightedText(item.colada, searchColada)}
                          </span>
                          {item.lote && (
                            <span className="text-xs text-slate-400 font-medium ml-1">
                              (Lote {item.lote})
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-slate-400 font-medium text-sm font-mono shrink-0">
                        {pesoVal ? `${parseFloat(pesoVal).toLocaleString()} kg` : '--- kg'}
                      </span>
                    </div>
                  );
                })}
                {coladaSuggestions.length >= 50 && (
                  <div className="p-2.5 text-center text-[10px] text-slate-400 bg-slate-950/80 font-bold uppercase tracking-wider">
                    Mostrando las primeras 50 coincidencias. Escribe más caracteres para afinar.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Input Coil con Menú Flotante */}
          <div className="space-y-1.5 relative overflow-visible">
            <label className="block text-[10px] font-black text-slate-400 tracking-wider uppercase">
              Coil
            </label>
            <div className="relative">
              <input
                ref={coilInputRef}
                type="text"
                value={searchCoil}
                onChange={(e) => {
                  setSearchCoil(e.target.value);
                  fetchCoilSug(e.target.value);
                }}
                onFocus={() => {
                  if (searchCoil.trim().length >= 1) fetchCoilSug(searchCoil);
                }}
                onBlur={() => setTimeout(() => setShowCoilMenu(false), 200)}
                placeholder="Escribe o escanea el Coil..."
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3.5 pl-11 font-bold text-sm focus:border-sky-400 focus:outline-none transition"
                disabled={searching || confirming}
                autoComplete="off"
              />
              <Barcode className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {searchCoil && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchCoil('');
                    setCoilSuggestions([]);
                    setShowCoilMenu(false);
                  }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Menú Flotante de Coil */}
            {showCoilMenu && coilSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1.5 z-[100] max-h-80 overflow-y-auto overscroll-contain touch-pan-y rounded-xl shadow-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-md divide-y divide-slate-800/80">
                {coilSuggestions.map((item) => {
                  const pesoVal = item.peso || item.peso_neto;
                  return (
                    <div
                      key={item.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectCoilDirect(item)}
                      className="min-h-[50px] py-3 px-4 flex items-center justify-between gap-3 hover:bg-slate-800/80 active:bg-cyan-900/40 cursor-pointer transition-colors duration-150 text-slate-200"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <span className="bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-black text-base px-2.5 py-1 rounded-lg shrink-0">
                          Rollo #{renderHighlightedText(item.coil || 'S/N', searchCoil)}
                        </span>
                        <div className="flex items-baseline space-x-1.5 truncate">
                          <span className="text-xs text-slate-400 font-bold uppercase">Colada:</span>
                          <span className="font-bold text-slate-100 text-base">
                            {item.colada}
                          </span>
                          {item.lote && (
                            <span className="text-xs text-slate-400 font-medium ml-1">
                              (Lote {item.lote})
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-slate-400 font-medium text-sm font-mono shrink-0">
                        {pesoVal ? `${parseFloat(pesoVal).toLocaleString()} kg` : '--- kg'}
                      </span>
                    </div>
                  );
                })}
                {coilSuggestions.length >= 50 && (
                  <div className="p-2.5 text-center text-[10px] text-slate-400 bg-slate-950/80 font-bold uppercase tracking-wider">
                    Mostrando las primeras 50 coincidencias. Escribe más caracteres para afinar.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Botón de Búsqueda Principal */}
        <button
          type="submit"
          disabled={searching || confirming || (!searchColada.trim() && !searchCoil.trim())}
          className="w-full py-3.5 px-6 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl shadow-lg shadow-sky-500/10 transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {searching ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              <span>CONSULTANDO...</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4 text-slate-950" />
              <span>BUSCAR COIL</span>
            </>
          )}
        </button>
      </form>

      {/* Alerta de Error */}
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

      {/* TARJETA DE OPCIONES: Hay varios Coils con el mismo número */}
      {disambiguationOptions.length > 1 && (
        <div className="bg-amber-950/40 border-2 border-amber-500/60 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-start justify-between gap-3 border-b border-amber-500/30 pb-3">
            <div className="flex items-center space-x-3">
              <Layers className="w-6 h-6 text-amber-400 shrink-0" />
              <div>
                <h4 className="text-sm font-black text-amber-300 uppercase tracking-wide">
                  Hay varios Coils con el mismo número. Toca la que tiene tu etiqueta:
                </h4>
                <p className="text-xs text-amber-200/90 font-medium">
                  Revisa la colada o el peso de tu etiqueta para apartar el Coil correcto:
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDisambiguationOptions([])}
              className="p-1 text-amber-400 hover:text-white rounded-lg cursor-pointer"
              title="Buscar otro Coil"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
            {disambiguationOptions.map((opt) => {
              const pesoVal = opt.peso_neto || opt.peso;
              const pesoTxt = pesoVal ? parseFloat(pesoVal).toLocaleString() : '0.00';
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => claimSpecificCoil(opt)}
                  className="p-4 bg-slate-900/90 hover:bg-slate-850 active:bg-slate-800 border border-amber-500/40 hover:border-amber-400 rounded-2xl text-left transition flex flex-col justify-between space-y-2 cursor-pointer group shadow-md"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-black uppercase text-amber-400 tracking-wider block">
                        Coil #{opt.coil || 'S/N'}
                      </span>
                      <span className="text-sm font-black text-white">
                        Lote {opt.lote}
                      </span>
                    </div>
                    <span className="text-xs font-black text-emerald-400">
                      ({pesoTxt} kg)
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-300 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 flex justify-between items-center">
                    <span>Colada: <strong className="text-sky-300">{opt.colada || '---'}</strong></span>
                    <span className="text-[10px] text-slate-400">{opt.sae || 'Acero Estándar'}</span>
                  </div>

                  <div className="w-full py-1.5 px-3 bg-amber-500/20 group-hover:bg-amber-500 group-hover:text-slate-950 text-amber-300 text-[10px] font-black uppercase tracking-wider rounded-lg transition flex items-center justify-center space-x-1">
                    <span>Apartar este Coil</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* TARJETA DE CONFIRMACIÓN: Bobina apartada para ti */}
      {selectedRoll ? (
        <div className="bg-slate-800/90 rounded-3xl border-2 border-sky-500/40 shadow-2xl overflow-hidden flex flex-col transition-all">
          <div className="bg-slate-950 p-5 sm:p-6 border-b border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-[10px] font-black tracking-widest text-sky-400 block uppercase">
                ROLLO APARTADO PARA TI
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
                title="Buscar otro rollo"
              >
                <X className="w-3.5 h-3.5" />
                <span>Buscar otro rollo</span>
              </button>
            </div>
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-850/50">
            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                COIL
              </span>
              <span className="text-base sm:text-lg font-black text-white">
                {selectedRoll.coil || 'S/N'}
              </span>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                COLADA
              </span>
              <span className="text-base sm:text-lg font-black text-sky-300">
                {selectedRoll.colada || 'S/N'}
              </span>
            </div>

            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                PESO DE ETIQUETA
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
                TIPO DE ACERO
              </span>
              <span className="text-base sm:text-lg font-black text-slate-200">
                {selectedRoll.sae || 'Acero Estándar'}
              </span>
            </div>

            {selectedRoll.sku && (
              <div className="col-span-2 md:col-span-4 bg-slate-900/40 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
                <span>SKU: <strong className="text-slate-200">{selectedRoll.sku}</strong></span>
                <span>Fila: <strong className="text-slate-200">#{selectedRoll.row_number || '---'}</strong></span>
              </div>
            )}
          </div>

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
                  <span>GUARDANDO...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 sm:w-6 sm:h-6 text-slate-950" />
                  <span>Confirmar y Guardar</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Tarjeta de Espera Limpia */
        <div className="bg-slate-900/40 rounded-3xl border border-slate-800/80 p-8 sm:p-12 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-center text-sky-400">
            <Sparkles className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-black text-slate-300 uppercase tracking-wider">
            Búsqueda por Colada o Coil
          </h4>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            Escribe o escanea la colada o el Coil de tu etiqueta para apartarlo y validarlo sin demoras.
          </p>
        </div>
      )}
    </div>
  );
}
