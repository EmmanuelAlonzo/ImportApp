import React from 'react';
import { Stack } from 'expo-router';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import KillSwitchScreen from '../src/v2/KillSwitchScreen';

function RootNavigation() {
  const { isAppActive, loading } = useAuth();

  if (!isAppActive && !loading) {
    return <KillSwitchScreen />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigation />
    </AuthProvider>
  );
}
