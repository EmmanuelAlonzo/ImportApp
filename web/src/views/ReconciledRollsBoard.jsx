import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import {
  ClipboardList,
  Search,
  CheckCircle2,
  ArrowRight,
  Clock,
  User,
  Scale,
  X,
  Layers,
  Loader2,
  RefreshCw,
  Tag
} from 'lucide-react';

export default function ReconciledRollsBoard({ isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [selectedFilterDiam, setSelectedFilterDiam] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Cargar datos al abrir el visor
  useEffect(() => {
    if (isOpen) {
      fetchReconciledRolls();
    }
  }, [isOpen]);

  // Suscripción Realtime a rollos_sin_etiqueta para cambios automáticos
  useEffect(() => {
    if (!isOpen) return;

    const channel = supabase
      .channel('realtime_reconciled_rolls_board')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'rollos_sin_etiqueta',
        },
        () => {
          fetchReconciledRolls();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen]);

  const fetchReconciledRolls = async () => {
    setLoading(true);
    try {
      // 1. Consultar rollos conciliados
      let query = supabase
        .from('rollos_sin_etiqueta')
        .select('*')
        .eq('status', 'conciliado')
        .order('matched_at', { ascending: false });

      const { data: rollosData, error: rollosErr } = await query;

      if (rollosErr) {
        console.error('Error al consultar rollos conciliados:', rollosErr);
        setLoading(false);
        return;
      }

      const rollos = rollosData || [];
      const matchedIds = rollos.map((r) => r.matched_registro_id).filter(Boolean);

      // 2. Consultar detalles de los registros_importacion oficiales vinculados
      let importMap = new Map();
      if (matchedIds.length > 0) {
        const { data: impData, error: impErr } = await supabase
          .from('registros_importacion')
          .select('id, colada, coil, lote, peso, peso_neto, sae, sku, sheet_name')
          .in('id', matchedIds);

        if (!impErr && impData) {
          impData.forEach((item) => {
            importMap.set(item.id, item);
          });
        }
      }

      // 3. Fusionar datos
      const merged = rollos.map((rollo) => ({
        ...rollo,
        oficial: importMap.get(rollo.matched_registro_id) || null
      }));

      setRecords(merged);
    } catch (err) {
      console.error('Excepción al cargar tabla de reetiquetado:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Extraer lista única de calibres presentes en los registros
  const uniqueDiams = Array.from(
    new Set(records.map((r) => r.sheet_name).filter(Boolean))
  );

  // Filtrado por calibre y por búsqueda de texto
  const filteredRecords = records.filter((r) => {
    const matchDiam =
      selectedFilterDiam === 'ALL' || r.sheet_name === selectedFilterDiam;

    const term = searchQuery.trim().toLowerCase();
    const matchText =
      !term ||
      String(r.codigo_temporal || '').toLowerCase().includes(term) ||
      String(r.oficial?.colada || '').toLowerCase().includes(term) ||
      String(r.oficial?.coil || '').toLowerCase().includes(term) ||
      String(r.oficial?.lote || '').toLowerCase().includes(term);

    return matchDiam && matchText;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wider">
                  TABLA DE REETIQUETADO DE ROLLOS
                </h2>
                <span className="text-[10px] bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 font-mono font-bold px-2 py-0.5 rounded-full">
                  {records.length} CONCILIADOS
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">
                Guía de patio: Ubica el código temporal en tiza y coloca la etiqueta oficial del manifiesto.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
            title="Cerrar visor"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Filtros y Búsqueda */}
        <div className="p-4 bg-slate-950/40 border-b border-slate-800/80 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          {/* Pestañas de Calibre */}
          <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setSelectedFilterDiam('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black tracking-wider transition whitespace-nowrap cursor-pointer ${
                selectedFilterDiam === 'ALL'
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              TODOS ({records.length})
            </button>
            {uniqueDiams.map((diam) => {
              const countForDiam = records.filter((r) => r.sheet_name === diam).length;
              return (
                <button
                  key={diam}
                  type="button"
                  onClick={() => setSelectedFilterDiam(diam)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black tracking-wider transition whitespace-nowrap cursor-pointer ${
                    selectedFilterDiam === diam
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {diam} ({countForDiam})
                </button>
              );
            })}
          </div>

          {/* Buscador Rápido */}
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar código, colada o coil..."
              className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 py-2 pl-9 pr-3 text-xs font-bold focus:border-amber-400 focus:outline-none transition"
            />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Contenido Principal */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-amber-400" />
              <p className="text-xs font-bold uppercase tracking-wider">
                Cargando guía de reetiquetado de patio...
              </p>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-14 h-14 bg-slate-800 border border-slate-700 rounded-full flex items-center justify-center mx-auto text-emerald-400">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-slate-300">
                No hay rollos pendientes de reetiquetar en este calibre.
              </p>
              <p className="text-xs text-slate-500">
                Cuando se concilie un rollo temporal con el manifiesto, aparecerá aquí con su etiqueta oficial.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {filteredRecords.map((item) => {
                const oficial = item.oficial;
                const pesoOficial = oficial ? parseFloat(oficial.peso_neto || oficial.peso || 0) : null;
                const pesoPatio = item.peso_patio ? parseFloat(item.peso_patio) : null;

                return (
                  <div
                    key={item.id}
                    className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 transition-all shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    {/* Sección Izquierda: Código Temporal (Tiza en Patio) */}
                    <div className="flex items-center space-x-3">
                      <div className="bg-amber-950/50 border-2 border-amber-500/60 rounded-xl px-3.5 py-2 text-center min-w-[110px]">
                        <span className="text-[9px] font-black uppercase text-amber-400 tracking-wider block">
                          TIZA EN PATIO
                        </span>
                        <span className="text-lg sm:text-xl font-black font-mono text-amber-300 tracking-wider">
                          {item.codigo_temporal}
                        </span>
                      </div>

                      <div className="text-slate-500 hidden md:block">
                        <ArrowRight className="w-5 h-5 text-amber-400" />
                      </div>

                      {/* Sección Centro: Etiqueta Oficial a Colocar */}
                      <div className="bg-emerald-950/50 border-2 border-emerald-500/60 rounded-xl px-4 py-2 flex-1">
                        <span className="text-[9px] font-black uppercase text-emerald-400 tracking-wider block">
                          ETIQUETA OFICIAL A ROTULAR
                        </span>
                        {oficial ? (
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span className="text-base sm:text-lg font-black text-white">
                              Colada: <strong className="text-emerald-300 font-mono">{oficial.colada}</strong>
                            </span>
                            <span className="text-sm font-black text-emerald-400 font-mono">
                              ➜ Rollo #{oficial.coil || 'S/N'}
                            </span>
                            <span className="text-xs text-slate-400 font-bold">
                              (Lote {oficial.lote || '---'})
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500 italic">
                            Sin datos oficiales vinculados
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Sección Derecha: Pesos y Auditoría */}
                    <div className="flex items-center justify-between md:justify-end gap-4 border-t md:border-t-0 border-slate-800/80 pt-2 md:pt-0 text-xs">
                      {/* Pesos */}
                      <div className="space-y-0.5 text-left md:text-right">
                        <div className="flex items-center md:justify-end space-x-1.5">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Manifiesto:</span>
                          <span className="font-mono font-bold text-white">
                            {pesoOficial ? `${pesoOficial.toLocaleString()} kg` : '---'}
                          </span>
                        </div>
                        <div className="flex items-center md:justify-end space-x-1.5">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">Báscula Patio:</span>
                          <span className="font-mono font-bold text-amber-400">
                            {pesoPatio ? `${pesoPatio.toLocaleString()} kg` : 'No pesado'}
                          </span>
                        </div>
                      </div>

                      {/* Autorización y Hora */}
                      <div className="bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-right min-w-[120px]">
                        <span className="text-[9px] text-slate-500 uppercase font-black block">
                          Autorizado por
                        </span>
                        <span className="text-xs font-bold text-sky-400 truncate block max-w-[120px]">
                          {item.matched_by || 'Supervisor'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono block">
                          {item.matched_at ? new Date(item.matched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '---'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="text-xs text-slate-400 font-bold">
            Mostrando <strong className="text-white font-mono">{filteredRecords.length}</strong> de{' '}
            <span className="font-mono">{records.length}</span> rollos conciliados
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-750 text-white font-bold text-xs rounded-xl transition cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
