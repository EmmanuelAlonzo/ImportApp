import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import Keypad from '../components/Keypad';
import { Lock, User as UserIcon, AlertTriangle, ShieldAlert, KeyRound, Loader2, CheckCircle2 } from 'lucide-react';

export default function LoginView() {
  const { login, forceSessionOverride, completeLoginAfterPinReset } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  // Estados para control de sesión única
  const [sessionConflictUser, setSessionConflictUser] = useState(null);
  const [forcingOverride, setForcingOverride] = useState(false);

  // Estados para reseteo obligatorio de PIN
  const [showPinResetModal, setShowPinResetModal] = useState(false);
  const [pendingResetUser, setPendingResetUser] = useState(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinResetError, setPinResetError] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('usuarios_app')
        .select('*')
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
      setSessionConflictUser(null);
      if (nextPin.length === 4) {
        submitLogin(selectedUser, nextPin);
      }
    }
  };

  const handleClear = () => {
    setPin('');
    setError('');
    setSessionConflictUser(null);
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError('');
    setSessionConflictUser(null);
  };

  const submitLogin = async (userId, pinValue) => {
    if (!userId) {
      setError('Por favor seleccione un operario.');
      setPin('');
      return;
    }

    // Validación de usuario suspendido
    const matchedUser = users.find((u) => String(u.id) === String(userId));
    if (matchedUser && (matchedUser.activo === false || matchedUser.is_active === false || (matchedUser.rol && matchedUser.rol.toUpperCase() === 'SUSPENDIDO'))) {
      setError("Usuario suspendido. Consulte con el Administrador");
      setPin('');
      return;
    }

    setVerifying(true);
    setSessionConflictUser(null);
    const result = await login(userId, pinValue);

    if (result.sessionConflict) {
      setError('Este usuario ya tiene una sesión abierta en otro dispositivo.');
      setSessionConflictUser(result.user || matchedUser);
      setPin('');
    } else if (result.requiresPinReset) {
      setPendingResetUser(result.user || matchedUser);
      setShowPinResetModal(true);
      setPin('');
      setError('');
    } else if (!result.success) {
      setError(result.error || 'PIN INCORRECTO. Acceso denegado.');
      setPin('');
    }
    setVerifying(false);
  };

  const handleForceOverride = async () => {
    if (!sessionConflictUser?.id) return;
    setForcingOverride(true);
    setError('');
    try {
      const result = await forceSessionOverride(sessionConflictUser.id);
      if (result.requiresPinReset) {
        setPendingResetUser(result.user);
        setShowPinResetModal(true);
        setSessionConflictUser(null);
      } else if (!result.success) {
        setError(result.error || 'Error al forzar el cierre de sesión en otro dispositivo.');
      }
    } catch (err) {
      setError(err.message || 'Fallo al invalidar sesión remota.');
    } finally {
      setForcingOverride(false);
    }
  };

  const handleSaveNewPin = async (e) => {
    if (e) e.preventDefault();
    setPinResetError('');

    if (newPin.length !== 4 || isNaN(newPin)) {
      setPinResetError('El nuevo PIN debe tener exactamente 4 dígitos numéricos.');
      return;
    }
    if (newPin === '0000') {
      setPinResetError('El nuevo PIN no puede ser el código temporal 0000.');
      return;
    }
    if (newPin !== confirmPin) {
      setPinResetError('Los códigos PIN ingresados no coinciden.');
      return;
    }

    setSavingPin(true);
    try {
      let updateError = null;
      try {
        const { error } = await supabase
          .from('usuarios_app')
          .update({
            pin: newPin.trim(),
            requires_pin_reset: false
          })
          .eq('id', pendingResetUser.id);
        updateError = error;
      } catch (err) {
        updateError = err;
      }

      // Fallback si la columna requires_pin_reset aún no existe en la base de datos
      if (updateError && (updateError.code === 'PGRST204' || updateError.message?.includes('requires_pin_reset'))) {
        const { error: fallbackErr } = await supabase
          .from('usuarios_app')
          .update({
            pin: newPin.trim()
          })
          .eq('id', pendingResetUser.id);
        if (fallbackErr) throw fallbackErr;
      } else if (updateError) {
        throw updateError;
      }

      // Completar login con la sesión actualizada
      const loginRes = await completeLoginAfterPinReset({
        ...pendingResetUser,
        pin: newPin.trim(),
        requires_pin_reset: false
      });

      if (!loginRes.success) {
        throw new Error(loginRes.error || 'No se pudo iniciar sesión con el nuevo PIN.');
      }

      setShowPinResetModal(false);
      setNewPin('');
      setConfirmPin('');
    } catch (err) {
      console.error('Error al guardar nuevo PIN:', err);
      setPinResetError(`Error: ${err.message}`);
    } finally {
      setSavingPin(false);
    }
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

          {/* Botón de Auxilio: Forzar Cierre en Otro Dispositivo */}
          {sessionConflictUser && (
            <div className="bg-amber-950/40 border border-amber-500/50 p-4 rounded-2xl space-y-3">
              <div className="flex items-start space-x-3 text-amber-300 text-xs">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Sesión activa detectada</p>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    Existe una sesión abierta para <span className="font-bold text-white">{sessionConflictUser.nombre || sessionConflictUser.Nombre || 'este usuario'}</span> en otro dispositivo.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleForceOverride}
                disabled={forcingOverride}
                className="w-full py-3 px-4 bg-gradient-to-r from-amber-600 to-red-600 hover:from-amber-500 hover:to-red-500 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                {forcingOverride ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Invalidando sesión remota...</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4" />
                    <span>Forzar Cierre en Otro Dispositivo</span>
                  </>
                )}
              </button>
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
                      setSessionConflictUser(null);
                    }}
                    className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-4 pl-12 font-bold focus:border-red-500 focus:outline-none appearance-none cursor-pointer"
                    disabled={verifying || forcingOverride}
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
              <div className={verifying || forcingOverride ? 'pointer-events-none opacity-50' : ''}>
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

      {/* Modal Obligatorio: Establecer Nuevo PIN */}
      {showPinResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/40 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-5">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto text-amber-400">
                <KeyRound className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-black tracking-wider text-white uppercase">Establecer Nuevo PIN</h3>
              <p className="text-[11px] text-slate-400 font-medium">
                Operario: <span className="text-white font-bold">{pendingResetUser?.nombre || pendingResetUser?.Nombre || ''}</span>
              </p>
              <p className="text-[10px] text-amber-300/90 font-medium bg-amber-950/50 border border-amber-500/30 p-2.5 rounded-xl">
                Por política de seguridad, debe actualizar su PIN de 4 dígitos para ingresar al sistema.
              </p>
            </div>

            {pinResetError && (
              <div className="bg-red-950/60 border border-red-500/50 text-red-200 text-xs p-3 rounded-xl text-center font-bold tracking-wide">
                {pinResetError}
              </div>
            )}

            <form onSubmit={handleSaveNewPin} className="space-y-4">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                  Nuevo PIN (4 dígitos)
                </label>
                <input
                  type="password"
                  maxLength={4}
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(e.target.value.replace(/\D/g, ''));
                    setPinResetError('');
                  }}
                  placeholder="••••"
                  className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 font-mono font-bold tracking-widest text-center focus:border-amber-400 focus:outline-none text-lg"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                  Confirmar Nuevo PIN
                </label>
                <input
                  type="password"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value.replace(/\D/g, ''));
                    setPinResetError('');
                  }}
                  placeholder="••••"
                  className="w-full bg-slate-950 text-white rounded-xl border border-slate-700 p-3 font-mono font-bold tracking-widest text-center focus:border-amber-400 focus:outline-none text-lg"
                />
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={savingPin || newPin.length !== 4 || confirmPin.length !== 4}
                  className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-lg transition flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingPin ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Actualizando credenciales...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Guardar y Entrar</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPinResetModal(false);
                    setPendingResetUser(null);
                    setNewPin('');
                    setConfirmPin('');
                    setPinResetError('');
                  }}
                  disabled={savingPin}
                  className="w-full py-2.5 text-slate-400 hover:text-slate-200 text-xs font-bold transition"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

