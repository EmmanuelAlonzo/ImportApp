import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '../services/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAppActive, setIsAppActive] = useState(true);

    useEffect(() => {
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

            setUser(data);
            localStorage.setItem('@user_session', JSON.stringify(data));
            return { success: true, user: data };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const logout = () => {
        setUser(null);
        localStorage.removeItem('@user_session');
    };

    const checkPermission = (allowedRoles) => {
        if (!user || !user.rol) return false;
        return allowedRoles.includes(user.rol.toUpperCase());
    };

    return (
        <AuthContext.Provider value={{ user, loading, isAppActive, login, logout, checkPermission }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
