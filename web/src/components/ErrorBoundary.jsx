import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-slate-900 border border-red-500/50 rounded-3xl p-8 shadow-2xl text-center space-y-5 max-w-lg mx-auto my-8">
          <div className="w-14 h-14 bg-red-950/80 border border-red-500/40 rounded-2xl flex items-center justify-center mx-auto text-red-400 shadow-lg shadow-red-950/40">
            <AlertTriangle className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-black text-white tracking-wide uppercase">
              {this.props.fallbackTitle || 'Error en la visualización del módulo'}
            </h3>
            <p className="text-xs text-red-300 font-mono bg-slate-950/80 p-3 rounded-xl border border-slate-800 break-words">
              {this.state.error?.message || 'Ocurrió un error inesperado al renderizar.'}
            </p>
          </div>

          <div className="flex justify-center items-center space-x-3 pt-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition flex items-center space-x-2 border border-slate-700 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reintentar</span>
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-lg shadow-red-600/20"
            >
              Recargar Página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
