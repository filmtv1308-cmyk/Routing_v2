import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/store/AppContext';
import { DAY_CODE_TO_LABEL, FREQ_CODE_TO_LABEL } from '@/constants';
import { normalizeDayCode, normalizeFreqCode } from '@/utils/helpers';

interface BulkEditPointsModalProps {
  open: boolean;
  onClose: () => void;
}

const DAY_OPTIONS: { code: string; label: string }[] = [
  { code: '', label: '— Не изменять —' },
  { code: '1', label: 'ПН' },
  { code: '2', label: 'ВТ' },
  { code: '3', label: 'СР' },
  { code: '4', label: 'ЧТ' },
  { code: '5', label: 'ПТ' },
  { code: '6', label: 'СБ' },
  { code: '7', label: 'ВС' }
];

const FREQ_OPTIONS: { code: string; label: string }[] = [
  { code: '', label: '— Не изменять —' },
  { code: '4', label: 'Еженедельно (4)' },
  { code: '2,1', label: 'Каждая нечётная (2,1)' },
  { code: '2,2', label: 'Каждая чётная (2,2)' },
  { code: '1,1', label: 'Каждая первая (1,1)' },
  { code: '1,2', label: 'Каждая вторая (1,2)' },
  { code: '1,3', label: 'Каждая третья (1,3)' },
  { code: '1,4', label: 'Каждая четвёртая (1,4)' },
  { code: '0', label: 'Только выходные (0)' }
];

export function BulkEditPointsModal({ open, onClose }: BulkEditPointsModalProps) {
  const { data, selection, updatePoints, routesFromPoints, mapMode, clearSelection, setMileageOrderNumbers } = useAppContext();
  const isSection = mapMode === 'section';

  const selectedPoints = useMemo(
    () => data.points.filter(p => selection.selectedIds.has(p.id)),
    [data.points, selection.selectedIds]
  );

  const [newRoute, setNewRoute] = useState<string>('');
  const [newDay, setNewDay] = useState<string>('');
  const [newFreq, setNewFreq] = useState<string>('');
  const [error, setError] = useState<string>('');

  const routes = routesFromPoints();

  useEffect(() => {
    if (!open) return;
    setNewRoute('');
    setNewDay('');
    setNewFreq('');
    setError('');
  }, [open]);

  if (!open) return null;

  const apply = () => {
    setError('');

    if (isSection) {
      if (!newDay && !newFreq) {
        setError('Выберите хотя бы одно поле для изменения.');
        return;
      }
    } else {
      if (!newRoute && !newDay && !newFreq) {
        setError('Выберите хотя бы одно поле для изменения.');
        return;
      }
    }

    const freqCanon = newFreq ? normalizeFreqCode(newFreq) : '';
    const dayCanon = newDay ? normalizeDayCode(newDay) : '';

    if (freqCanon === '0') {
      if (dayCanon && dayCanon !== '6' && dayCanon !== '7') {
        setError('Частота = 0 допускается только при дне посещения 6 (СБ) или 7 (ВС).');
        return;
      }

      if (!dayCanon) {
        const bad = selectedPoints.filter(p => {
          const d = normalizeDayCode(p.visitDayCode);
          return d !== '6' && d !== '7';
        });
        if (bad.length > 0) {
          setError(`Частота = 0 требует СБ/ВС. Проблемных точек: ${bad.length} (например: ${bad.slice(0, 5).map(p => p.clientCode).join(', ')})`);
          return;
        }
      }
    }

    if (dayCanon && dayCanon !== '6' && dayCanon !== '7') {
      const bad = selectedPoints.filter(p => normalizeFreqCode(p.frequencyCode) === '0');
      if (bad.length > 0 && !freqCanon) {
        setError(`Нельзя поставить день ${DAY_CODE_TO_LABEL[dayCanon]} для точек с частотой 0. Сначала измените цикличность.`);
        return;
      }
    }

    const updated = data.points.map(p => {
      if (!selection.selectedIds.has(p.id)) return p;
      return {
        ...p,
        route: (!isSection && newRoute) ? newRoute : p.route,
        visitDayCode: dayCanon ? dayCanon : p.visitDayCode,
        frequencyCode: freqCanon ? freqCanon : p.frequencyCode
      };
    });

    updatePoints(updated);
    clearSelection();
    setMileageOrderNumbers(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-xl bg-white dark:bg-[#111827] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="font-semibold text-slate-900 dark:text-white">
            Изменить точки ({isSection ? 'Секции' : 'Территории'})
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="p-3 bg-sky-50 dark:bg-sky-900/20 rounded-xl text-sm text-slate-700 dark:text-slate-200">
            Выбрано точек: <b>{selectedPoints.length}</b>
          </div>

          {!isSection && (
            <label className="block text-sm">
              <div className="text-slate-600 dark:text-slate-300/70 mb-1">Маршрут</div>
              <select
                value={newRoute}
                onChange={(e) => setNewRoute(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white"
              >
                <option value="">— Не изменять —</option>
                {routes.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
          )}

          <label className="block text-sm">
            <div className="text-slate-600 dark:text-slate-300/70 mb-1">День посещения</div>
            <select
              value={newDay}
              onChange={(e) => setNewDay(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white"
            >
              {DAY_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <div className="text-slate-600 dark:text-slate-300/70 mb-1">Цикличность (частота)</div>
            <select
              value={newFreq}
              onChange={(e) => setNewFreq(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white"
            >
              {FREQ_OPTIONS.map(o => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Коды: {Object.keys(FREQ_CODE_TO_LABEL).sort().join(', ')}
            </div>
          </label>

          {error && (
            <div className="text-sm text-rose-600">{error}</div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
          >
            Отмена
          </button>
          <button
            onClick={apply}
            className="rounded-xl px-3 py-2 text-sm text-white bg-[#2196F3] hover:bg-[#1976D2]"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
