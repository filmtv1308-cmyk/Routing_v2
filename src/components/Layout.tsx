import { useAppContext } from '@/store/AppContext';

const navItems = [
  { page: 'map' as const, tip: 'Карта', icon: '🗺️' },
  { page: 'stats' as const, tip: 'Статистика', icon: '📊' },
];

const adminItems = [
  { page: 'admin' as const, tip: 'Админ. панель', icon: '⚙️' },
  { page: 'backup' as const, tip: 'Бэкап', icon: '💾' },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { page, setPage, logout, toggleTheme, theme, currentUser, isAdmin } = useAppContext();
  const user = currentUser();

  const pageTitles: Record<string, string> = {
    map: 'Карта',
    stats: 'Статистика',
    admin: 'Админ. панель',
    backup: 'Бэкап'
  };

  const items = isAdmin() ? [...navItems, ...adminItems] : navItems;

  return (
    <div className="h-screen w-screen flex bg-white dark:bg-[#0b1220] text-slate-900 dark:text-slate-100">
      {/* Primary nav */}
      <aside className="w-16 min-w-16 max-w-16 border-r border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-white/6 backdrop-blur flex flex-col z-50">
        <div className="h-14 flex items-center justify-center border-b border-slate-200 dark:border-white/10">
          <button
            onClick={toggleTheme}
            className="w-10 h-10 rounded-xl grid place-items-center hover:bg-slate-100 dark:hover:bg-white/10"
            title="Тема"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>

        <nav className="p-2 flex flex-col gap-2 flex-1">
          {items.map((item) => (
            <button
              key={item.page}
              onClick={() => setPage(item.page)}
              className={`w-full h-10 rounded-xl grid place-items-center hover:bg-slate-100 dark:hover:bg-white/10 border border-transparent transition-colors ${
                page === item.page ? 'bg-sky-50 dark:bg-white/10' : ''
              }`}
              title={item.tip}
            >
              <span className="text-lg">{item.icon}</span>
            </button>
          ))}
        </nav>

        <div className="p-2 border-t border-slate-200 dark:border-white/10">
          <button
            onClick={logout}
            className="w-full h-10 rounded-xl grid place-items-center hover:bg-slate-100 dark:hover:bg-white/10"
            title="Выйти"
          >
            ⎋
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <header className="h-14 shrink-0 border-b border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-white/6 backdrop-blur flex items-center justify-between px-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2.5 h-2.5 rounded-full bg-[#2196F3]" />
            <div className="min-w-0">
              <div className="font-semibold truncate">{pageTitles[page]}</div>
              <div className="text-xs text-slate-500 dark:text-slate-300/60 truncate">
                Управление маршрутами и точками
              </div>
            </div>
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-300/70">
            Пользователь: <span className="font-semibold">{user ? `${user.fullName} (${user.role})` : '—'}</span>
          </div>
        </header>

        {children}
      </main>
    </div>
  );
}
