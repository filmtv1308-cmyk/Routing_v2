import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/store/AppContext';

import { Point, RoadMileageOrderMode, TerritoryCalcRun } from '@/types';
import { uid } from '@/utils/helpers';
import { buildTerritoryRun } from '@/utils/territoryRun';

export function TerritoryMileageModal(props: { open: boolean; onClose: () => void; visiblePoints: Point[] }) {
  const { open, onClose, visiblePoints } = props;

  const {
    data,
    filters,
    mapMode,
    updatePoints,
    colorForRoute,
    addTerritoryCalcRun,
  } = useAppContext();

  const [orderMode, setOrderMode] = useState<RoadMileageOrderMode>('useExistingAndFill');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');

  const [draft, setDraft] = useState<{
    run: TerritoryCalcRun;
    plannedOrdersByRoute: Record<string, Array<{ weekKey: string; dayCode: string; orderedPointIds: string[] }>>;
  } | null>(null);

  // Determine which routes are active based on current filters (visiblePoints already respects filters)
  const activeRoutes = useMemo(() => {
    const set = new Set(visiblePoints.map(p => p.route).filter(Boolean));
    return Array.from(set).sort();
  }, [visiblePoints]);

  // Resolve day list based on active filters (exclude weekends always)
  const dayCodes = useMemo(() => {
    const selected = Array.from(filters.days).map(String);
    const weekdays = selected.filter((d) => ['1', '2', '3', '4', '5'].includes(d));
    return weekdays.length > 0 ? weekdays : ['1', '2', '3', '4', '5'];
  }, [filters.days]);

  // Weeks: if cycleWeeks filter has numeric offsets => use them; else default to [0,1,2,3]
  const weekOffsets = useMemo(() => {
    const offs = Array.from(filters.cycleWeeks).filter(x => typeof x === 'number') as number[];
    if (offs.length > 0) return offs;
    return [0, 1, 2, 3];
  }, [filters.cycleWeeks]);

  const startByRoute = useMemo(() => {
    const m = new Map<string, { lat: number; lon: number; address: string }>();
    for (const sp of data.startPoints) {
      if (!sp.route) continue;
      m.set(sp.route, { lat: sp.lat, lon: sp.lon, address: sp.address });
    }
    return m;
  }, [data.startPoints]);

  const missingStarts = useMemo(() => {
    return activeRoutes.filter(r => !startByRoute.has(r));
  }, [activeRoutes, startByRoute]);

  useEffect(() => {
    if (!open) return;
    setOrderMode('useExistingAndFill');
    setIsRunning(false);
    setError('');
    setDraft(null);
  }, [open]);

  if (!open) return null;
  if (mapMode !== 'territory') return null;

  const compute = async () => {
    setError('');

    if (activeRoutes.length === 0) {
      setError('Нет точек на карте для расчёта (проверьте фильтры).');
      return;
    }

    const routesToCalc = activeRoutes.filter(r => startByRoute.has(r));

    if (missingStarts.length > 0 && routesToCalc.length === 0) {
      setError('Все активные маршруты без точки старта. Добавьте старты в Админ → Точки старта или измените фильтры.');
      return;
    }

    setIsRunning(true);
    try {
      const filtersSnapshot: TerritoryCalcRun['filtersSnapshot'] = {
        routes: Array.from(filters.routes),
        branches: Array.from(filters.branches),
        days: Array.from(filters.days),
        cycleWeeks: Array.from(filters.cycleWeeks),
      };

      const { run, plannedOrdersByRoute } = buildTerritoryRun({
        visiblePoints,
        startByRoute,
        activeRoutes,
        dayCodes,
        weekOffsets,
        orderMode,
        filtersSnapshot,
      });

      setDraft({ run, plannedOrdersByRoute });
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Ошибка расчёта');
    } finally {
      setIsRunning(false);
    }
  };

  const saveWithoutOrder = () => {
    if (!draft) return;
    const run: TerritoryCalcRun = { ...draft.run, id: uid(), createdAt: new Date().toISOString(), orderSaved: false };
    addTerritoryCalcRun(run);
    onClose();
  };

  const saveWithOrder = () => {
    if (!draft) return;

    // Apply planned orders to points visitOrderByWeek
    const updatesById = new Map<string, Record<string, number>>();
    for (const orders of Object.values(draft.plannedOrdersByRoute)) {
      for (const o of orders) {
        for (let i = 0; i < o.orderedPointIds.length; i++) {
          const pid = o.orderedPointIds[i];
          const cur = updatesById.get(pid) || {};
          cur[o.weekKey] = i + 1;
          updatesById.set(pid, cur);
        }
      }
    }

    const nextPoints = data.points.map((p) => {
      const upd = updatesById.get(p.id);
      if (!upd) return p;
      return {
        ...p,
        visitOrderByWeek: {
          ...(p.visitOrderByWeek || {}),
          ...upd,
        },
      };
    });

    updatePoints(nextPoints);

    const run: TerritoryCalcRun = { ...draft.run, id: uid(), createdAt: new Date().toISOString(), orderSaved: true };
    addTerritoryCalcRun(run);

    onClose();
  };

  const routesWithCombos = draft?.run.routes || [];

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-3xl bg-white dark:bg-[#111827] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="font-semibold text-slate-900 dark:text-white">🚗 Пробег (оценка по прямой) — Территории</div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Расчёт выполняется по текущим фильтрам: маршруты/филиалы/поиск/дни/цикличность.
            Суббота и воскресенье не участвуют. Расстояние: haversine × 1.3. Время в пути: 40 км/ч.
            Время визита: из данных точки (если пусто — 15 мин).
          </div>

          {missingStarts.length > 0 && (
            <div className="border border-amber-200 dark:border-amber-700/30 rounded-xl p-3 bg-amber-50/50 dark:bg-amber-900/10">
              <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2">Маршруты без точки старта</div>
              <div className="space-y-1">
                {missingStarts.map((r) => (
                  <div key={r} className="text-sm text-amber-900 dark:text-amber-200">• {r}</div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-amber-800/80 dark:text-amber-200/80">
                Эти маршруты автоматически исключены из расчёта. Добавьте старт в Админ → «Точки старта», чтобы включить их.
              </div>
            </div>
          )}

          <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
            <div className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Порядок</div>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="radio"
                name="t_orderMode"
                checked={orderMode === 'useExistingAndFill'}
                onChange={() => setOrderMode('useExistingAndFill')}
                className="mt-1"
              />
              <span>
                <b>Использовать текущий порядок + дозаполнение</b><br />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Если порядок задан частично — сначала идём по нему, затем добавляем остальные точки по ближайшему соседу.
                </span>
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="radio"
                name="t_orderMode"
                checked={orderMode === 'rebuildNearest'}
                onChange={() => setOrderMode('rebuildNearest')}
                className="mt-1"
              />
              <span>
                <b>Пересчитать порядок заново</b><br />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Игнорируем текущий порядок и строим новый от старта по ближайшему соседу.
                </span>
              </span>
            </label>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200 text-sm">{error}</div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={compute}
              disabled={isRunning || activeRoutes.length === 0 || (activeRoutes.length === missingStarts.length)}
              className="rounded-xl px-3 py-2 text-sm text-white bg-[#2196F3] hover:bg-[#1976D2] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Расчёт…' : 'Рассчитать'}
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Маршрутов: <b>{activeRoutes.length}</b> • недель: <b>{weekOffsets.length}</b> • дней: <b>{dayCodes.length}</b>
            </div>
          </div>

          {draft && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-white/70 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Расчёт готов</div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Сохранённый расчёт появится в Статистике как единый запуск по территории. Доступны экспорты.
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
                Сохранить рассчитанный порядок в W1–W4 для участвующих точек?
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={saveWithoutOrder}
                  className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
                >
                  Отклонить (не сохранять порядок)
                </button>
                <button
                  onClick={saveWithOrder}
                  className="rounded-xl px-3 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-700"
                >
                  Сохранить порядок
                </button>
              </div>

              <details className="border border-slate-200 dark:border-white/10 rounded-xl p-3 bg-white/70 dark:bg-white/5">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-white">Сводка (по маршрутам)</summary>
                <div className="mt-2 space-y-2">
                  {routesWithCombos.map((rr) => (
                    <div key={rr.route} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colorForRoute(rr.route) }} />
                        <span className="text-slate-700 dark:text-slate-200 font-semibold">{rr.route}</span>
                      </div>
                      <span className="text-slate-500 dark:text-slate-400">Комбинаций (W×дни): {rr.combos.length}</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-end">
          <button
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
