import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabase';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAppActive, setIsAppActive] = useState(true); // Valor por defecto activado

    useEffect(() => {
        loadSession();
        checkAppStatus();
    }, []);

    const checkAppStatus = async () => {
        try {
            // Intentar leer de app_settings si existe, sino por defecto true
            const { data } = await supabase.from('app_settings').select('is_active').eq('id', 1).single();
            if (data !== null) {
                setIsAppActive(data.is_active);
            }
        } catch (e) {
            setIsAppActive(true);
        }
    };

    const loadSession = async () => {
        try {
            const savedUser = await AsyncStorage.getItem('@user_session');
            if (savedUser) {
                setUser(JSON.parse(savedUser));
            }
        } catch (e) {
            console.log('Error loading session:', e);
        } finally {
            setLoading(false);
        }
    };

    const login = async (userData) => {
        setUser(userData);
        await AsyncStorage.setItem('@user_session', JSON.stringify(userData));
    };

    const logout = async () => {
        setUser(null);
        await AsyncStorage.removeItem('@user_session');
    };

    return (
        <AuthContext.Provider value={{ user, loading, isAppActive, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
