import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';

function AppContent() {
  const { user, isAppActive } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white font-sans p-6">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-xl text-center">
        <h1 className="text-3xl font-extrabold text-sky-400 mb-2">ImportApp</h1>
        <p className="text-xs text-slate-400 font-mono tracking-widest uppercase mb-6">PWA Core Configuration</p>
        
        <div className="bg-slate-950 rounded-xl p-4 mb-6 border border-slate-800 text-left text-sm font-mono space-y-2">
          <div><span className="text-emerald-500">✔</span> Base Web Environment: Vite</div>
          <div><span className="text-emerald-500">✔</span> Style Utilities: Tailwind CSS</div>
          <div><span className="text-emerald-500">✔</span> Supabase Service: Instantiated</div>
          <div><span className="text-emerald-500">✔</span> Auth Provider: Configured (Local)</div>
        </div>

        <p className="text-sm text-slate-400">
          Core modules initialized successfully. Ready to build user flows.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
