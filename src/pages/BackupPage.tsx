import { useState, useCallback } from 'react';
import { useAppContext } from '@/store/AppContext';
import { downloadBlob } from '@/utils/helpers';
import { AppData } from '@/types';

export function BackupPage() {
  const { data, importData, resetToDemo, saveData } = useAppContext();
  const [message, setMessage] = useState('');

  const handleExport = useCallback(() => {
    saveData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob('RouteMaster_Backup.json', blob);
    setMessage('Бэкап экспортирован.');
  }, [data, saveData]);

  const handleImport = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const obj = JSON.parse(text) as AppData;
      if (!obj || typeof obj !== 'object') throw new Error('Invalid format');
      importData(obj);
      setMessage('Импорт бэкапа выполнен.');
    } catch (e) {
      console.error(e);
      setMessage('Ошибка импорта бэкапа JSON.');
    }
  }, [importData]);

  const handleReset = useCallback(() => {
    if (!confirm('Сбросить данные на демо?')) return;
    resetToDemo();
    setMessage('Данные сброшены на демо.');
  }, [resetToDemo]);

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
        <div className="text-lg font-semibold text-slate-900 dark:text-white">Бэкап</div>
        <div className="text-sm text-slate-600 dark:text-slate-300/70">
          Экспорт/импорт всех данных приложения
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={handleExport}
            className="rounded-xl px-3 py-2 text-sm text-white bg-[#2196F3]"
          >
            Экспорт JSON
          </button>

          <label className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-slate-700 dark:text-slate-300">
            Импорт JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={e => handleImport(e.target.files)}
            />
          </label>

          <button
            onClick={handleReset}
            className="rounded-xl px-3 py-2 text-sm border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
          >
            Сброс на демо
          </button>
        </div>

        {message && (
          <div className="mt-3 text-sm text-slate-700 dark:text-slate-300">{message}</div>
        )}

        <div className="mt-6 p-4 bg-slate-50 dark:bg-white/5 rounded-xl">
          <div className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Статистика данных:</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="text-center p-3 bg-white dark:bg-white/10 rounded-lg">
              <div className="text-2xl font-bold text-sky-600">{data.points.length}</div>
              <div className="text-xs text-slate-500">Точек</div>
            </div>
            <div className="text-center p-3 bg-white dark:bg-white/10 rounded-lg">
              <div className="text-2xl font-bold text-emerald-600">{data.polygons.length}</div>
              <div className="text-xs text-slate-500">Полигонов</div>
            </div>
            <div className="text-center p-3 bg-white dark:bg-white/10 rounded-lg">
              <div className="text-2xl font-bold text-violet-600">{data.startPoints.length}</div>
              <div className="text-xs text-slate-500">Точек старта</div>
            </div>
            <div className="text-center p-3 bg-white dark:bg-white/10 rounded-lg">
              <div className="text-2xl font-bold text-amber-600">{data.users.length}</div>
              <div className="text-xs text-slate-500">Пользователей</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
