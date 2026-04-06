import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import HomeScreen from '../src/v2/HomeScreen';
import AuthScreen from '../src/v2/AuthScreen';
import { useAuth } from '../src/context/AuthContext';

export default function Index() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212' }}>
                <ActivityIndicator size="large" color="#E60000" />
            </View>
        );
    }

    // Si hay usuario, vamos al Home. Si no, al Auth (Login)
    return user ? <HomeScreen /> : <AuthScreen />;
}
