import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginView from './views/LoginView';
import MainDashboard from './views/MainDashboard';

function AppContent() {
  const { user, loading, isAppActive } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center select-none">
        <div className="w-12 h-12 border-4 border-slate-700 border-t-sky-400 rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 text-xs font-mono tracking-widest uppercase">Cargando aplicación...</p>
      </div>
    );
  }

  // Si la aplicación se desactiva remotamente (Kill Switch)
  if (!isAppActive) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-6 text-center select-none">
        <div className="max-w-md w-full bg-slate-800 p-8 rounded-3xl border border-red-500/30 shadow-2xl space-y-4">
          <div className="w-16 h-16 bg-red-950 border border-red-500/40 rounded-full flex items-center justify-center mx-auto animate-pulse">
            <span className="text-2xl">🔒</span>
          </div>
          <h2 className="text-xl font-bold text-red-400 tracking-wider">ACCESO RESTRINGIDO</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            Esta aplicación ha sido desactivada remotamente o requiere una actualización crítica. 
            Contacte al administrador de sistemas.
          </p>
          <div className="text-[10px] text-slate-500 font-mono tracking-widest uppercase pt-2">
            ImportApp v4.8
          </div>
        </div>
      </div>
    );
  }

  return user ? <MainDashboard /> : <LoginView />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}