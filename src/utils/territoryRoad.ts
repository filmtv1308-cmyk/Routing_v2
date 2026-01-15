import { TerritoryCalcRun } from '@/types';
import { osrmRoute } from '@/utils/osrm';

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function toIntMinutes(n: number) {
  return Math.round(n);
}

export async function computeTerritoryRunRoads(params: {
  run: TerritoryCalcRun;
  maxStopsPerCombo?: number;
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number; label?: string }) => void;
}): Promise<TerritoryCalcRun> {
  const { run, maxStopsPerCombo = 25, signal, onProgress } = params;

  // Build task list for combos that need road computation
  const tasks: Array<{ routeIdx: number; comboIdx: number; label: string }> = [];
  for (let ri = 0; ri < run.routes.length; ri++) {
    const rr = run.routes[ri];
    for (let ci = 0; ci < rr.combos.length; ci++) {
      const c = rr.combos[ci];
      const need = !c.road || c.road.status !== 'ok';
      if (!need) continue;
      if (c.stops.length === 0) continue;
      tasks.push({
        routeIdx: ri,
        comboIdx: ci,
        label: `${rr.route} • ${c.dayLabel} • ISO ${c.isoWeek} • W${c.weekKey} • ${c.stops.length} точ.`,
      });
    }
  }

  const total = tasks.length;
  onProgress?.({ done: 0, total });

  if (total === 0) return run;

  const now = new Date().toISOString();
  const next: TerritoryCalcRun = {
    ...run,
    routes: run.routes.map((rr) => ({
      ...rr,
      combos: rr.combos.map((c) => ({ ...c })),
    })),
  };

  for (let i = 0; i < tasks.length; i++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const t = tasks[i];
    const rr = next.routes[t.routeIdx];
    const c = rr.combos[t.comboIdx];

    onProgress?.({ done: i, total, label: t.label });

    const serviceMinutes = c.stops.reduce((s, x) => s + (Number.isFinite(x.visitMinutes) ? x.visitMinutes : 0), 0);

    if (c.stops.length > maxStopsPerCombo) {
      c.road = {
        calcProvider: 'osrm',
        computedAt: now,
        status: 'skipped',
        errorMessage: `Слишком много точек для расчёта по дорогам (>${maxStopsPerCombo}).`,
        driveKm: 0,
        driveMinutes: 0,
        serviceMinutes,
        totalMinutes: serviceMinutes,
        legs: [],
      };
      onProgress?.({ done: i + 1, total, label: t.label });
      continue;
    }

    try {
      const coords = [
        { lat: rr.startPoint.lat, lon: rr.startPoint.lon },
        ...c.stops.map((s) => ({ lat: s.lat, lon: s.lon })),
        { lat: rr.startPoint.lat, lon: rr.startPoint.lon },
      ];

      const routeRes = await osrmRoute({
        coords,
        overview: 'false',
        geometries: 'geojson',
        signal,
        timeoutMs: 25000,
      });

      const driveKm = round1(routeRes.distance / 1000);
      const driveMinutes = toIntMinutes(routeRes.duration / 60);

      const legs = (routeRes.legs || []).map((leg, idx) => {
        const fromLabel = idx === 0
          ? `Старт: ${rr.startPoint.address}`
          : (c.stops[idx - 1]?.name || c.stops[idx - 1]?.clientCode || '');

        const toLabel = idx === c.stops.length
          ? `Старт: ${rr.startPoint.address}`
          : (c.stops[idx]?.name || c.stops[idx]?.clientCode || '');

        return {
          from: fromLabel,
          to: toLabel,
          distanceKm: round1(leg.distance / 1000),
          driveMinutes: toIntMinutes(leg.duration / 60),
        };
      });

      c.road = {
        calcProvider: 'osrm',
        computedAt: new Date().toISOString(),
        status: 'ok',
        driveKm,
        driveMinutes,
        serviceMinutes,
        totalMinutes: driveMinutes + serviceMinutes,
        legs,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'OSRM error';
      c.road = {
        calcProvider: 'osrm',
        computedAt: new Date().toISOString(),
        status: 'error',
        errorMessage: msg,
        driveKm: 0,
        driveMinutes: 0,
        serviceMinutes,
        totalMinutes: serviceMinutes,
        legs: [],
      };
    }

    onProgress?.({ done: i + 1, total, label: t.label });
  }

  return next;
}
