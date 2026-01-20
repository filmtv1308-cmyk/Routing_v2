import { useState } from 'react';
import { useAppContext } from '@/store/AppContext';

export function LoginScreen() {
  const { login } = useAppContext();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Введите email и пароль.');
      return;
    }

    setLoading(true);

    try {
      await login(email.trim(), password.trim(), true);
      // ЕСЛИ ВХОД УСПЕШЕН → onAuthStateChanged откроет приложение сам
    } catch (e: any) {
  console.error('FIREBASE LOGIN ERROR:', e);
  setError(e?.code || 'Ошибка входа');
}
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-[#0b1220]">
      <div className="w-full max-w-md bg-white/90 dark:bg-white/7 border border-slate-200/80 dark:border-white/12 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#2196F3]" />
          <div>
            <div className="text-xl font-semibold text-slate-900 dark:text-white">Route Master</div>
            <div className="text-sm text-slate-500 dark:text-slate-300/70">Вход в систему</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-slate-300/80">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 outline-none focus:ring-2 focus:ring-sky-400 text-slate-900 dark:text-white"
              placeholder="user@example.com"
              type="email"
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-600 dark:text-slate-300/80">Пароль</span>
            <div className="relative mt-1">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-sky-400 text-slate-900 dark:text-white"
                placeholder="Пароль"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg grid place-items-center hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400"
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-2.5 text-white font-medium shadow bg-[#2196F3] hover:bg-[#1976D2] transition-colors disabled:opacity-60"
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>

          {error && <div className="text-sm text-rose-600">{error}</div>}

          <div className="text-xs text-slate-500 dark:text-slate-300/60">
            Вход только для пользователей, зарегистрированных в системе
          </div>
        </form>
      </div>
    </div>
  );
}