import { Point, RoadMileageOrderMode, TerritoryCalcCombo, TerritoryCalcRoute, TerritoryCalcRun, TerritoryCalcStop } from '@/types';
import { DAY_CODE_TO_LABEL } from '@/constants';
import { getISOWeekNumber, haversineDistance, pointMatchesCycleWeek, uid } from '@/utils/helpers';

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function toIntMinutes(n: number) {
  return Math.round(n);
}

export function normalizeVisitMinutes(raw: Point['visitMinutes']): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 15;
  return Math.round(n);
}

function getWeekKeyFromIsoWeek(isoWeek: number): string {
  const w = ((isoWeek - 1) % 4) + 1;
  return String(w);
}

function getTargetIsoWeekFromOffset(offset: number): number {
  const d = new Date();
  d.setDate(d.getDate() + offset * 7);
  return getISOWeekNumber(d);
}

export function buildTerritoryRun(params: {
  visiblePoints: Point[];
  startByRoute: Map<string, { lat: number; lon: number; address: string }>;
  activeRoutes: string[];
  dayCodes: string[]; // 1..5 only
  weekOffsets: number[];
  orderMode: RoadMileageOrderMode;
  filtersSnapshot: TerritoryCalcRun['filtersSnapshot'];
}): { run: TerritoryCalcRun; plannedOrdersByRoute: Record<string, Array<{ weekKey: string; dayCode: string; orderedPointIds: string[] }>> } {
  const {
    visiblePoints,
    startByRoute,
    activeRoutes,
    dayCodes,
    weekOffsets,
    orderMode,
    filtersSnapshot,
  } = params;

  const createdAt = new Date().toISOString();
  const missingStartRoutes = activeRoutes.filter((r) => !startByRoute.has(r));
  const routesToCalc = activeRoutes.filter((r) => startByRoute.has(r));

  const runRoutes: TerritoryCalcRoute[] = [];
  const plannedOrdersByRoute: Record<string, Array<{ weekKey: string; dayCode: string; orderedPointIds: string[] }>> = {};

  const buildOrder = (start: { lat: number; lon: number }, points: Point[], weekKey: string): Point[] => {
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
  };

  for (const route of routesToCalc) {
    const start = startByRoute.get(route)!;
    const routePointsAll = visiblePoints.filter((p) => p.route === route);

    const combos: TerritoryCalcCombo[] = [];
    const planned: Array<{ weekKey: string; dayCode: string; orderedPointIds: string[] }> = [];

    for (const weekOffset of weekOffsets) {
      const isoWeek = getTargetIsoWeekFromOffset(weekOffset);
      const displayWeek = isoWeek > 52 ? isoWeek - 52 : isoWeek;
      const weekKey = getWeekKeyFromIsoWeek(isoWeek);

      const pointsInWeek = routePointsAll.filter((p) => pointMatchesCycleWeek(p.frequencyCode, isoWeek));

      for (const dayCode of dayCodes) {
        const dayLabel = DAY_CODE_TO_LABEL[dayCode] || dayCode;
        const dayPoints = pointsInWeek.filter((p) => p.visitDayCode === dayCode);
        if (dayPoints.length === 0) continue;

        const ordered = buildOrder({ lat: start.lat, lon: start.lon }, dayPoints, weekKey);
        planned.push({ weekKey, dayCode, orderedPointIds: ordered.map((p) => p.id) });

        let curLat = start.lat;
        let curLon = start.lon;
        let km = 0;
        const segments: TerritoryCalcCombo['straight']['segments'] = [];

        for (let i = 0; i < ordered.length; i++) {
          const p = ordered[i];
          const dist = haversineDistance(curLat, curLon, p.lat, p.lon) * 1.3;
          km += dist;
          const from = i === 0 ? `Старт: ${start.address}` : (ordered[i - 1].name || ordered[i - 1].clientCode);
          const to = p.name || p.clientCode;
          segments.push({ from, to, distanceKm: round1(dist) });
          curLat = p.lat;
          curLon = p.lon;
        }

        if (ordered.length > 0) {
          const distBack = haversineDistance(curLat, curLon, start.lat, start.lon) * 1.3;
          km += distBack;
          segments.push({
            from: ordered[ordered.length - 1].name || ordered[ordered.length - 1].clientCode,
            to: `Старт: ${start.address}`,
            distanceKm: round1(distBack)
          });
        }

        const driveMinutes = toIntMinutes((km / 40) * 60);
        const stops: TerritoryCalcStop[] = ordered.map((p) => ({
          pointId: p.id,
          clientCode: p.clientCode,
          name: p.name,
          address: p.address,
          lat: p.lat,
          lon: p.lon,
          visitMinutes: normalizeVisitMinutes(p.visitMinutes),
        }));
        const serviceMinutes = stops.reduce((s, x) => s + x.visitMinutes, 0);
        const totalMinutes = driveMinutes + serviceMinutes;

        combos.push({
          weekOffset,
          isoWeek,
          displayWeek,
          weekKey,
          dayCode,
          dayLabel,
          orderMode,
          stops,
          straight: {
            distanceKm: round1(km),
            driveMinutes,
            serviceMinutes,
            totalMinutes,
            segments,
          },
        });
      }
    }

    combos.sort((a, b) => (a.weekOffset - b.weekOffset) || (Number(a.dayCode) - Number(b.dayCode)));
    plannedOrdersByRoute[route] = planned;

    runRoutes.push({
      route,
      startPoint: start,
      combos,
    });
  }

  const run: TerritoryCalcRun = {
    id: uid(),
    createdAt,
    orderMode,
    orderSaved: false,
    filtersSnapshot,
    missingStartRoutes,
    routes: runRoutes,
  };

  return { run, plannedOrdersByRoute };
}
