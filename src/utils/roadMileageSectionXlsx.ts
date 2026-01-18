import * as XLSX from 'xlsx';
import { DAY_CODE_TO_LABEL } from '@/constants';
import { RoadMileageReport } from '@/types';

type WeekKey = '1' | '2' | '3' | '4';
const WEEK_KEYS: WeekKey[] = ['1', '2', '3', '4'];

function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*\[\]]/g, ' ').trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function getStartAddress(r?: RoadMileageReport | null): string {
  return r?.start?.address || '';
}

/**
 * ⬇️ ВАЖНО
 * Если приходит ОДИН агрегированный отчёт,
 * мы восстанавливаем из него дневные отчёты для XLSX
 */
function normalizeReports(reports: RoadMileageReport[]): RoadMileageReport[] {
  if (reports.length !== 1) return reports;

  const r = reports[0];
  const runs = (r as any)?.meta?.runs;
  if (!Array.isArray(runs) || runs.length === 0) return reports;

  const byKey = new Map<string, RoadMileageReport>();

  for (const run of runs) {
    const key = `${run.day}_${run.week}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...r,
        dayCode: run.day,
        weekKey: run.week,
        stops: [],
        legs: [],
      });
    }
  }

  // распределяем точки и ноги
  for (const rep of byKey.values()) {
    rep.stops = r.stops.filter(s => s.dayCode === rep.dayCode);
    rep.legs = r.legs.filter(l => l.dayCode === rep.dayCode);
  }

  return Array.from(byKey.values());
}

function buildRouteSheetAOA(params: {
  route: string;
  reports: RoadMileageReport[];
}): { aoa: any[][]; merges: XLSX.Range[] } {
  const { route } = params;
  const reports = normalizeReports(params.reports);

  const COLS = 4 + 4 * 4;
  const aoa: any[][] = [];
  const merges: XLSX.Range[] = [];

  const byDay = new Map<string, Map<WeekKey, RoadMileageReport>>();

  for (const r of reports) {
    const dayCode = String(r.dayCode);
    const wk = String(r.weekKey) as WeekKey;
    if (!byDay.has(dayCode)) byDay.set(dayCode, new Map());
    byDay.get(dayCode)!.set(wk, r);
  }

  const dayCodesSorted = Array.from(byDay.keys()).sort((a, b) => Number(a) - Number(b));

  for (const dayCode of dayCodesSorted) {
    const dayLabel = DAY_CODE_TO_LABEL[dayCode] || dayCode;
    const byWeek = byDay.get(dayCode)!;

    const dayRow = new Array(COLS).fill('');
    dayRow[0] = dayLabel;
    const dayRowIndex = aoa.length;
    aoa.push(dayRow);
    merges.push({ s: { r: dayRowIndex, c: 0 }, e: { r: dayRowIndex, c: COLS - 1 } });

    const headerTop = new Array(COLS).fill('');
    headerTop[0] = 'Route';
    headerTop[1] = 'Client code';
    headerTop[2] = 'Name';
    headerTop[3] = 'Address';

    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const base = 4 + wi * 4;
      headerTop[base] = `W${WEEK_KEYS[wi]}`;
      merges.push({ s: { r: aoa.length, c: base }, e: { r: aoa.length, c: base + 3 } });
    }
    aoa.push(headerTop);

    const headerSub = new Array(COLS).fill('');
    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const base = 4 + wi * 4;
      headerSub[base] = 'Order';
      headerSub[base + 1] = 'Visit (min)';
      headerSub[base + 2] = 'Leg km';
      headerSub[base + 3] = 'Leg drive (min)';
    }
    aoa.push(headerSub);

    const startTop = new Array(COLS).fill('');
    startTop[2] = 'Старт';
    startTop[3] = getStartAddress([...byWeek.values()][0]);
    aoa.push(startTop);

    const union: string[] = [];
    const seen = new Set<string>();
    const pointInfo = new Map<string, any>();

    for (const wk of WEEK_KEYS) {
      const rep = byWeek.get(wk);
      if (!rep) continue;
      for (const s of rep.stops) {
        if (!seen.has(s.pointId)) {
          seen.add(s.pointId);
          union.push(s.pointId);
          pointInfo.set(s.pointId, s);
        }
      }
    }

    for (const pid of union) {
      const info = pointInfo.get(pid);
      const row = new Array(COLS).fill('');
      row[0] = route;
      row[1] = info.clientCode;
      row[2] = info.name;
      row[3] = info.address || '';

      for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
        const rep = byWeek.get(WEEK_KEYS[wi]);
        if (!rep) continue;
        const idx = rep.stops.findIndex(s => s.pointId === pid);
        if (idx >= 0) {
          const leg = rep.legs[idx];
          const base = 4 + wi * 4;
          row[base] = idx + 1;
          row[base + 1] = info.visitMinutes;
          row[base + 2] = leg ? round1(leg.distanceKm) : '';
          row[base + 3] = leg ? Math.round(leg.driveMinutes) : '';
        }
      }

      aoa.push(row);
    }

    aoa.push(new Array(COLS).fill(''));
  }

  return { aoa, merges };
}

export function buildSectionRoadMileageWorkbook(reports: RoadMileageReport[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const byRoute = new Map<string, RoadMileageReport[]>();
  for (const r of reports) {
    const route = r.route || '—';
    if (!byRoute.has(route)) byRoute.set(route, []);
    byRoute.get(route)!.push(r);
  }

  for (const [route, rr] of byRoute) {
    const { aoa, merges } = buildRouteSheetAOA({ route, reports: rr });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;

    ws['!cols'] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 30 },
      { wch: 46 },
      ...Array.from({ length: 16 }, () => ({ wch: 12 })),
    ];

    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(route));
  }

  return wb;
}
