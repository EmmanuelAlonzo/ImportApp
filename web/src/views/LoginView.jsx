import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import Keypad from '../components/Keypad';
import { Lock, User as UserIcon } from 'lucide-react';

export default function LoginView() {
  const { login } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('usuarios_app')
        .select('*')
        .eq('activo', true)
        .neq('rol', 'SUSPENDIDO')
        .order('nombre', { ascending: true });

      if (error) throw error;
      setUsers(data || []);
      if (data && data.length > 0) {
        setSelectedUser(data[0].id);
      }
    } catch (err) {
      console.error('Error fetching users:', err.message);
      setError('No se pudo conectar con el servidor de base de datos.');
    } finally {
      setLoading(false);
    }
  };

  const handleDigitPress = (digit) => {
    if (pin.length < 4) {
      const nextPin = pin + digit;
      setPin(nextPin);
      setError('');
      if (nextPin.length === 4) {
        submitLogin(selectedUser, nextPin);
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError('');
  };

  const submitLogin = async (userId, pinValue) => {
    if (!userId) {
      setError('Por favor seleccione un operario.');
      setPin('');
      return;
    }
    setVerifying(true);
    const result = await login(userId, pinValue);
    if (!result.success) {
      setError(result.error);
      setPin('');
    }
    setVerifying(false);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-slate-900 text-slate-100 p-6 select-none">
      <div className="w-full max-w-md bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden">
        {/* Top Header Card */}
        <div className="bg-slate-950 p-6 border-b border-slate-800 text-center">
          <div className="w-14 h-14 bg-slate-900 border border-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
            <Lock className="w-6 h-6 text-red-500" />
          </div>
          <h2 className="text-lg font-black tracking-wider text-white">ACCESO DE PLANTA</h2>
          <p className="text-[10px] text-slate-400 font-mono tracking-widest mt-1">SISTEMA DE CONTROL v4.8</p>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-950/60 border border-red-500/50 text-red-200 text-xs px-4 py-3 rounded-xl text-center font-bold tracking-wide animate-pulse">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="w-8 h-8 border-4 border-slate-700 border-t-red-500 rounded-full animate-spin"></div>
              <p className="text-xs text-slate-400 font-black tracking-wider uppercase">Cargando catálogo...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Dropdown Operario */}
              <div className="space-y-2">
                <label className="block text-[10px] font-black text-slate-400 tracking-wider">SELECCIÓN DE OPERARIO</label>
                <div className="relative">
                  <select
                    value={selectedUser}
                    onChange={(e) => {
                      setSelectedUser(e.target.value);
                      setPin('');
                      setError('');
                    }}
                    className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-4 pl-12 font-bold focus:border-red-500 focus:outline-none appearance-none cursor-pointer"
                    disabled={verifying}
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre || u.Nombre}
                      </option>
                    ))}
                  </select>
                  <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                </div>
              </div>

              {/* PIN circles display */}
              <div className="flex flex-col items-center space-y-3 py-2">
                <span className="text-[10px] font-black text-slate-400 tracking-wider">CÓDIGO DE IDENTIFICACIÓN</span>
                <div className="flex space-x-5">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`w-4 h-4 rounded-full border transition-all duration-150 ${
                        i < pin.length
                          ? 'bg-red-500 border-red-500 scale-110 shadow-lg shadow-red-500/30'
                          : 'bg-slate-950 border-slate-600'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Teclado */}
              <div className={verifying ? 'pointer-events-none opacity-50' : ''}>
                <Keypad
                  onDigitPress={handleDigitPress}
                  onClear={handleClear}
                  onDelete={handleDelete}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
