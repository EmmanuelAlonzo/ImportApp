import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

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
        const saved = localStorage.getItem('device_session_id');
        if (saved && saved !== 'undefined' && saved !== 'null' && saved.trim() !== '') {
            id = saved.trim();
        } else {
            id = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
            localStorage.setItem('device_session_id', id);
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
        // Asegurar que exista un device_session_id persistente desde el inicio
        if (!localStorage.getItem('device_session_id')) {
            const newId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
            localStorage.setItem('device_session_id', newId);
        }
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
            const savedUser = localStorage.getItem('@user_session');
            if (savedUser) {
                setUser(JSON.parse(savedUser));
            }
        } catch (e) {
            console.error('Error loading session from localStorage:', e);
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

            if (data.activo === false || (data.rol && data.rol.toUpperCase() === 'SUSPENDIDO')) {
                throw new Error('ACCESO RESTRINGIDO. Este perfil está suspendido activamente.');
            }

            // Asegurar persistencia de device_session_id al iniciar sesión
            if (!localStorage.getItem('device_session_id')) {
                const devId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
                localStorage.setItem('device_session_id', devId);
            }

            setUser(data);
            localStorage.setItem('@user_session', JSON.stringify(data));
            localStorage.setItem('usuario_activo', JSON.stringify(data));
            return { success: true, user: data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const logout = async () => {
        try {
            // Recopilar todos los identificadores potenciales del usuario/sesión
            // para garantizar la liberación sin importar si se reservó con ID, Nombre o Device UUID
            const candidates = [
                user?.id !== undefined && user?.id !== null ? String(user.id).trim() : null,
                user?.nombre ? String(user.nombre).trim() : null,
                localStorage.getItem('device_session_id') ? localStorage.getItem('device_session_id').trim() : null,
            ].filter((id) => id && id !== '' && id !== 'undefined' && id !== 'null');

            const uniqueIds = [...new Set(candidates)];

            if (uniqueIds.length > 0) {
                // Ejecutar en paralelo con timeout de seguridad de 2s
                await Promise.all(
                    uniqueIds.map((targetId) =>
                        withTimeout(
                            supabase.rpc('release_operator_coils', { p_operator_id: targetId }),
                            2000
                        ).catch((err) => {
                            console.warn(`Aviso: RPC release_operator_coils falló para ${targetId}:`, err?.message || err);
                        })
                    )
                );
            }
        } catch (e) {
            console.warn('Error liberando bobinas del operador al desloguearse:', e);
        } finally {
            // Limpieza estricta de sesión local garantizada
            try {
                localStorage.removeItem('@user_session');
                localStorage.removeItem('usuario_activo');
                localStorage.removeItem('auth_user');
                sessionStorage.clear();
            } catch (storageErr) {
                console.warn('Error limpiando almacenamiento local:', storageErr);
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
        <AuthContext.Provider value={{ user, isAuthenticated: !!user, operatorId, getOperatorId, loading, isAppActive, login, logout, checkPermission }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);

