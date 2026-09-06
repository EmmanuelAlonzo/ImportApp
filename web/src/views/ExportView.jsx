import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import * as XLSX from 'xlsx';
import {
  Download,
  FileSpreadsheet,
  RefreshCw,
  Calendar,
  User,
  Layers,
  Search,
  Loader2,
  AlertTriangle,
  Zap,
  Timer,
  CheckCircle2,
  BarChart3,
  Clock,
  Users
} from 'lucide-react';

export default function ExportView() {
  const [records, setRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [diameterStats, setDiameterStats] = useState([]);
  const [userRoles, setUserRoles] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Estados de filtros
  const [selectedDiam, setSelectedDiam] = useState('ALL');
  const [selectedOperator, setSelectedOperator] = useState('ALL');
  const [selectedMode, setSelectedMode] = useState('ALL'); // 'ALL' | 'MODO_1' | 'MODO_2'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Listas de autocompletado en filtros
  const [uniqueDiams, setUniqueDiams] = useState([]);
  const [uniqueOperators, setUniqueOperators] = useState([]);

  useEffect(() => {
    fetchReportData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [selectedDiam, selectedOperator, selectedMode, startDate, endDate, records]);

  const fetchReportData = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Obtener registros verificados con verificación de columna verification_mode
      let { data: verifiedData, error: errVerified } = await supabase
        .from('registros_importacion')
        .select('lote, diametro, sku, coil, colada, peso, is_verified, verified_by, verified_at, verification_mode')
        .eq('is_verified', true)
        .order('verified_at', { ascending: false });

      // Fallback si la columna verification_mode aún no existe en Supabase
      if (errVerified && (errVerified.code === 'PGRST204' || errVerified.message?.includes('verification_mode'))) {
        const fallback = await supabase
          .from('registros_importacion')
          .select('lote, diametro, sku, coil, colada, peso, is_verified, verified_by, verified_at')
          .eq('is_verified', true)
          .order('verified_at', { ascending: false });
        verifiedData = fallback.data;
        errVerified = fallback.error;
      }
      if (errVerified) throw errVerified;

      // 2. Obtener resumen de todos los calibres (Pendientes vs Verificados)
      const { data: allDiamData, error: errDiam } = await supabase
        .from('registros_importacion')
        .select('diametro, is_verified');

      if (errDiam) {
        console.warn('Advertencia al consultar calibres para gráfico de avance:', errDiam);
      }

      // 3. Obtener catálogo de usuarios para roles en Distribución por Operador
      const { data: usersData, error: errUsers } = await supabase
        .from('usuarios_app')
        .select('id, nombre, rol');

      if (errUsers) {
        console.warn('Advertencia al consultar usuarios para roles:', errUsers);
      }

      const safeVerified = Array.isArray(verifiedData) ? verifiedData : [];
      setRecords(safeVerified);

      // Mapear catálogo de roles
      const rolesMap = {};
      (usersData || []).forEach((u) => {
        const name = (u.nombre || u.Nombre || '').toUpperCase().trim();
        if (name) rolesMap[name] = u.rol || 'OPERADOR';
      });
      setUserRoles(rolesMap);

      // Agrupar Pendientes vs Verificados por Calibre
      const diamMap = {};
      (allDiamData || []).forEach((row) => {
        const diam = String(row.diametro || 'S/D').trim();
        if (!diamMap[diam]) {
          diamMap[diam] = { diameter: diam, verified: 0, pending: 0, total: 0 };
        }
        diamMap[diam].total += 1;
        if (row.is_verified) {
          diamMap[diam].verified += 1;
        } else {
          diamMap[diam].pending += 1;
        }
      });

      const sortedDiamStats = Object.values(diamMap)
        .map((item) => ({
          ...item,
          percent: item.total > 0 ? Math.round((item.verified / item.total) * 100) : 0,
        }))
        .sort((a, b) => {
          const numA = parseFloat(a.diameter);
          const numB = parseFloat(b.diameter);
          if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
          return a.diameter.localeCompare(b.diameter);
        });

      setDiameterStats(sortedDiamStats);

      // Poblar filtros únicos
      const diams = [...new Set(safeVerified.map((r) => r?.diametro))].filter(Boolean).sort();
      const operators = [...new Set(safeVerified.map((r) => r?.verified_by))].filter(Boolean).sort();
      setUniqueDiams(diams);
      setUniqueOperators(operators);
    } catch (err) {
      console.error('Error al recuperar historial de reportería:', err.message);
      setError('Fallo al recuperar registros de auditoría y métricas operativas.');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let result = Array.isArray(records) ? [...records] : [];

    if (selectedDiam !== 'ALL') {
      result = result.filter((r) => String(r?.diametro) === String(selectedDiam));
    }

    if (selectedOperator !== 'ALL') {
      result = result.filter((r) => String(r?.verified_by) === String(selectedOperator));
    }

    if (selectedMode === 'MODO_1') {
      result = result.filter((r) => {
        const m = (r?.verification_mode || '').toLowerCase();
        return !m.includes('2') && !m.includes('búsqueda') && !m.includes('busqueda') && !m.includes('manual');
      });
    } else if (selectedMode === 'MODO_2') {
      result = result.filter((r) => {
        const m = (r?.verification_mode || '').toLowerCase();
        return m.includes('2') || m.includes('búsqueda') || m.includes('busqueda') || m.includes('manual');
      });
    }

    if (startDate) {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        result = result.filter((r) => {
          if (!r?.verified_at) return false;
          const d = new Date(r.verified_at);
          return !isNaN(d.getTime()) && d >= start;
        });
      }
    }

    if (endDate) {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        result = result.filter((r) => {
          if (!r?.verified_at) return false;
          const d = new Date(r.verified_at);
          return !isNaN(d.getTime()) && d <= end;
        });
      }
    }

    setFilteredRecords(result);
  };

  // Cálculo de Métricas y KPIs Operativos
  const kpis = useMemo(() => {
    if (!filteredRecords || filteredRecords.length === 0) {
      return {
        pacePerHour: 0,
        avgCycleMinutes: 0,
        modo1Count: 0,
        modo2Count: 0,
        modo1Percent: 100,
        modo2Percent: 0,
        totalVerified: 0,
        totalWeightKg: 0,
        hourlyData: [],
        operatorsList: []
      };
    }

    const totalVerified = filteredRecords.length;
    let totalWeightKg = 0;
    let modo1Count = 0;
    let modo2Count = 0;

    filteredRecords.forEach((r) => {
      totalWeightKg += parseFloat(r.peso) || 0;
      const m = (r.verification_mode || '').toLowerCase();
      if (m.includes('2') || m.includes('búsqueda') || m.includes('busqueda') || m.includes('manual')) {
        modo2Count += 1;
      } else {
        modo1Count += 1;
      }
    });

    const modo1Percent = totalVerified > 0 ? Math.round((modo1Count / totalVerified) * 100) : 0;
    const modo2Percent = totalVerified > 0 ? 100 - modo1Percent : 0;

    // Cálculo de Ritmo Promedio y Tiempo de Ciclo
    const validTimeRecords = filteredRecords
      .filter((r) => r.verified_at && !isNaN(new Date(r.verified_at).getTime()))
      .map((r) => ({ ...r, timestamp: new Date(r.verified_at).getTime() }))
      .sort((a, b) => a.timestamp - b.timestamp);

    let pacePerHour = 0;
    let avgCycleMinutes = 0;

    if (validTimeRecords.length >= 2) {
      const minTime = validTimeRecords[0].timestamp;
      const maxTime = validTimeRecords[validTimeRecords.length - 1].timestamp;
      const activeSpanHours = (maxTime - minTime) / (1000 * 60 * 60);

      if (activeSpanHours > 0.05) {
        pacePerHour = Math.round((validTimeRecords.length / activeSpanHours) * 10) / 10;
      } else {
        pacePerHour = Math.round(validTimeRecords.length * 10);
      }

      // Tiempo de ciclo: deltas entre verificaciones consecutivas
      const activeDeltas = [];
      for (let i = 1; i < validTimeRecords.length; i++) {
        const diffMin = (validTimeRecords[i].timestamp - validTimeRecords[i - 1].timestamp) / (1000 * 60);
        // Excluir pausas no operativas (> 45 min)
        if (diffMin > 0 && diffMin <= 45) {
          activeDeltas.push(diffMin);
        }
      }

      if (activeDeltas.length > 0) {
        const sumDeltas = activeDeltas.reduce((a, b) => a + b, 0);
        avgCycleMinutes = Math.round((sumDeltas / activeDeltas.length) * 10) / 10;
      } else if (activeSpanHours > 0) {
        avgCycleMinutes = Math.round(((activeSpanHours * 60) / validTimeRecords.length) * 10) / 10;
      }
    } else if (validTimeRecords.length === 1) {
      pacePerHour = 1;
      avgCycleMinutes = 1.0;
    }

    // Histograma de Curva de Descarga por Hora
    const hourlyMap = {};
    validTimeRecords.forEach((r) => {
      const h = new Date(r.timestamp).getHours();
      hourlyMap[h] = (hourlyMap[h] || 0) + 1;
    });

    let minHour = 7;
    let maxHour = 18;
    if (validTimeRecords.length > 0) {
      const recordedHours = validTimeRecords.map((r) => new Date(r.timestamp).getHours());
      minHour = Math.min(...recordedHours);
      maxHour = Math.max(...recordedHours);
      if (maxHour - minHour < 5) {
        minHour = Math.max(0, minHour - 2);
        maxHour = Math.min(23, maxHour + 3);
      }
    }

    const hourlyData = [];
    for (let h = minHour; h <= maxHour; h++) {
      const label = `${String(h).padStart(2, '0')}:00`;
      const count = hourlyMap[h] || 0;
      hourlyData.push({
        hour: h,
        label,
        count,
        isDowntime: count === 0
      });
    }

    // Distribución por Operador
    const opMap = {};
    filteredRecords.forEach((r) => {
      const name = (r.verified_by || 'Sin Asignar').trim().toUpperCase();
      if (!opMap[name]) {
        opMap[name] = {
          name,
          role: userRoles[name] || 'VERIFICADOR',
          count: 0
        };
      }
      opMap[name].count += 1;
    });

    const operatorsList = Object.values(opMap)
      .map((op) => ({
        ...op,
        percentage: totalVerified > 0 ? Math.round((op.count / totalVerified) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count);

    return {
      pacePerHour,
      avgCycleMinutes,
      modo1Count,
      modo2Count,
      modo1Percent,
      modo2Percent,
      totalVerified,
      totalWeightKg,
      hourlyData,
      operatorsList
    };
  }, [filteredRecords, userRoles]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '-' : d.toLocaleString();
  };

  const formatWeight = (peso) => {
    if (peso === null || peso === undefined || peso === '') return '0.00';
    const n = parseFloat(peso);
    return isNaN(n) ? '0.00' : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleExportExcel = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;

    // Columnas requeridas: Bobina/Coil, Diámetro, Colada/Heat, Operario Verificador, Modo de Verificación y Fecha/Hora exacta
    const worksheetData = filteredRecords.map((r) => ({
      'Lote': r?.lote || '',
      'Diámetro (mm)': r?.diametro || '',
      'SKU': r?.sku || '',
      'Bobina / Coil': r?.coil || 'S/N',
      'Colada / Heat': r?.colada || '',
      'Peso (kg)': r?.peso ? Number(r.peso) : 0,
      'Operario Verificador': r?.verified_by || '',
      'Modo de Verificación': r?.verification_mode || 'Modo 1 (Secuencial)',
      'Fecha / Hora Exacta': formatDate(r?.verified_at)
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Auditoría de Verificación');

    const maxColWidth = worksheetData.reduce((acc, row) => {
      Object.keys(row).forEach((key, colIdx) => {
        const valLen = String(row[key] || '').length;
        acc[colIdx] = Math.max(acc[colIdx] || 0, valLen, key.length);
      });
      return acc;
    }, []);
    worksheet['!cols'] = maxColWidth.map((w) => ({ wch: w + 2 }));

    XLSX.writeFile(workbook, `Reporte_Trazabilidad_Planta_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportCSV = () => {
    if (!filteredRecords || filteredRecords.length === 0) return;

    const headers = "Lote,Diámetro (mm),SKU,Bobina/Coil,Colada/Heat,Peso (kg),Operario Verificador,Modo de Verificación,Fecha/Hora Exacta\n";
    const rows = filteredRecords
      .map((r) =>
        `"${r?.lote || ''}","${r?.diametro || ''}","${r?.sku || ''}","${r?.coil || 'S/N'}","${r?.colada || ''}",${r?.peso || 0},"${r?.verified_by || ''}","${r?.verification_mode || 'Modo 1 (Secuencial)'}","${formatDate(r?.verified_at)}"`
      )
      .join("\n");

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_Trazabilidad_Planta_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setSelectedDiam('ALL');
    setSelectedOperator('ALL');
    setSelectedMode('ALL');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6">
      {/* 1. KPIs Operativos Clave (Tarjetas Superiores) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Ritmo Promedio */}
        <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">RITMO PROMEDIO</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-black text-white font-mono tracking-tight">{kpis.pacePerHour}</span>
            <span className="text-[11px] font-bold text-amber-400 uppercase">bob / hr</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium mt-1">Velocidad en tiempo activo de turno</p>
        </div>

        {/* Card 2: Tiempo de Ciclo Estimado */}
        <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">TIEMPO DE CICLO</span>
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <Timer className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-black text-white font-mono tracking-tight">{kpis.avgCycleMinutes}</span>
            <span className="text-[11px] font-bold text-sky-400 uppercase">min / bobina</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium mt-1">Cadencia promedio entre validaciones</p>
        </div>

        {/* Card 3: Ratio Modo 1 vs Modo 2 */}
        <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">RATIO MODO 1 / MODO 2</span>
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between text-xs font-mono font-black mb-1.5">
            <span className="text-cyan-400">M1: {kpis.modo1Percent}%</span>
            <span className="text-purple-400">M2: {kpis.modo2Percent}%</span>
          </div>
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden flex mb-1">
            <div
              style={{ width: `${kpis.modo1Percent}%` }}
              className="bg-cyan-500 h-full transition-all duration-500"
              title={`Modo 1: ${kpis.modo1Count}`}
            />
            <div
              style={{ width: `${kpis.modo2Percent}%` }}
              className="bg-purple-500 h-full transition-all duration-500"
              title={`Modo 2: ${kpis.modo2Count}`}
            />
          </div>
          <p className="text-[10px] text-slate-400 font-medium">Secuencial ({kpis.modo1Count}) vs Búsqueda ({kpis.modo2Count})</p>
        </div>

        {/* Card 4: Total Auditado y Masa */}
        <div className="bg-slate-800 rounded-3xl border border-slate-700 p-5 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase">TOTAL AUDITADO</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-black text-emerald-400 font-mono tracking-tight">{kpis.totalVerified}</span>
            <span className="text-[11px] font-bold text-slate-300 uppercase">bobinas</span>
          </div>
          <p className="text-[10px] text-slate-400 font-medium mt-1">
            Masa total: <strong className="text-slate-200 font-mono">{formatWeight(kpis.totalWeightKg)} kg</strong>
          </p>
        </div>
      </div>

      {/* 2. Visualizaciones de Trazabilidad */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Avance por Diámetro (Pendientes vs Verificados) */}
        <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-3">
            <div>
              <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
                <BarChart3 className="w-4 h-4 mr-2 text-emerald-400" />
                Avance por Diámetro
              </h3>
              <p className="text-[10px] text-slate-500 font-medium mt-0.5">
                Comparativa de calibres: Verificados vs Pendientes en planta
              </p>
            </div>
            <div className="flex items-center space-x-3 text-[10px] font-bold">
              <div className="flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="text-slate-350">Verificados</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-2 h-2 rounded-full bg-slate-600"></span>
                <span className="text-slate-450">Pendientes</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {diameterStats.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs font-bold">Cargando balance de calibres...</div>
            ) : (
              diameterStats.map((item) => (
                <div key={item.diameter} className="bg-slate-950/50 p-3 rounded-2xl border border-slate-700/50 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 bg-slate-800 border border-slate-600 text-white font-mono font-black rounded-md text-[11px]">
                        Ø {item.diameter} MM
                      </span>
                      <span className="text-[10px] text-slate-400 font-medium">
                        <strong className="text-emerald-400 font-bold">{item.verified}</strong> verif •{' '}
                        <strong className="text-slate-400 font-bold">{item.pending}</strong> pend
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] text-slate-500 font-mono">Total: {item.total}</span>
                      <span className="px-2 py-0.5 bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 rounded font-black text-[10px]">
                        {item.percent}%
                      </span>
                    </div>
                  </div>

                  {/* Barra apilada */}
                  <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden flex">
                    <div
                      style={{ width: `${item.percent}%` }}
                      className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-l-full transition-all duration-500 shadow-sm shadow-emerald-500/20"
                    />
                    <div
                      style={{ width: `${100 - item.percent}%` }}
                      className="bg-slate-700/60 h-full rounded-r-full"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Distribución por Operador */}
        <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl space-y-4">
          <div className="border-b border-slate-700 pb-3">
            <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
              <Users className="w-4 h-4 mr-2 text-sky-400" />
              Distribución por Operador
            </h3>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
              Rendimiento y volumen de bobinas validadas en turno por usuario
            </p>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {kpis.operatorsList.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-xs font-bold">Sin actividad registrada en este filtro</div>
            ) : (
              kpis.operatorsList.map((op) => (
                <div key={op.name} className="bg-slate-950/50 p-3 rounded-2xl border border-slate-700/50 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-7 h-7 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-[10px] font-black text-sky-300">
                        {op.name.slice(0, 2)}
                      </div>
                      <div>
                        <span className="text-xs font-bold text-white block">{op.name}</span>
                        <span className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">{op.role}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-emerald-400 font-mono block">
                        {op.count} <span className="text-[9px] text-slate-400 font-normal">bobinas</span>
                      </span>
                      <span className="text-[10px] font-bold text-sky-400">{op.percentage}% del total</span>
                    </div>
                  </div>

                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${op.percentage}%` }}
                      className="bg-gradient-to-r from-sky-500 to-indigo-500 h-full rounded-full transition-all duration-500"
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 3. Curva de Descarga por Hora (Histograma) */}
      <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700 pb-3">
          <div>
            <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
              <Clock className="w-4 h-4 mr-2 text-sky-400" />
              Curva de Descarga por Hora
            </h3>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5">
              Distribución temporal de bobinas verificadas (identificación visual de tiempos muertos)
            </p>
          </div>
          <div className="flex items-center space-x-3 text-[10px] font-bold">
            <div className="flex items-center space-x-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-gradient-to-t from-sky-500 to-emerald-400" />
              <span className="text-slate-300">Actividad</span>
            </div>
            <div className="flex items-center space-x-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-amber-500/30 border border-amber-500/50" />
              <span className="text-amber-400/80">Tiempo Muerto</span>
            </div>
          </div>
        </div>

        {kpis.hourlyData.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs font-bold">Sin registros de horas para mostrar</div>
        ) : (
          <div className="pt-4">
            <div className="h-44 flex items-end gap-2 sm:gap-3 px-2 overflow-x-auto scrollbar-none pb-2">
              {kpis.hourlyData.map((d) => {
                const maxCount = Math.max(...kpis.hourlyData.map((item) => item.count), 1);
                const heightPercent = d.count > 0 ? Math.max(16, Math.round((d.count / maxCount) * 100)) : 6;

                return (
                  <div key={d.label} className="flex-1 min-w-[36px] flex flex-col items-center group h-full justify-end">
                    {/* Conteo superior */}
                    <div className="text-[10px] font-mono font-bold mb-1.5 transition-all opacity-70 group-hover:opacity-100 group-hover:scale-110">
                      {d.count > 0 ? (
                        <span className="text-sky-300">{d.count}</span>
                      ) : (
                        <span className="text-amber-500/60 text-[9px]">0</span>
                      )}
                    </div>

                    {/* Barra */}
                    <div
                      style={{ height: `${heightPercent}%` }}
                      className={`w-full rounded-t-lg transition-all duration-300 ${
                        d.count > 0
                          ? 'bg-gradient-to-t from-sky-600 via-sky-500 to-emerald-400 shadow-md shadow-sky-500/10 group-hover:brightness-125'
                          : 'bg-amber-950/30 border border-dashed border-amber-500/30 group-hover:bg-amber-900/40'
                      }`}
                      title={`${d.label}: ${d.count} bobinas ${d.count === 0 ? '(Tiempo muerto potencial)' : ''}`}
                    />

                    {/* Eje X */}
                    <div className="text-[9px] font-mono font-bold text-slate-400 mt-2 tracking-tighter whitespace-nowrap">
                      {d.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 4. Filtros de Búsqueda */}
      <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl space-y-4">
        <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
          <Search className="w-4 h-4 mr-2 text-sky-400" />
          Filtros de Auditoría
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
          {/* Diámetro */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 tracking-wider">DIÁMETRO</label>
            <div className="relative">
              <select
                value={selectedDiam}
                onChange={(e) => setSelectedDiam(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="ALL">TODOS</option>
                {(uniqueDiams || []).map((d) => (
                  <option key={d} value={d}>
                    {d} MM
                  </option>
                ))}
              </select>
              <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Operador */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 tracking-wider">AUDITOR / OPERARIO</label>
            <div className="relative">
              <select
                value={selectedOperator}
                onChange={(e) => setSelectedOperator(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="ALL">TODOS</option>
                {(uniqueOperators || []).map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Modo de Verificación */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 tracking-wider">MODO</label>
            <div className="relative">
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none appearance-none cursor-pointer"
              >
                <option value="ALL">TODOS</option>
                <option value="MODO_1">MODO 1 (SECUENCIAL)</option>
                <option value="MODO_2">MODO 2 (BÚSQUEDA)</option>
              </select>
              <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Fecha Inicio */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 tracking-wider">FECHA DESDE</label>
            <div className="relative">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none cursor-pointer"
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Fecha Fin */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 tracking-wider">FECHA HASTA</label>
            <div className="relative">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none cursor-pointer"
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={clearFilters}
            className="px-4 py-2 border border-slate-600 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            LIMPIAR FILTROS
          </button>

          <button
            type="button"
            onClick={fetchReportData}
            className="px-4 py-2 border border-sky-500/40 hover:bg-sky-500/10 text-sky-400 rounded-xl text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>ACTUALIZAR DATOS</span>
          </button>
        </div>
      </div>

      {/* 5. Acciones de Exportación */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-slate-950 p-4 rounded-2xl border border-slate-800 shadow-inner gap-4">
        <div>
          <span className="text-xs text-slate-400 font-bold">
            Registros Filtrados: <span className="text-white text-sm font-extrabold">{filteredRecords?.length || 0}</span>
          </span>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={handleExportCSV}
            disabled={!filteredRecords || filteredRecords.length === 0}
            className="px-5 py-3 bg-slate-800 border border-slate-700 hover:bg-slate-750 text-slate-200 hover:text-white rounded-xl text-xs font-black tracking-wider transition active:scale-95 flex items-center space-x-2 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>DESCARGAR CSV</span>
          </button>

          <button
            onClick={handleExportExcel}
            disabled={!filteredRecords || filteredRecords.length === 0}
            className="px-5 py-3 bg-emerald-500 text-slate-900 hover:bg-emerald-400 rounded-xl text-xs font-black tracking-wider transition active:scale-95 flex items-center space-x-2 shadow-lg shadow-emerald-500/10 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>EXPORTAR A EXCEL (.XLSX)</span>
          </button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="bg-red-950/60 border border-red-500/50 text-red-200 text-sm px-4 py-3 rounded-xl text-center font-bold tracking-wide flex items-center justify-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 6. Tabla de Auditoría Detallada */}
      <div className="bg-slate-800 border border-slate-700 rounded-3xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-16 text-center flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
            <p className="text-slate-400 text-xs font-bold tracking-wider uppercase">Cargando registros históricos...</p>
          </div>
        ) : (!filteredRecords || filteredRecords.length === 0) ? (
          <div className="p-16 text-center text-slate-500 font-bold text-xs uppercase tracking-wider">
            No se encontraron registros que coincidan con los filtros aplicados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-950/50 border-b border-slate-700 text-[10px] font-black text-slate-400 tracking-wider">
                  <th className="p-4">LOTE</th>
                  <th className="p-4">DIÁMETRO</th>
                  <th className="p-4">SKU</th>
                  <th className="p-4">BOBINA / COIL</th>
                  <th className="p-4">COLADA / HEAT</th>
                  <th className="p-4">MODO</th>
                  <th className="p-4 text-right">PESO (KG)</th>
                  <th className="p-4">OPERARIO VERIFICADOR</th>
                  <th className="p-4">FECHA / HORA EXACTA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50 text-sm font-medium">
                {filteredRecords.map((r, i) => {
                  const modeStr = (r?.verification_mode || '').toLowerCase();
                  const isModo2 = modeStr.includes('2') || modeStr.includes('búsqueda') || modeStr.includes('busqueda') || modeStr.includes('manual');

                  return (
                    <tr key={i} className="hover:bg-slate-900/30 transition">
                      <td className="p-4 font-bold text-white font-mono">{r?.lote || '-'}</td>
                      <td className="p-4 text-slate-300 font-bold">{r?.diametro ? `${r.diametro} MM` : '-'}</td>
                      <td className="p-4 text-slate-400 text-xs font-mono">{r?.sku || '-'}</td>
                      <td className="p-4 text-slate-200 font-mono font-bold">{r?.coil || 'S/N'}</td>
                      <td className="p-4 text-sky-400 font-mono text-xs">{r?.colada || '-'}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase font-mono tracking-wider ${
                            isModo2
                              ? 'bg-purple-950/70 border border-purple-500/40 text-purple-300'
                              : 'bg-cyan-950/70 border border-cyan-500/40 text-cyan-300'
                          }`}
                        >
                          {r?.verification_mode || 'Modo 1'}
                        </span>
                      </td>
                      <td className="p-4 text-right text-emerald-400 font-bold font-mono">
                        {formatWeight(r?.peso)}
                      </td>
                      <td className="p-4 text-slate-300 font-bold">{r?.verified_by || '-'}</td>
                      <td className="p-4 text-slate-400 text-xs font-mono">
                        {formatDate(r?.verified_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
