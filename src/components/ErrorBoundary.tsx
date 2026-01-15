import React from 'react';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl p-6">
            <div className="text-xl font-semibold">Произошла ошибка</div>
            <div className="mt-2 text-sm text-slate-600">
              Приложение упало при выполнении операции. Перезагрузите страницу. Если ошибка повторяется —
              сообщите шаги и текст ошибки ниже.
            </div>
            <pre className="mt-4 text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 overflow-auto">
              {this.state.error?.message}
            </pre>
            <div className="mt-4 flex gap-2">
              <button
                className="rounded-xl px-3 py-2 text-sm text-white bg-[#2196F3]"
                onClick={() => window.location.reload()}
              >
                Перезагрузить
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
