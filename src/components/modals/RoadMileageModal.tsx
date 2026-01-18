import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@/store/AppContext';
import { DAY_CODE_TO_LABEL } from '@/constants';
import { Point, RoadMileageOrderMode, RoadMileageReport } from '@/types';
import {
  getISOWeekNumber,
  haversineDistance,
  pointMatchesCycleWeek,
  uid,
} from '@/utils/helpers';
import { osrmRoute } from '@/utils/osrm';

/* ================= utils ================= */

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
  const n =
    typeof raw === 'number'
      ? raw
      : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 15;
  return Math.round(n);
}

/* ================= types ================= */

type CalcScope = 'single' | 'full';

type Task = {
  route: string;
  dayCode: string;
  dayLabel: string;
  weekOffset: number;
  isoWeek: number;
  weekKey: string;
  points: Point[];
};

/* ================= order builder ================= */

function buildOrder(params: {
  orderMode: RoadMileageOrderMode;
  weekKey: string;
  start: { lat: number; lon: number };
  points: Point[];
}): Point[] {
  const { orderMode, weekKey, start, points } = params;

  if (orderMode === 'useExistingAndFill') {
    const ordered = points
      .filter(
        (p) =>
          typeof p.visitOrderByWeek?.[weekKey] === 'number' &&
          Number.isFinite(p.visitOrderByWeek?.[weekKey])
      )
      .slice()
      .sort((a, b) => {
        const oa = a.visitOrderByWeek?.[weekKey] ?? Infinity;
        const ob = b.visitOrderByWeek?.[weekKey] ?? Infinity;
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
      let bestD = Infinity;
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
  const rest = points.slice();
  const result: Point[] = [];
  let curLat = start.lat;
  let curLon = start.lon;

  while (rest.length > 0) {
    let bestIdx = 0;
    let bestD = Infinity;
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

/* ================= aggregation ================= */

function buildCombinedReport(
  reports: RoadMileageReport[]
): RoadMileageReport {
  const base = reports[0];

  const driveMinutes = toIntMinutes(
    reports.reduce((s, r) => s + r.driveMinutes, 0)
  );
  const serviceMinutes = toIntMinutes(
    reports.reduce((s, r) => s + r.serviceMinutes, 0)
  );

  return {
    ...base,
    id: uid(),
    createdAt: new Date().toISOString(),

    dayCode: 'ALL',
    dayLabel: 'Все дни',
    weekKey: 'ALL',

    stops: reports.flatMap((r) => r.stops),
    driveKm: round1(reports.reduce((s, r) => s + r.driveKm, 0)),
    driveMinutes,
    serviceMinutes,
    totalMinutes: driveMinutes + serviceMinutes,

    meta: {
      runs: reports.map((r) => ({
        dayCode: r.dayCode,
        dayLabel: r.dayLabel,
        isoWeek: r.isoWeek,
        weekKey: r.weekKey,
        stops: r.stops.length,
        driveKm: r.driveKm,
        totalMinutes: r.totalMinutes,
      })),
    },
  };
}

/* ================= component ================= */

export function RoadMileageModal(props: {
  open: boolean;
  onClose: () => void;
}) {
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
  const [orderMode, setOrderMode] =
    useState<RoadMileageOrderMode>('useExistingAndFill');
  const [showTrack, setShowTrack] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState('');

  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    label?: string;
  } | null>(null);

  const [draftReports, setDraftReports] =
    useState<RoadMileageReport[] | null>(null);
  const [draftOrders, setDraftOrders] =
    useState<Record<string, Record<string, number>> | null>(null);

  /* ======== prerequisites ======== */

  const baseOk = useMemo(() => {
    if (mapMode !== 'section') return false;
    if (!sectionRoute) return false;
    return true;
  }, [mapMode, sectionRoute]);

  const selectedDayCodes = useMemo(() => {
    const sel = Array.from(filters.days).map(String);
    const weekdays = sel.filter((d) =>
      ['1', '2', '3', '4', '5'].includes(d)
    );
    return weekdays.length > 0 ? weekdays : ['1', '2', '3', '4', '5'];
  }, [filters.days]);

  const selectedWeekOffsets = useMemo(() => {
    const offs = Array.from(filters.cycleWeeks)
      .filter((x) => typeof x === 'number')
      .map((x) => x as number);
    return offs.length > 0 ? offs : [0, 1, 2, 3];
  }, [filters.cycleWeeks]);

  /* ======== tasks ======== */

  const tasks = useMemo<Task[]>(() => {
    if (!baseOk || !sectionRoute) return [];

    const routePoints = data.points.filter(
      (p) => p.route === sectionRoute
    );

    const res: Task[] = [];

    for (const weekOffset of selectedWeekOffsets) {
      const isoWeek = getTargetIsoWeekFromOffset(weekOffset);
      const weekKey = getWeekKeyFromIsoWeek(isoWeek);

      for (const dayCode of selectedDayCodes) {
        const pts = routePoints
          .filter((p) => p.visitDayCode === dayCode)
          .filter((p) => pointMatchesCycleWeek(p.frequencyCode, isoWeek));

        if (pts.length === 0) continue;

        res.push({
          route: sectionRoute,
          dayCode,
          dayLabel: DAY_CODE_TO_LABEL[dayCode] || dayCode,
          weekOffset,
          isoWeek,
          weekKey,
          points: pts,
        });
      }
    }

    res.sort(
      (a, b) =>
        a.weekOffset - b.weekOffset ||
        Number(a.dayCode) - Number(b.dayCode)
    );

    return res;
  }, [
    baseOk,
    data.points,
    sectionRoute,
    selectedDayCodes,
    selectedWeekOffsets,
  ]);

  /* ======== run ======== */

  const run = async () => {
    setError('');
    setDraftReports(null);
    setDraftOrders(null);

    if (!baseOk || !sectionRoute) return;

    const startPoint = data.startPoints.find(
      (sp) => sp.route === sectionRoute
    );
    if (!startPoint) {
      setError('Не найдена точка старта.');
      return;
    }

    if (tasks.length === 0) {
      setError('Нет точек для расчёта.');
      return;
    }

    setIsRunning(true);
    setProgress({ done: 0, total: tasks.length });

    setRoadTrack(null);
    setMileageOrderNumbers(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const reports: RoadMileageReport[] = [];
    const ordersByPointId: Record<string, Record<string, number>> = {};

    try {
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        setProgress({
          done: i,
          total: tasks.length,
          label: `${t.dayLabel} • ISO ${t.isoWeek} • W${t.weekKey}`,
        });

        const ordered = buildOrder({
          orderMode,
          weekKey: t.weekKey,
          start: { lat: startPoint.lat, lon: startPoint.lon },
          points: t.points,
        });

        ordered.forEach((p, idx) => {
          if (!ordersByPointId[p.id]) ordersByPointId[p.id] = {};
          ordersByPointId[p.id][t.weekKey] = idx + 1;
        });

        const coords = [
          { lat: startPoint.lat, lon: startPoint.lon },
          ...ordered.map((p) => ({ lat: p.lat, lon: p.lon })),
          { lat: startPoint.lat, lon: startPoint.lon },
        ];

        const routeRes = await osrmRoute({
          coords,
          overview: 'false',
          geometries: 'geojson',
          signal: controller.signal,
        });

        const driveKm = round1(routeRes.distance / 1000);
        const driveMinutes = toIntMinutes(routeRes.duration / 60);
        const serviceMinutes = ordered.reduce(
          (s, p) => s + normalizeVisitMinutes(p.visitMinutes),
          0
        );

        const rep: RoadMileageReport = {
          id: uid(),
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
          start: {
            lat: startPoint.lat,
            lon: startPoint.lon,
            address: startPoint.address,
          },
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
          totalMinutes: driveMinutes + serviceMinutes,
          legs: [],
        };

        reports.push(rep);
        setProgress({ done: i + 1, total: tasks.length });
      }

      setDraftReports(reports);
      setDraftOrders(ordersByPointId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка расчёта');
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  /* ======== save ======== */

  const saveWithoutOrder = () => {
    if (!draftReports) return;
    const combined = buildCombinedReport(draftReports);
    addRoadMileageReport({ ...combined, orderSaved: false });
    onClose();
  };

  const saveWithOrder = () => {
    if (!draftReports || !draftOrders) return;

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

    const combined = buildCombinedReport(draftReports);
    addRoadMileageReport({ ...combined, orderSaved: true });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-xl w-full max-w-xl p-4">
        <div className="font-semibold mb-3">
          🚗 Пробег по дорогам: {sectionRoute}
        </div>

        {error && <div className="text-red-600 mb-2">{error}</div>}

        <button
          onClick={run}
          disabled={isRunning}
          className="px-3 py-2 bg-blue-600 text-white rounded"
        >
          {isRunning ? 'Расчёт…' : 'Рассчитать'}
        </button>

        {draftReports && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={saveWithoutOrder}
              className="px-3 py-2 border rounded"
            >
              Не сохранять порядок
            </button>
            <button
              onClick={saveWithOrder}
              className="px-3 py-2 bg-emerald-600 text-white rounded"
            >
              Сохранить порядок
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
