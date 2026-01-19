import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@/store/AppContext';
import { DAY_CODE_TO_LABEL } from '@/constants';
import { Point, RoadMileageOrderMode, RoadMileageReport } from '@/types';
import { getISOWeekNumber, haversineDistance, pointMatchesCycleWeek, uid } from '@/utils/helpers';
import { osrmRoute } from '@/utils/osrm';

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function toIntMinutes(n: number) {
  return Math.round(n);
}

function getTargetIsoWeekFromOffset(offset: number): number {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  return getISOWeekNumber(d);
}

function getWeekKeyFromIsoWeek(isoWeek: number): string {
  const w = ((isoWeek - 1) % 4) + 1;
  return String(w);
}

function normalizeVisitMinutes(raw: Point['visitMinutes']): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 15;
  return Math.round(n);
}

type CalcScope = 'single' | 'full';

type Task = {
  route: string;
  dayCode: string; // 1..5
  dayLabel: string;
  weekOffset: number;
  isoWeek: number;
  weekKey: string; // 1..4
  points: Point[];
};

function buildOrder(params: {
  orderMode: RoadMileageOrderMode;
  weekKey: string;
  start: { lat: number; lon: number };
  points: Point[];
}): Point[] {
  const { orderMode, weekKey, start, points } = params;

  if (orderMode === 'useExistingAndFill') {
    const ordered = points
      .filter((p) => typeof p.visitOrderByWeek?.[weekKey] === 'number' && Number.isFinite(p.visitOrderByWeek?.[weekKey]))
      .slice()
      .sort((a, b) => {
        const oa = a.visitOrderByWeek?.[weekKey] ?? Number.POSITIVE_INFINITY;
        const ob = b.visitOrderByWeek?.[weekKey] ?? Number.POSITIVE_INFINITY;
        if (oa === ob) return a.id.localeCompare(b.id);
        return oa < ob ? -1 : 1;
      });

    const orderedIds = new Set(ordered.map((p) => p.id));
    const rest = points.filter((p) => !orderedIds.has(p.id)).slice();

    const result: Point[] = [...ordered];
    let curLat = result.length ? result[result.length - 1].lat : start.lat;
    let curLon = result.length ? result[result.length - 1].lon : start.lon;

    while (rest.length > 0) {
      let bestIdx = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < rest.length; i++) {
        const p = rest[i];
        const d = haversineDistance(curLat, curLon, p.lat, p.lon);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      const next = rest.splice(bestIdx, 1)[0];
      result.push(next);
      curLat = next.lat;
      curLon = next.lon;
    }

    return result;
  }

  // rebuildNearest
  {
    const rest = points.slice();
    const result: Point[] = [];
    let curLat = start.lat;
    let curLon = start.lon;

    while (rest.length > 0) {
      let bestIdx = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let i = 0; i < rest.length; i++) {
        const p = rest[i];
        const d = haversineDistance(curLat, curLon, p.lat, p.lon);
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      const next = rest.splice(bestIdx, 1)[0];
      result.push(next);
      curLat = next.lat;
      curLon = next.lon;
    }

    return result;
  }
}

export function RoadMileageModal(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;

  const {
    data,
    mapMode,
    sectionRoute,
    filters,
    colorForRoute,
    updatePoints,
    addRoadMileageReport,
    setMileageOrderNumbers,
    setRoadTrack,
  } = useAppContext();

  const abortRef = useRef<AbortController | null>(null);

  const [scope, setScope] = useState<CalcScope>('full');
  const [orderMode, setOrderMode] = useState<RoadMileageOrderMode>('useExistingAndFill');
  const [showTrack, setShowTrack] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string>('');

  const [progress, setProgress] = useState<{ done: number; total: number; label?: string } | null>(null);

  const [draftReports, setDraftReports] = useState<RoadMileageReport[] | null>(null);
  const [draftOrders, setDraftOrders] = useState<Record<string, Record<string, number>> | null>(null);

  // base prerequisites
  const baseOk = useMemo(() => {
    if (mapMode !== 'section') return false;
    if (!sectionRoute) return false;
    return true;
  }, [mapMode, sectionRoute]);

  const selectedDayCodes = useMemo(() => {
    const sel = Array.from(filters.days).map(String);
    const weekdays = sel.filter((d) => ['1', '2', '3', '4', '5'].includes(d));
    if (weekdays.length > 0) return weekdays;
    return ['1', '2', '3', '4', '5'];
  }, [filters.days]);

  const selectedWeekOffsets = useMemo(() => {
    const offs = Array.from(filters.cycleWeeks)
      .filter((x) => typeof x === 'number')
      .map((x) => x as number);
    if (offs.length > 0) return offs;
    return [0, 1, 2, 3];
  }, [filters.cycleWeeks]);

  const singleContext = useMemo(() => {
    if (!baseOk || !sectionRoute) return null;

    if (filters.days.size !== 1) return null;
    if (filters.cycleWeeks.size !== 1) return null;
    if (filters.cycleWeeks.has('Z0')) return null;

    const dayCode = String(Array.from(filters.days)[0]);
    if (dayCode === '6' || dayCode === '7') return null;

    const only = Array.from(filters.cycleWeeks)[0];
    if (typeof only !== 'number') return null;

    const isoWeek = getTargetIsoWeekFromOffset(only);
    return {
      route: sectionRoute,
      dayCode,
      dayLabel: DAY_CODE_TO_LABEL[dayCode] || dayCode,
      weekOffset: only,
      isoWeek,
      weekKey: getWeekKeyFromIsoWeek(isoWeek),
    };
  }, [baseOk, filters.cycleWeeks, filters.days, sectionRoute]);

  const tasks = useMemo((): Task[] => {
    if (!baseOk || !sectionRoute) return [];

    const route = sectionRoute;

    const dayList = scope === 'single'
      ? (singleContext ? [singleContext.dayCode] : [])
      : selectedDayCodes;

    const weekList = scope === 'single'
      ? (singleContext ? [singleContext.weekOffset] : [])
      : selectedWeekOffsets;

    if (dayList.length === 0 || weekList.length === 0) return [];

    const res: Task[] = [];

    const routePoints = data.points.filter((p) => p.route === route);

    for (const weekOffset of weekList) {
      const isoWeek = getTargetIsoWeekFromOffset(weekOffset);
      const weekKey = getWeekKeyFromIsoWeek(isoWeek);

      for (const dayCode of dayList) {
        if (dayCode === '6' || dayCode === '7') continue;
        const pts = routePoints
          .filter((p) => p.visitDayCode === dayCode)
          .filter((p) => pointMatchesCycleWeek(p.frequencyCode, isoWeek));

        if (pts.length === 0) continue;

        res.push({
          route,
          dayCode,
          dayLabel: DAY_CODE_TO_LABEL[dayCode] || dayCode,
          weekOffset,
          isoWeek,
          weekKey,
          points: pts,
        });
      }
    }

    // stable sort: weekOffset asc then day asc
    res.sort((a, b) => (a.weekOffset - b.weekOffset) || (Number(a.dayCode) - Number(b.dayCode)));
    return res;
  }, [baseOk, data.points, scope, sectionRoute, selectedDayCodes, selectedWeekOffsets, singleContext]);

  const trackAllowed = useMemo(() => {
    // Track only makes sense for exactly one calculated combination (day + week)
    return tasks.length === 1;
  }, [tasks.length]);

  const canRun = useMemo(() => {
    if (!baseOk || !sectionRoute) return false;
    if (filters.cycleWeeks.has('Z0')) return false;

    if (scope === 'single') {
      return !!singleContext;
    }

    // full
    // Must have at least one weekday, and at least one week offset (default 0..3)
    if (selectedDayCodes.length === 0) return false;
    if (selectedWeekOffsets.length === 0) return false;
    return true;
  }, [baseOk, filters.cycleWeeks, scope, sectionRoute, selectedDayCodes.length, selectedWeekOffsets.length, singleContext]);

  const startPoint = useMemo(() => {
    if (!sectionRoute) return null;
    return data.startPoints.find((sp) => sp.route === sectionRoute) || null;
  }, [data.startPoints, sectionRoute]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setIsRunning(false);
    setProgress(null);
    setDraftReports(null);
    setDraftOrders(null);
    setOrderMode('useExistingAndFill');
    setScope('full');
    setShowTrack(true);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [open]);

  useEffect(() => {
    // if track is not allowed, force it off (full calc)
    if (!trackAllowed) {
      setShowTrack(false);
    }
  }, [trackAllowed]);

  const cancel = () => {
    abortRef.current?.abort();
  };

  const run = async () => {
    setError('');
    setDraftReports(null);
    setDraftOrders(null);

    if (!canRun) {
      setError(
        scope === 'single'
          ? 'Для одиночного расчёта выберите 1 день (ПН–ПТ) и 1 неделю цикличности.'
          : 'Проверьте режим “Секции” и выбранный маршрут.'
      );
      return;
    }

    if (!sectionRoute) {
      setError('Не выбран маршрут (ТП).');
      return;
    }

    if (!startPoint) {
      setError(`Не найдена точка старта для маршрута “${sectionRoute}”. Добавьте её в Админ → Точки старта.`);
      return;
    }

    if (tasks.length === 0) {
      setError('Нет точек для расчёта при текущих условиях (дни/недели/частоты).');
      return;
    }

    setIsRunning(true);
    setProgress({ done: 0, total: tasks.length });

    // For multi-task run: clear map track and mileage numbers
    if (tasks.length !== 1) {
      setRoadTrack(null);
      setMileageOrderNumbers(null);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const reports: RoadMileageReport[] = [];
    const ordersByPointId: Record<string, Record<string, number>> = {};

    try {
      for (let idx = 0; idx < tasks.length; idx++) {
        const t = tasks[idx];
        const label = `${t.dayLabel} • ISO ${t.isoWeek} • W${t.weekKey} • ${t.points.length} точ.`;
        setProgress({ done: idx, total: tasks.length, label });

        const ordered = buildOrder({
          orderMode,
          weekKey: t.weekKey,
          start: { lat: startPoint.lat, lon: startPoint.lon },
          points: t.points
        });

        // record order plan for optional save
        for (let i = 0; i < ordered.length; i++) {
          const pid = ordered[i].id;
          if (!ordersByPointId[pid]) ordersByPointId[pid] = {};
          ordersByPointId[pid][t.weekKey] = i + 1;
        }

        const reportId = uid();

        const coords = [
          { lat: startPoint.lat, lon: startPoint.lon },
          ...ordered.map((p) => ({ lat: p.lat, lon: p.lon })),
          { lat: startPoint.lat, lon: startPoint.lon },
        ];

        const wantTrack = showTrack && trackAllowed;
        const routeRes = await osrmRoute({
          coords,
          overview: wantTrack ? 'full' : 'false',
          geometries: 'geojson',
          signal: controller.signal,
        });

        // marker numbers / track only for single task
        if (tasks.length === 1) {
          const nums = new Map<string, number>();
          ordered.forEach((p, i) => nums.set(p.id, i + 1));
          setMileageOrderNumbers(nums);
        }

        const driveKm = round1(routeRes.distance / 1000);
        const driveMinutes = toIntMinutes(routeRes.duration / 60);
        const serviceMinutes = ordered.reduce((sum, p) => sum + normalizeVisitMinutes(p.visitMinutes), 0);
        const totalMinutes = driveMinutes + serviceMinutes;

        const legs = (routeRes.legs || []).map((leg, i) => {
          const fromIsStart = i === 0;
          const toIsStart = i === ordered.length;

          const fromLabel = fromIsStart
            ? `Старт: ${startPoint.address || sectionRoute}`
            : (ordered[i - 1]?.name || ordered[i - 1]?.clientCode || '');
          const toLabel = toIsStart
            ? `Старт: ${startPoint.address || sectionRoute}`
            : (ordered[i]?.name || ordered[i]?.clientCode || '');

          return {
            from: fromIsStart
              ? { type: 'start' as const, label: fromLabel }
              : { type: 'point' as const, id: ordered[i - 1]?.id, label: fromLabel },
            to: toIsStart
              ? { type: 'start' as const, label: toLabel }
              : { type: 'point' as const, id: ordered[i]?.id, label: toLabel },
            distanceKm: round1(leg.distance / 1000),
            driveMinutes: toIntMinutes(leg.duration / 60),
          };
        });

        const geometry = wantTrack && routeRes.geometry?.coordinates
          ? {
              type: 'LineString' as const,
              coords: routeRes.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
            }
          : undefined;

        const rep: RoadMileageReport = {
          id: reportId,
          createdAt: new Date().toISOString(),
          calcProvider: 'osrm',
          calcProfile: 'driving',
          route: t.route,
          dayCode: t.dayCode,
          dayLabel: t.dayLabel,
          weekKey: t.weekKey,
          isoWeek: t.isoWeek,
          orderMode,
          orderSaved: false,
          start: { lat: startPoint.lat, lon: startPoint.lon, address: startPoint.address },
          stops: ordered.map((p) => ({
            pointId: p.id,
            clientCode: p.clientCode,
            name: p.name,
            lat: p.lat,
            lon: p.lon,
            visitMinutes: normalizeVisitMinutes(p.visitMinutes),
          })),
          driveKm,
          driveMinutes,
          serviceMinutes,
          totalMinutes,
          legs,
          geometry,
        };

        reports.push(rep);

        if (geometry && tasks.length === 1) {
          setRoadTrack({ coords: geometry.coords, color: colorForRoute(t.route), reportId });
        }

        setProgress({ done: idx + 1, total: tasks.length, label });
      }

      setDraftReports(reports);
      setDraftOrders(ordersByPointId);

      // For full runs: ensure track is cleared
      if (reports.length !== 1) {
        setRoadTrack(null);
      }

      setDraftReports(reports);
      setDraftOrders(ordersByPointId);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      if (e instanceof DOMException && e.name === 'AbortError') {
        setError('Расчёт отменён пользователем.');
      } else {
        setError(e instanceof Error ? e.message : 'Ошибка расчёта');
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const saveWithoutOrder = () => {
    if (!draftReports) return;
    // store reports as-is (orderSaved=false)
    for (const r of draftReports) {
      addRoadMileageReport({ ...r, orderSaved: false });
    }
    onClose();
  };

  const saveWithOrder = () => {
    if (!draftReports || !draftOrders) return;

    // if for some reason there is nothing to save (should not happen), keep the button disabled
    if (draftReports.length === 0) return;

    // persist all orders into visitOrderByWeek
    const next = data.points.map((p) => {
      const upd = draftOrders[p.id];
      if (!upd) return p;
      return {
        ...p,
        visitOrderByWeek: {
          ...(p.visitOrderByWeek || {}),
          ...upd,
        },
      };
    });

    updatePoints(next);

    for (const r of draftReports) {
      addRoadMileageReport({ ...r, orderSaved: true });
    }

    onClose();
  };

  const totals = useMemo(() => {
    if (!draftReports) return null;
    const totalStops = draftReports.reduce((s, r) => s + r.stops.length, 0);
    const driveKm = round1(draftReports.reduce((s, r) => s + r.driveKm, 0));
    const driveMinutes = toIntMinutes(draftReports.reduce((s, r) => s + r.driveMinutes, 0));
    const serviceMinutes = toIntMinutes(draftReports.reduce((s, r) => s + r.serviceMinutes, 0));
    const totalMinutes = toIntMinutes(driveMinutes + serviceMinutes);
    return { totalStops, driveKm, driveMinutes, serviceMinutes, totalMinutes };
  }, [draftReports]);

  const title = (() => {
    if (!sectionRoute) return '🚗 Пробег по дорогам';
    if (scope === 'single' && singleContext) {
      return `🚗 Пробег по дорогам: ${sectionRoute} • ${singleContext.dayLabel} • W${singleContext.weekKey}`;
    }
    return `🚗 Пробег по дорогам: ${sectionRoute} • полный расчёт`;
  })();

  const requestHint = useMemo(() => {
    const totalReq = tasks.length;
    const remaining = progress ? Math.max(0, progress.total - progress.done) : totalReq;
    return { totalReq, remaining };
  }, [progress, tasks.length]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-4xl bg-white dark:bg-[#111827] border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
          <div className="font-semibold text-slate-900 dark:text-white">{title}</div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[calc(100vh-190px)] overflow-y-auto">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <b>Ограничения и правила расчёта:</b>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Расчёт выполняется в браузере через публичный роутер <b>OSRM</b> (OpenStreetMap). Скорость и доступность зависят от сервиса.</li>
              <li>Обязательна <b>точка старта</b> для маршрута (Админ → Точки старта). Без старта расчёт невозможен.</li>
              <li>Суббота/воскресенье не участвуют (считаем только <b>ПН–ПТ</b>).</li>
              <li>Порядок строится <b>по прямой</b> (nearest neighbour), пробег/время считаются <b>по дорогам</b> (OSRM).</li>
              <li>Время визита берётся из точки; если пусто/некорректно — используется <b>15 минут</b>.</li>
              <li>Показ трека доступен только для <b>одной комбинации</b> «день + неделя» (иначе трек отключается).</li>
            </ul>
          </div>

          {!baseOk && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
              Для расчёта переключитесь в режим <b>«Секции»</b> и выберите маршрут (ТП).
            </div>
          )}

          {baseOk && !startPoint && sectionRoute && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200 text-sm">
              Не найдена точка старта для маршрута <b>{sectionRoute}</b>. Добавьте старт в Админ → «Точки старта».
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
              <div className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Область расчёта</div>

              <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'full'}
                  onChange={() => setScope('full')}
                  className="mt-1"
                  disabled={isRunning}
                />
                <span>
                  <b>Полный расчёт</b><br />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    ПН–ПТ × недели: выбранные в фильтре цикличности (если выбраны), иначе 4 ближайшие (0..3).
                    Если фильтр дней выбран — считаем только выбранные рабочие дни.
                  </span>
                </span>
              </label>

              <label className="mt-2 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'single'}
                  onChange={() => setScope('single')}
                  className="mt-1"
                  disabled={isRunning}
                />
                <span>
                  <b>Текущая комбинация</b><br />
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Использует выбранные в фильтрах <b>1 день</b> и <b>1 неделю</b>. Доступен трек.
                  </span>
                </span>
              </label>

              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Запросов к OSRM будет выполнено: <b>{tasks.length}</b>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
              <div className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Порядок и отображение</div>

              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="radio"
                    name="orderMode"
                    checked={orderMode === 'useExistingAndFill'}
                    onChange={() => setOrderMode('useExistingAndFill')}
                    className="mt-1"
                    disabled={isRunning}
                  />
                  <span>
                    <b>С порядком + дозаполнение</b><br />
                    <span className="text-xs text-slate-500 dark:text-slate-400">Сначала используем сохранённый порядок (если есть), затем дозаполняем остальные точки.</span>
                  </span>
                </label>

                <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="radio"
                    name="orderMode"
                    checked={orderMode === 'rebuildNearest'}
                    onChange={() => setOrderMode('rebuildNearest')}
                    className="mt-1"
                    disabled={isRunning}
                  />
                  <span>
                    <b>Пересчитать заново</b><br />
                    <span className="text-xs text-slate-500 dark:text-slate-400">Игнорируем текущий порядок и строим новый от старта по ближайшему соседу (по прямой).</span>
                  </span>
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={showTrack}
                    onChange={(e) => setShowTrack(e.target.checked)}
                    disabled={!trackAllowed || isRunning}
                  />
                  Показать трек маршрута на карте
                </label>
                {!trackAllowed && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Трек доступен только при расчёте одной комбинации (день + неделя).
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-200 text-sm">
              {error}
            </div>
          )}

          {progress && (
            <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/5">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300/70">
                <div>
                  Прогресс: <b>{progress.done}</b> / <b>{progress.total}</b>
                  {progress.label ? <span className="ml-2 text-slate-500 dark:text-slate-400">({progress.label})</span> : null}
                </div>
                <div>
                  Осталось запросов: <b>{requestHint.remaining}</b>
                </div>
              </div>
              <div className="mt-2 h-2 rounded bg-slate-200 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={!baseOk || !startPoint || !canRun || isRunning}
              className="rounded-xl px-3 py-2 text-sm text-white bg-[#2196F3] hover:bg-[#1976D2] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Расчёт…' : 'Рассчитать'}
            </button>
            {isRunning && (
              <button
                onClick={cancel}
                className="rounded-xl px-3 py-2 text-sm border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
              >
                Отменить
              </button>
            )}
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Запросов к OSRM: <b>{requestHint.totalReq}</b> (это не квота, а количество необходимых запросов для выбранных комбинаций)
            </div>
          </div>

          {draftReports && totals && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="text-center p-3 bg-sky-50 dark:bg-sky-900/20 rounded-xl">
                  <div className="text-2xl font-bold text-sky-600">{draftReports.length}</div>
                  <div className="text-xs text-slate-500">Отчётов</div>
                </div>
                <div className="text-center p-3 bg-sky-50 dark:bg-sky-900/20 rounded-xl">
                  <div className="text-2xl font-bold text-sky-600">{totals.totalStops}</div>
                  <div className="text-xs text-slate-500">Точек (суммарно)</div>
                </div>
                <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
                  <div className="text-2xl font-bold text-emerald-600">{totals.driveKm} км</div>
                  <div className="text-xs text-slate-500">Пробег (дороги)</div>
                </div>
                <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
                  <div className="text-2xl font-bold text-amber-600">{Math.floor(totals.driveMinutes / 60)}ч {totals.driveMinutes % 60}м</div>
                  <div className="text-xs text-slate-500">В пути</div>
                </div>
                <div className="text-center p-3 bg-violet-50 dark:bg-violet-900/20 rounded-xl">
                  <div className="text-2xl font-bold text-violet-600">{Math.floor(totals.totalMinutes / 60)}ч {totals.totalMinutes % 60}м</div>
                  <div className="text-xs text-slate-500">Итого</div>
                </div>
              </div>

              <div className="text-sm text-slate-700 dark:text-slate-200">
                <b>Время визитов (суммарно):</b> {totals.serviceMinutes} мин
              </div>

              <details className="border border-slate-200 dark:border-white/10 rounded-xl p-3 bg-white/70 dark:bg-white/5">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900 dark:text-white">
                  Детализация по комбинациям (день × неделя)
                </summary>
                <div className="mt-2 max-h-80 overflow-auto space-y-2">
                  {draftReports
                    .slice()
                    .sort((a, b) => (a.isoWeek - b.isoWeek) || (Number(a.dayCode) - Number(b.dayCode)))
                    .map((r) => (
                      <details key={r.id} className="border border-slate-200/60 dark:border-white/10 rounded-lg p-2">
                        <summary className="cursor-pointer text-xs text-slate-700 dark:text-slate-200 font-semibold">
                          {r.dayLabel} • ISO {r.isoWeek} • W{r.weekKey} — {r.stops.length} точ. — {r.driveKm} км — {Math.floor(r.totalMinutes / 60)}ч {r.totalMinutes % 60}м
                        </summary>
                        <div className="mt-2 text-[11px] text-slate-600 dark:text-slate-300/80">
                          В пути: {Math.floor(r.driveMinutes / 60)}ч {r.driveMinutes % 60}м • Визиты: {r.serviceMinutes} мин
                        </div>
                        <div className="mt-2 overflow-auto">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="text-left text-slate-500 dark:text-slate-400">
                                <th className="py-1 pr-2">№</th>
                                <th className="py-1 pr-2">Откуда → Куда</th>
                                <th className="py-1 pr-2">Км</th>
                                <th className="py-1 pr-2">Мин</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.legs.map((l, i) => (
                                <tr key={i} className="border-t border-slate-200 dark:border-white/10">
                                  <td className="py-1 pr-2 font-mono text-slate-400">{i + 1}</td>
                                  <td className="py-1 pr-2">
                                    {l.from.label} <span className="text-slate-400">→</span> {l.to.label}
                                  </td>
                                  <td className="py-1 pr-2 font-semibold">{l.distanceKm}</td>
                                  <td className="py-1 pr-2 font-semibold">{l.driveMinutes}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    ))}
                </div>
              </details>

              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
                Сохранить рассчитанный порядок в W-неделях для всех рассчитанных комбинаций?
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
          >
            Закрыть
          </button>

          {draftReports && (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
