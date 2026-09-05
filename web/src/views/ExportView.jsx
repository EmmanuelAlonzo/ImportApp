import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, RefreshCw, Calendar, User, Layers, Search } from 'lucide-react';

export default function ExportView() {
  const [records, setRecords] = useState([]);
  const [filteredRecords, setFilteredRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Estados de los filtros
  const [selectedDiam, setSelectedDiam] = useState('ALL');
  const [selectedOperator, setSelectedOperator] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Listas de autocompletado en filtros
  const [uniqueDiams, setUniqueDiams] = useState([]);
  const [uniqueOperators, setUniqueOperators] = useState([]);

  useEffect(() => {
    fetchVerifiedRecords();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [selectedDiam, selectedOperator, startDate, endDate, records]);

  const fetchVerifiedRecords = async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase
        .from('registros_importacion')
        .select('lote, diametro, sku, coil, colada, peso, is_verified, verified_by, verified_at')
        .eq('is_verified', true)
        .order('verified_at', { ascending: false });

      if (error) throw error;

      setRecords(data || []);
      setFilteredRecords(data || []);

      // Poblar filtros únicos
      const diams = [...new Set(data.map((r) => r.diametro))].filter(Boolean).sort();
      const operators = [...new Set(data.map((r) => r.verified_by))].filter(Boolean).sort();
      setUniqueDiams(diams);
      setUniqueOperators(operators);
    } catch (err) {
      console.error('Error fetching verified history:', err.message);
      setError('Fallo al recuperar registros de auditoría.');
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let result = [...records];

    if (selectedDiam !== 'ALL') {
      result = result.filter((r) => r.diametro === selectedDiam);
    }

    if (selectedOperator !== 'ALL') {
      result = result.filter((r) => r.verified_by === selectedOperator);
    }

    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      result = result.filter((r) => new Date(r.verified_at) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      result = result.filter((r) => new Date(r.verified_at) <= end);
    }

    setFilteredRecords(result);
  };

  const handleExportExcel = () => {
    if (filteredRecords.length === 0) return;

    // Estructura de columnas corporativa solicitada
    const worksheetData = filteredRecords.map((r) => ({
      'Lote': r.lote,
      'Diámetro (mm)': r.diametro,
      'SKU': r.sku,
      'Coil / Bobina': r.coil || 'S/N',
      'Colada': r.colada || '',
      'Peso (kg)': r.peso || 0,
      'Responsable': r.verified_by || '',
      'Fecha de Auditoría': r.verified_at ? new Date(r.verified_at).toLocaleString() : ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte de Auditoría');

    // Auto-ajustar anchos de columnas
    const maxColWidth = worksheetData.reduce((acc, row) => {
      Object.keys(row).forEach((key, colIdx) => {
        const valLen = String(row[key] || '').length;
        acc[colIdx] = Math.max(acc[colIdx] || 0, valLen, key.length);
      });
      return acc;
    }, []);
    worksheet['!cols'] = maxColWidth.map((w) => ({ wch: w + 2 }));

    XLSX.writeFile(workbook, `Reporte_Inventario_Digital_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleExportCSV = () => {
    if (filteredRecords.length === 0) return;

    const headers = "Lote,Diámetro,SKU,Coil/Bobina,Colada,Peso (kg),Responsable,Fecha de Auditoría\n";
    const rows = filteredRecords
      .map((r) => 
        `"${r.lote}","${r.diametro}","${r.sku}","${r.coil || 'S/N'}","${r.colada || ''}",${r.peso || 0},"${r.verified_by || ''}","${r.verified_at ? new Date(r.verified_at).toLocaleString() : ''}"`
      )
      .join("\n");

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Reporte_Inventario_Digital_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setSelectedDiam('ALL');
    setSelectedOperator('ALL');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6">
      {/* Filtros Card */}
      <div className="bg-slate-800 rounded-3xl border border-slate-700 p-6 shadow-xl space-y-4">
        <h3 className="text-xs font-bold text-slate-400 tracking-widest uppercase flex items-center">
          <Search className="w-4 h-4 mr-2 text-sky-400" />
          Filtros de Búsqueda
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Diámetro */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 tracking-wider">DIÁMETRO</label>
            <div className="relative">
              <select
                value={selectedDiam}
                onChange={(e) => setSelectedDiam(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none appearance-none"
              >
                <option value="ALL">TODOS</option>
                {uniqueDiams.map((d) => (
                  <option key={d} value={d}>
                    {d} MM
                  </option>
                ))}
              </select>
              <Layers className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            </div>
          </div>

          {/* Operador */}
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold text-slate-400 tracking-wider">AUDITOR / OPERARIO</label>
            <div className="relative">
              <select
                value={selectedOperator}
                onChange={(e) => setSelectedOperator(e.target.value)}
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none appearance-none"
              >
                <option value="ALL">TODOS</option>
                {uniqueOperators.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
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
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none"
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
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
                className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 pl-10 font-bold focus:border-sky-400 focus:outline-none"
              />
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={clearFilters}
            className="px-4 py-2 border border-slate-650 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition"
          >
            LIMPIAR FILTROS
          </button>

          <button
            type="button"
            onClick={fetchVerifiedRecords}
            className="px-4 py-2 border border-sky-500/40 hover:bg-sky-500/10 text-sky-400 rounded-xl text-xs font-bold transition flex items-center space-x-1"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>ACTUALIZAR TABLA</span>
          </button>
        </div>
      </div>

      {/* Export Options & Actions */}
      <div className="flex flex-col md:flex-row justify-between items-center bg-slate-950 p-4 rounded-2xl border border-slate-800 shadow-inner gap-4">
        <div>
          <span className="text-xs text-slate-400 font-bold">
            Registros Encontrados: <span className="text-white text-sm">{filteredRecords.length}</span>
          </span>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={handleExportCSV}
            disabled={filteredRecords.length === 0}
            className="px-5 py-3 bg-slate-800 border border-slate-700 hover:bg-slate-750 text-slate-200 hover:text-white rounded-xl text-xs font-black tracking-wider transition active:scale-95 flex items-center space-x-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Download className="w-4 h-4" />
            <span>DESCARGAR CSV</span>
          </button>

          <button
            onClick={handleExportExcel}
            disabled={filteredRecords.length === 0}
            className="px-5 py-3 bg-emerald-500 text-slate-900 hover:bg-emerald-400 rounded-xl text-xs font-black tracking-wider transition active:scale-95 flex items-center space-x-2 shadow-lg shadow-emerald-500/10 disabled:opacity-40 disabled:pointer-events-none"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>EXPORTAR A EXCEL (.XLSX)</span>
          </button>
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="bg-red-950/60 border border-red-500/50 text-red-200 text-sm px-4 py-3 rounded-xl text-center font-bold tracking-wide">
          {error}
        </div>
      )}

      {/* Table Auditoria View */}
      <div className="bg-slate-800 border border-slate-700 rounded-3xl overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-16 text-center flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
            <p className="text-slate-400 text-xs font-bold tracking-wider uppercase">Cargando registros históricos...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
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
                  <th className="p-4">COIL / BOBINA</th>
                  <th className="p-4">COLADA</th>
                  <th className="p-4 text-right">PESO (KG)</th>
                  <th className="p-4">RESPONSABLE</th>
                  <th className="p-4">FECHA AUDITORÍA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50 text-sm font-medium">
                {filteredRecords.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-900/30 transition">
                    <td className="p-4 font-bold text-white font-mono">{r.lote}</td>
                    <td className="p-4 text-slate-300">{r.diametro} MM</td>
                    <td className="p-4 text-slate-400 text-xs font-mono">{r.sku}</td>
                    <td className="p-4 text-slate-300">{r.coil || 'S/N'}</td>
                    <td className="p-4 text-sky-400 font-mono text-xs">{r.colada || '-'}</td>
                    <td className="p-4 text-right text-emerald-400 font-bold">
                      {r.peso ? parseFloat(r.peso).toLocaleString() : '0.00'}
                    </td>
                    <td className="p-4 text-slate-300">{r.verified_by}</td>
                    <td className="p-4 text-slate-450 text-xs">
                      {r.verified_at ? new Date(r.verified_at).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
