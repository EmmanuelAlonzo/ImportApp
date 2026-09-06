import React, { useState, useEffect, useRef, useCallback } from 'react';
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

export default function Mode2CoilSearch({ selectedDiam, onVerifySuccess }) {
  const { user, operatorId: authOperatorId } = useAuth();
  const operatorId = authOperatorId || user?.id || user?.nombre || (typeof localStorage !== 'undefined' ? localStorage.getItem('device_session_id') : null) || 'operador';

  // Entradas de búsqueda (Typeahead on-demand)
  const [searchColada, setSearchColada] = useState('');
  const [searchCoil, setSearchCoil] = useState('');
  const [searching, setSearching] = useState(false);

  // Sugerencias rápidas (Typeahead liviano con Bobina/Colada integrada)
  const [coladaSuggestions, setColadaSuggestions] = useState([]);
  const [showColadaDropdown, setShowColadaDropdown] = useState(false);
  const [loadingColadaSuggestions, setLoadingColadaSuggestions] = useState(false);

  const [coilSuggestions, setCoilSuggestions] = useState([]);
  const [showCoilDropdown, setShowCoilDropdown] = useState(false);
  const [loadingCoilSuggestions, setLoadingCoilSuggestions] = useState(false);

  // Opciones cuando hay varias bobinas con el mismo número
  const [disambiguationOptions, setDisambiguationOptions] = useState([]);

  // Bobina seleccionada y apartada
  const [selectedRoll, setSelectedRoll] = useState(null);
  const [confirming, setConfirming] = useState(false);

  // Mensajes informativos
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Referencias para control de foco, clics externos y timers debounce
  const coilInputRef = useRef(null);
  const containerRef = useRef(null);
  const coladaDebounceRef = useRef(null);
  const coilDebounceRef = useRef(null);
  const activeReservationIdRef = useRef(null);

  // Cerrar todos los menús flotantes de sugerencias
  const closeAllDropdowns = useCallback(() => {
    setShowColadaDropdown(false);
    setShowCoilDropdown(false);
  }, []);

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
      console.warn('Aviso: Error liberando bobina apartada en Supabase:', e);
    }
  };

  // Limpieza al salir de la pantalla
  useEffect(() => {
    return () => {
      if (activeReservationIdRef.current) {
        const idToFree = activeReservationIdRef.current;
        activeReservationIdRef.current = null;
        releaseReservation(idToFree);
      }
      if (coladaDebounceRef.current) clearTimeout(coladaDebounceRef.current);
      if (coilDebounceRef.current) clearTimeout(coilDebounceRef.current);
    };
  }, []);

  // Cierre de menús flotantes al hacer clic o tap fuera del buscador
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        closeAllDropdowns();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [closeAllDropdowns]);

  // Limpieza de estados al cambiar de calibre
  useEffect(() => {
    if (activeReservationIdRef.current) {
      const idToFree = activeReservationIdRef.current;
      activeReservationIdRef.current = null;
      releaseReservation(idToFree);
    }
    setSelectedRoll(null);
    setDisambiguationOptions([]);
    closeAllDropdowns();
    setError('');
    setSuccessMsg('');
    setSearchColada('');
    setSearchCoil('');
  }, [selectedDiam, closeAllDropdowns]);

  // -------------------------------------------------------------
  // 1. SUGERENCIAS DE COLADA CON BOBINA INTEGRADA (Debounce 200 ms)
  // -------------------------------------------------------------
  const handleColadaChange = (e) => {
    const val = e.target.value;
    setSearchColada(val);
    setError('');
    setSuccessMsg('');
    setDisambiguationOptions([]);

    if (coladaDebounceRef.current) clearTimeout(coladaDebounceRef.current);

    if (val.trim().length < 2) {
      setColadaSuggestions([]);
      setShowColadaDropdown(false);
      return;
    }

    coladaDebounceRef.current = setTimeout(async () => {
      if (!selectedDiam) return;
      setLoadingColadaSuggestions(true);
      try {
        let query = supabase
          .from('registros_importacion')
          .select('id, colada, coil, lote, peso, sae, sku')
          .eq('sheet_name', selectedDiam)
          .eq('is_verified', false)
          .is('reserved_by', null)
          .ilike('colada', `${val.trim()}%`);

        if (searchCoil.trim()) {
          query = query.ilike('coil', `%${searchCoil.trim()}%`);
        }

        const { data, error: qErr } = await query.limit(10);

        if (!qErr && data && data.length > 0) {
          setColadaSuggestions(data);
          setShowColadaDropdown(true);
        } else {
          setColadaSuggestions([]);
          setShowColadaDropdown(false);
        }
      } catch (err) {
        console.warn('Error al consultar sugerencias de colada:', err);
      } finally {
        setLoadingColadaSuggestions(false);
      }
    }, 200);
  };

  // Al tocar una sugerencia de Colada: autollena Colada y Bobina y aparta directamente por ID
  const handleSelectColadaSuggestion = (item) => {
    closeAllDropdowns();
    setSearchColada(item.colada || '');
    setSearchCoil(item.coil || '');
    claimSpecificCoil(item);
  };

  // -------------------------------------------------------------
  // 2. SUGERENCIAS Y BÚSQUEDA POR NÚMERO DE BOBINA (Debounce 200 ms)
  // -------------------------------------------------------------
  const handleCoilChange = (e) => {
    const val = e.target.value;
    setSearchCoil(val);
    setError('');
    setSuccessMsg('');
    setDisambiguationOptions([]);

    if (coilDebounceRef.current) clearTimeout(coilDebounceRef.current);

    if (val.trim().length < 1) {
      setCoilSuggestions([]);
      setShowCoilDropdown(false);
      return;
    }

    coilDebounceRef.current = setTimeout(async () => {
      if (!selectedDiam) return;
      setLoadingCoilSuggestions(true);
      try {
        let query = supabase
          .from('registros_importacion')
          .select('id, coil, colada, lote, peso, sae, sku')
          .eq('sheet_name', selectedDiam)
          .eq('is_verified', false)
          .is('reserved_by', null)
          .ilike('coil', `${val.trim()}%`);

        if (searchColada.trim()) {
          query = query.eq('colada', searchColada.trim());
        }

        const { data, error: qErr } = await query.limit(10);

        if (!qErr && data && data.length > 0) {
          // Autollenado inteligente: si solo hay 1 colada posible, autollena Colada
          const uniqueColadas = [...new Set(data.map((r) => r.colada).filter(Boolean))];
          if (!searchColada.trim() && uniqueColadas.length === 1) {
            setSearchColada(uniqueColadas[0]);
          }

          setCoilSuggestions(data);
          setShowCoilDropdown(true);
        } else {
          setCoilSuggestions([]);
          setShowCoilDropdown(false);
        }
      } catch (err) {
        console.warn('Error al consultar sugerencias de bobina:', err);
      } finally {
        setLoadingCoilSuggestions(false);
      }
    }, 200);
  };

  // Al seleccionar una opción de Bobina: autollena ambos campos y aparta la bobina
  const handleSelectCoilSuggestion = (item) => {
    closeAllDropdowns();
    setSearchCoil(item.coil || '');
    if (item.colada) {
      setSearchColada(item.colada);
    }
    claimSpecificCoil(item);
  };

  // -------------------------------------------------------------
  // 3. APARTAR BOBINA POR ID (Reserva directa en servidor)
  // -------------------------------------------------------------
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
    closeAllDropdowns();

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
        setError('Bobina no encontrada o ya verificada por otro operario');
        setSelectedRoll(null);
        activeReservationIdRef.current = null;
        return;
      }

      const claimedRoll = updateData[0];
      activeReservationIdRef.current = claimedRoll.id;
      setSelectedRoll(claimedRoll);
      setSearchColada(claimedRoll.colada || '');
      setSearchCoil(claimedRoll.coil || '');
      setError('');

      if (navigator.vibrate) {
        try {
          navigator.vibrate(50);
        } catch (vibErr) {}
      }
    } catch (err) {
      console.error('Error al apartar bobina:', err);
      setError('No se pudo apartar la bobina en el servidor.');
    } finally {
      setSearching(false);
    }
  };

  // -------------------------------------------------------------
  // 4. BÚSQUEDA Y MANEJO DE COINCIDENCIAS MÚLTIPLES
  // -------------------------------------------------------------
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    closeAllDropdowns();

    const coladaTrimmed = searchColada.trim();
    const coilTrimmed = searchCoil.trim();

    if (!coladaTrimmed && !coilTrimmed) {
      setError('Ingresa la Colada o el Número de Bobina para buscar.');
      return;
    }

    if (!selectedDiam) {
      setError('Selecciona un calibre activo antes de realizar la búsqueda.');
      return;
    }

    // Si ya teníamos otra bobina apartada, liberarla primero
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
        .limit(20);

      if (searchError) {
        console.error('Error al buscar bobinas:', searchError);
        setError('Error al consultar el servidor: ' + searchError.message);
        return;
      }

      if (!data || data.length === 0) {
        setError('Bobina no encontrada o ya verificada por otro operario');
        setSelectedRoll(null);
        return;
      }

      // Caso 1: Coincidencia única -> Apartar de inmediato
      if (data.length === 1) {
        await claimSpecificCoil(data[0]);
        return;
      }

      // Caso 2: El Coil ingresado existe en múltiples coladas -> Desplegar opciones claras
      setDisambiguationOptions(data);
    } catch (err) {
      console.error('Excepción en handleSearch:', err);
      setError('Error al realizar la búsqueda.');
    } finally {
      setSearching(false);
    }
  };

  // Cancelar bobina apartada y buscar otra
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
  // 5. CONFIRMAR Y GUARDAR VERIFICACIÓN
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

      // Fallback si la columna verification_mode aún no existe en base de datos
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
      setSuccessMsg(`¡Bobina Lote ${selectedRoll.lote || ''} confirmada y guardada con éxito!`);
    } catch (err) {
      console.error('Error al confirmar en Modo 2:', err);
      setError('Error al guardar: ' + err.message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div ref={containerRef} className="space-y-6">
      {/* Formulario de Búsqueda y Sugerencias */}
      <form
        onSubmit={handleSearch}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            closeAllDropdowns();
          }
        }}
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4 relative"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Barcode className="w-5 h-5 text-sky-400" />
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider">
              Búsqueda y Escaneo de Bobinas
            </h3>
          </div>
          <span className="text-[10px] text-slate-400 font-bold bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-700/60 self-start sm:self-auto">
            Calibre: <strong className="text-sky-400">{selectedDiam || '---'} MM</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Input Colada con Sugerencias Integradas (Colada ➜ Bobina) */}
          <div className="space-y-1.5 relative">
            <label className="block text-[10px] font-black text-slate-400 tracking-wider uppercase">
              Colada
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchColada}
                onChange={handleColadaChange}
                onFocus={() => {
                  if (coladaSuggestions.length > 0) setShowColadaDropdown(true);
                }}
                placeholder="Escribe colada (mín. 2 letras/números)..."
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3.5 pl-11 font-bold text-sm focus:border-sky-400 focus:outline-none transition"
                disabled={searching || confirming}
                autoComplete="off"
              />
              <Flame className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {loadingColadaSuggestions && (
                <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-sky-400" />
              )}
              {searchColada && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchColada('');
                    setColadaSuggestions([]);
                    setShowColadaDropdown(false);
                  }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Menú flotante de sugerencias de Colada con Bobina Integrada */}
            {showColadaDropdown && coladaSuggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-slate-800">
                <div className="p-2 bg-slate-900/95 text-[10px] font-black text-slate-400 uppercase tracking-wider flex justify-between items-center">
                  <span>Coladas encontradas</span>
                  <span className="text-sky-400">{coladaSuggestions.length} opciones</span>
                </div>
                {coladaSuggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectColadaSuggestion(item)}
                    className="w-full text-left p-3 hover:bg-slate-900 active:bg-slate-800 transition flex items-center justify-between cursor-pointer group"
                  >
                    <div>
                      <div className="font-bold text-sm text-sky-400 group-hover:text-sky-300 transition flex items-center space-x-1.5">
                        <span>Colada: {item.colada}</span>
                        <span className="text-slate-500 font-normal">➜</span>
                        <span className="text-white font-bold">Bobina #{item.coil || 'S/N'}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Lote: {item.lote} • {item.sae || 'Acero Estándar'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-emerald-400 block">
                        ({item.peso ? parseFloat(item.peso).toLocaleString() : '0.00'} kg)
                      </span>
                      <span className="text-[9px] font-bold text-sky-400">APARTAR →</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input Número de Bobina con Sugerencias (Bobina ➜ Colada) */}
          <div className="space-y-1.5 relative">
            <label className="block text-[10px] font-black text-slate-400 tracking-wider uppercase">
              Número de Bobina
            </label>
            <div className="relative">
              <input
                ref={coilInputRef}
                type="text"
                value={searchCoil}
                onChange={handleCoilChange}
                onFocus={() => {
                  if (coilSuggestions.length > 0) setShowCoilDropdown(true);
                }}
                placeholder="Escribe o escanea el número de bobina..."
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3.5 pl-11 font-bold text-sm focus:border-sky-400 focus:outline-none transition"
                disabled={searching || confirming}
                autoComplete="off"
              />
              <Barcode className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {loadingCoilSuggestions && (
                <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-sky-400" />
              )}
              {searchCoil && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchCoil('');
                    setCoilSuggestions([]);
                    setShowCoilDropdown(false);
                  }}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Menú flotante de sugerencias de Bobina */}
            {showCoilDropdown && coilSuggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-slate-800">
                <div className="p-2 bg-slate-900/95 text-[10px] font-black text-slate-400 uppercase tracking-wider flex justify-between items-center">
                  <span>Bobinas disponibles</span>
                  <span className="text-sky-400">{coilSuggestions.length} opciones</span>
                </div>
                {coilSuggestions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectCoilSuggestion(item)}
                    className="w-full text-left p-3 hover:bg-slate-900 active:bg-slate-800 transition flex items-center justify-between cursor-pointer group"
                  >
                    <div>
                      <div className="font-bold text-sm text-white group-hover:text-sky-400 transition flex items-center space-x-1.5">
                        <span>Bobina #{item.coil || 'S/N'}</span>
                        <span className="text-slate-500 font-normal">➜</span>
                        <span className="text-sky-300 font-bold">Colada: {item.colada || '---'}</span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Lote: {item.lote} • {item.sae || 'Acero Estándar'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-emerald-400 block">
                        ({item.peso ? parseFloat(item.peso).toLocaleString() : '0.00'} kg)
                      </span>
                      <span className="text-[9px] font-bold text-sky-400">APARTAR →</span>
                    </div>
                  </button>
                ))}
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
              <span>BUSCAR BOBINA</span>
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

      {/* TARJETA DE OPCIONES: Hay varias bobinas con el mismo número */}
      {disambiguationOptions.length > 1 && (
        <div className="bg-amber-950/40 border-2 border-amber-500/60 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-start justify-between gap-3 border-b border-amber-500/30 pb-3">
            <div className="flex items-center space-x-3">
              <Layers className="w-6 h-6 text-amber-400 shrink-0" />
              <div>
                <h4 className="text-sm font-black text-amber-300 uppercase tracking-wide">
                  Hay varias bobinas con el mismo número. Toca la que tiene tu etiqueta:
                </h4>
                <p className="text-xs text-amber-200/90 font-medium">
                  Revisa la colada o el peso de tu etiqueta para apartar la correcta:
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDisambiguationOptions([])}
              className="p-1 text-amber-400 hover:text-white rounded-lg cursor-pointer"
              title="Buscar otra bobina"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
            {disambiguationOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => claimSpecificCoil(opt)}
                className="p-4 bg-slate-900/90 hover:bg-slate-850 active:bg-slate-800 border border-amber-500/40 hover:border-amber-400 rounded-2xl text-left transition flex flex-col justify-between space-y-2 cursor-pointer group shadow-md"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-black uppercase text-amber-400 tracking-wider block">
                      Bobina #{opt.coil || 'S/N'}
                    </span>
                    <span className="text-sm font-black text-white">
                      Lote {opt.lote}
                    </span>
                  </div>
                  <span className="text-xs font-black text-emerald-400">
                    ({opt.peso ? `${parseFloat(opt.peso).toLocaleString()} kg` : '0.00 kg'})
                  </span>
                </div>

                <div className="text-[11px] text-slate-300 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80 flex justify-between items-center">
                  <span>Colada: <strong className="text-sky-300">{opt.colada || '---'}</strong></span>
                  <span className="text-[10px] text-slate-400">{opt.sae || 'Acero Estándar'}</span>
                </div>

                <div className="w-full py-1.5 px-3 bg-amber-500/20 group-hover:bg-amber-500 group-hover:text-slate-950 text-amber-300 text-[10px] font-black uppercase tracking-wider rounded-lg transition flex items-center justify-center space-x-1">
                  <span>Apartar esta bobina</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* TARJETA DE CONFIRMACIÓN: Bobina apartada para ti */}
      {selectedRoll ? (
        <div className="bg-slate-800/90 rounded-3xl border-2 border-sky-500/40 shadow-2xl overflow-hidden flex flex-col transition-all">
          <div className="bg-slate-950 p-5 sm:p-6 border-b border-slate-800 flex justify-between items-center">
            <div>
              <span className="text-[10px] font-black tracking-widest text-sky-400 block uppercase">
                BOBINA APARTADA PARA TI
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
                title="Liberar y buscar otra bobina"
              >
                <X className="w-3.5 h-3.5" />
                <span>Buscar otra bobina</span>
              </button>
            </div>
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-850/50">
            <div className="space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] font-bold text-slate-400 tracking-wider block uppercase">
                NÚMERO DE BOBINA
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
            Búsqueda por Colada o Bobina
          </h4>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            Escribe o escanea la colada o el número de bobina de tu etiqueta para apartarla y validarla sin demoras.
          </p>
        </div>
      )}
    </div>
  );
}
