import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

export const getDeviceId = () => {
    let id = localStorage.getItem('@terminal_device_id');
    if (!id) {
        id = 'DEV-' + ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).substring(2, 9)));
        localStorage.setItem('@terminal_device_id', id);
    }
    return id;
};

export const getOperatorId = (currentUser) => {
    let id = null;
    if (currentUser) {
        if (currentUser.id !== undefined && currentUser.id !== null && String(currentUser.id).trim() !== '') {
            id = String(currentUser.id).trim();
        } else if (currentUser.nombre && String(currentUser.nombre).trim() !== '') {
            id = String(currentUser.nombre).trim();
        }
    }

    if (!id || id === 'undefined' || id === 'null') {
        const saved = sessionStorage.getItem('device_session_id') || localStorage.getItem('device_session_id');
        if (saved && saved !== 'undefined' && saved !== 'null' && saved.trim() !== '') {
            id = saved.trim();
        } else {
            id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
            sessionStorage.setItem('device_session_id', id);
        }
    }
    return id;
};

const withTimeout = (promise, ms = 2000) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms))
    ]);
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAppActive, setIsAppActive] = useState(true);

    useEffect(() => {
        // Asegurar que el ID de terminal esté inicializado en localStorage
        getDeviceId();
        loadSession();
        checkAppStatus();
    }, []);

    const checkAppStatus = async () => {
        try {
            const { data } = await supabase
                .from('app_settings')
                .select('is_active')
                .eq('id', 1)
                .single();
            if (data !== null) {
                setIsAppActive(data.is_active);
            }
        } catch (e) {
            console.error('Error checking application active status:', e);
            setIsAppActive(true); // Fallback to active
        }
    };

    const loadSession = () => {
        try {
            const savedUser = sessionStorage.getItem('@user_session') || sessionStorage.getItem('usuario_activo');
            if (savedUser) {
                setUser(JSON.parse(savedUser));
            } else {
                // Limpieza preventiva de sesiones residuales en localStorage
                localStorage.removeItem('@user_session');
                localStorage.removeItem('usuario_activo');
                setUser(null);
            }
        } catch (e) {
            console.error('Error loading session from sessionStorage:', e);
            setUser(null);
        } finally {
            setLoading(false);
        }
    };

    const login = async (selectedUserId, pinCode) => {
        try {
            const { data, error } = await supabase
                .from('usuarios_app')
                .select('*')
                .eq('id', selectedUserId)
                .eq('pin', pinCode.trim())
                .single();

            if (error || !data) {
                throw new Error('PIN INCORRECTO. Acceso denegado.');
            }

            if (data.activo === false || data.is_active === false || (data.rol && data.rol.toUpperCase() === 'SUSPENDIDO')) {
                throw new Error('Usuario suspendido. Consulte con el Administrador');
            }

            // 1. Control de Huella Persistente de Dispositivo Web (current_device_id):
            // Si user.current_device_id no es null y es distinto al getDeviceId() local, bloquea el inicio
            const localDeviceId = getDeviceId();
            if (data.current_device_id && data.current_device_id.trim() !== '' && data.current_device_id !== localDeviceId) {
                return {
                    success: false,
                    sessionConflict: true,
                    user: data,
                    error: 'Este usuario ya tiene una sesión iniciada en otro dispositivo'
                };
            }

            // Control secundario por session_token
            const localToken = sessionStorage.getItem('session_token');
            if (data.session_token && data.session_token.trim() !== '' && data.session_token !== localToken) {
                return {
                    success: false,
                    sessionConflict: true,
                    user: data,
                    error: 'Este usuario ya tiene una sesión abierta en otro dispositivo.'
                };
            }

            // 2. Control de Reseteo de PIN obligatorio (o PIN temporal '0000')
            if (data.requires_pin_reset === true || data.pin === '0000') {
                return {
                    success: false,
                    requiresPinReset: true,
                    user: data
                };
            }

            // 3. Generar nuevo session_token y registrar current_device_id
            const newToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

            try {
                await supabase
                    .from('usuarios_app')
                    .update({
                        session_token: newToken,
                        current_device_id: localDeviceId
                    })
                    .eq('id', data.id);
            } catch (tokenErr) {
                console.warn('Advertencia al registrar session_token / current_device_id en Supabase:', tokenErr);
                try {
                    await supabase.from('usuarios_app').update({ session_token: newToken }).eq('id', data.id);
                } catch (e) {}
            }

            data.session_token = newToken;
            data.current_device_id = localDeviceId;
            sessionStorage.setItem('session_token', newToken);
            sessionStorage.setItem('@user_session', JSON.stringify(data));
            sessionStorage.setItem('usuario_activo', JSON.stringify(data));
            setUser(data);
            return { success: true, user: data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const forceSessionOverride = async (userId) => {
        try {
            const localDeviceId = getDeviceId();
            const newToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

            // 1. Invocar RPC force_session_override
            let rpcSuccess = false;
            try {
                const { error: rpcError } = await supabase.rpc('force_session_override', {
                    p_user_id: String(userId),
                    p_new_session_token: newToken
                });
                if (!rpcError) {
                    rpcSuccess = true;
                }
            } catch (rpcEx) {}

            // Actualizar current_device_id y session_token al ID local y liberar reservas previas
            try {
                await supabase
                    .from('usuarios_app')
                    .update({
                        session_token: newToken,
                        current_device_id: localDeviceId
                    })
                    .eq('id', userId);
            } catch (updateErr) {
                console.warn('Fallback update session_token/current_device_id:', updateErr);
                try {
                    await supabase.from('usuarios_app').update({ session_token: newToken }).eq('id', userId);
                } catch (e) {}
            }

            try {
                await supabase.rpc('release_operator_coils', { p_operator_id: String(userId) });
            } catch (releaseErr) {
                console.warn('Fallback release_operator_coils falló:', releaseErr);
            }

            // 2. Obtener datos actualizados del usuario
            const { data: updatedUser, error: userError } = await supabase
                .from('usuarios_app')
                .select('*')
                .eq('id', userId)
                .single();

            if (userError || !updatedUser) {
                throw new Error('No se pudo recuperar los datos del usuario tras forzar la sesión.');
            }

            sessionStorage.setItem('session_token', newToken);
            updatedUser.session_token = newToken;
            updatedUser.current_device_id = localDeviceId;

            // 3. Verificar si requiere cambio de PIN
            if (updatedUser.requires_pin_reset === true || updatedUser.pin === '0000') {
                return {
                    success: false,
                    requiresPinReset: true,
                    user: updatedUser
                };
            }

            sessionStorage.setItem('@user_session', JSON.stringify(updatedUser));
            sessionStorage.setItem('usuario_activo', JSON.stringify(updatedUser));
            setUser(updatedUser);
            return { success: true, user: updatedUser };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const completeLoginAfterPinReset = async (userData) => {
        try {
            const localDeviceId = getDeviceId();
            let token = sessionStorage.getItem('session_token');
            if (!token) {
                token = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
                sessionStorage.setItem('session_token', token);
            }

            try {
                await supabase
                    .from('usuarios_app')
                    .update({
                        session_token: token,
                        current_device_id: localDeviceId,
                        requires_pin_reset: false
                    })
                    .eq('id', userData.id);
            } catch (e) {
                console.warn('Error actualizando session_token tras cambio de PIN:', e);
            }

            userData.session_token = token;
            userData.current_device_id = localDeviceId;
            userData.requires_pin_reset = false;
            sessionStorage.setItem('@user_session', JSON.stringify(userData));
            sessionStorage.setItem('usuario_activo', JSON.stringify(userData));
            setUser(userData);
            return { success: true, user: userData };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const logout = async () => {
        const currentUserId = user?.id;

        // 1. En Supabase: poner current_device_id = NULL y session_token = NULL y ejecutar release_operator_coils
        if (currentUserId) {
            try {
                await supabase
                    .from('usuarios_app')
                    .update({
                        session_token: null,
                        current_device_id: null
                    })
                    .eq('id', currentUserId);
            } catch (tokenErr) {
                console.warn("Error al anular session_token / current_device_id en logout:", tokenErr);
                try {
                    await supabase.from('usuarios_app').update({ session_token: null }).eq('id', currentUserId);
                } catch (e) {}
            }

            try {
                await supabase.rpc('release_operator_coils', { p_operator_id: String(currentUserId) });
            } catch (e) {
                console.warn("Error al liberar bobinas en logout:", e);
            }
        }

        try {
            // Recopilar otros identificadores secundarios si existen
            const candidates = [
                user?.nombre ? String(user.nombre).trim() : null,
                sessionStorage.getItem('device_session_id') ? sessionStorage.getItem('device_session_id').trim() : null,
                localStorage.getItem('device_session_id') ? localStorage.getItem('device_session_id').trim() : null,
            ].filter((id) => id && id !== '' && id !== 'undefined' && id !== 'null' && id !== String(currentUserId));

            const uniqueIds = [...new Set(candidates)];

            if (uniqueIds.length > 0) {
                await Promise.all(
                    uniqueIds.map((targetId) =>
                        withTimeout(
                            supabase.rpc('release_operator_coils', { p_operator_id: targetId }),
                            1500
                        ).catch((err) => {
                            console.warn(`Aviso: RPC release_operator_coils falló para ${targetId}:`, err?.message || err);
                        })
                    )
                );
            }
        } catch (e) {
            console.warn('Error liberando bobinas del operador al desloguearse:', e);
        } finally {
            // Limpieza estricta de sesión en sessionStorage
            try {
                sessionStorage.removeItem('@user_session');
                sessionStorage.removeItem('usuario_activo');
                sessionStorage.removeItem('session_token');
                sessionStorage.clear();
                localStorage.removeItem('@user_session');
                localStorage.removeItem('usuario_activo');
                localStorage.removeItem('auth_user');
            } catch (storageErr) {
                console.warn('Error limpiando almacenamiento de sesión:', storageErr);
            }
            setUser(null);
        }
    };

    const checkPermission = (allowedRoles) => {
        if (!user || !user.rol) return false;
        return allowedRoles.includes(user.rol.toUpperCase());
    };

    const operatorId = getOperatorId(user);

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            operatorId,
            getOperatorId,
            getDeviceId,
            loading,
            isAppActive,
            login,
            logout,
            forceSessionOverride,
            completeLoginAfterPinReset,
            checkPermission
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);



