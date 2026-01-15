import * as XLSX from 'xlsx';
import { DAY_CODE_TO_LABEL } from '@/constants';
import { TerritoryCalcRun } from '@/types';

function safeSheetName(name: string): string {
  // Excel limit: 31 chars, cannot contain: : \ / ? * [ ]
  const cleaned = name.replace(/[:\\/?*\[\]]/g, ' ').trim();
  return (cleaned || 'Sheet').slice(0, 31);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

type WeekKey = '1' | '2' | '3' | '4';
const WEEK_KEYS: WeekKey[] = ['1', '2', '3', '4'];

function buildRouteSheetAOA(rr: TerritoryCalcRun['routes'][number]): { aoa: any[][]; merges: XLSX.Range[] } {
  const COLS = 4 + 3 * 4; // Route, Client code, Name, Address + (W1..W4)*(Order,Visit,Segment)

  const aoa: any[][] = [];
  const merges: XLSX.Range[] = [];

  // Group combos by dayCode and weekKey
  const combosByDayWeek = new Map<string, Map<WeekKey, (typeof rr.combos)[number]>>();
  for (const c of rr.combos) {
    const dayCode = c.dayCode;
    if (!['1', '2', '3', '4', '5'].includes(dayCode)) continue;
    const wk = c.weekKey as WeekKey;
    if (!WEEK_KEYS.includes(wk)) continue;
    if (!combosByDayWeek.has(dayCode)) combosByDayWeek.set(dayCode, new Map());
    combosByDayWeek.get(dayCode)!.set(wk, c);
  }

  const dayCodesSorted = Array.from(combosByDayWeek.keys()).sort((a, b) => Number(a) - Number(b));

  for (const dayCode of dayCodesSorted) {
    const dayLabel = DAY_CODE_TO_LABEL[dayCode] || dayCode;
    const byWeek = combosByDayWeek.get(dayCode)!;

    // Day title row (merged across)
    const dayRow = new Array(COLS).fill('');
    dayRow[0] = dayLabel;
    const dayRowIndex = aoa.length;
    aoa.push(dayRow);
    merges.push({ s: { r: dayRowIndex, c: 0 }, e: { r: dayRowIndex, c: COLS - 1 } });

    // Header row with week group labels
    const headerTop = new Array(COLS).fill('');
    headerTop[0] = 'Route';
    headerTop[1] = 'Client code';
    headerTop[2] = 'Name';
    headerTop[3] = 'Address';

    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const wk = WEEK_KEYS[wi];
      const base = 4 + wi * 3;
      headerTop[base] = `W${wk}`;
      const r = aoa.length;
      merges.push({ s: { r, c: base }, e: { r, c: base + 2 } });
    }
    aoa.push(headerTop);

    const headerSub = new Array(COLS).fill('');
    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const base = 4 + wi * 3;
      headerSub[base] = 'Order';
      headerSub[base + 1] = 'Visit (min)';
      headerSub[base + 2] = 'Segment (km)';
    }
    aoa.push(headerSub);

    // Start top row
    const startTop = new Array(COLS).fill('');
    startTop[2] = 'Старт';
    startTop[3] = rr.startPoint.address;
    aoa.push(startTop);

    // Build per-week maps: pointId -> metrics
    type Cell = { order: number; visit: number; segKm: number };
    const weekPointMap = new Map<WeekKey, Map<string, Cell>>();
    const weekReturnSeg = new Map<WeekKey, number>();
    const weekTotals = new Map<WeekKey, { count: number; visit: number; km: number }>();

    for (const wk of WEEK_KEYS) {
      const c = byWeek.get(wk);
      if (!c) continue;
      const mp = new Map<string, Cell>();
      for (let i = 0; i < c.stops.length; i++) {
        const stop = c.stops[i];
        const seg = c.straight.segments[i];
        const segKm = seg ? round1(seg.distanceKm) : '';
        mp.set(stop.pointId, {
          order: i + 1,
          visit: stop.visitMinutes,
          segKm: typeof segKm === 'number' ? segKm : 0,
        });
      }
      weekPointMap.set(wk, mp);

      const backSeg = c.straight.segments[c.stops.length];
      if (backSeg) weekReturnSeg.set(wk, round1(backSeg.distanceKm));

      const count = c.stops.length;
      const visit = c.straight.serviceMinutes;
      const km = c.straight.distanceKm;
      weekTotals.set(wk, { count, visit, km });
    }

    // Build union list of points for this day
    const baseW: WeekKey | null = byWeek.has('1') ? '1' : (WEEK_KEYS.find((wk) => byWeek.has(wk)) || null);

    const union: string[] = [];
    const seen = new Set<string>();

    const pushStopIds = (wk: WeekKey) => {
      const c = byWeek.get(wk);
      if (!c) return;
      for (const s of c.stops) {
        if (seen.has(s.pointId)) continue;
        seen.add(s.pointId);
        union.push(s.pointId);
      }
    };

    if (baseW) pushStopIds(baseW);
    for (const wk of WEEK_KEYS) {
      if (wk === baseW) continue;
      pushStopIds(wk);
    }

    // Build lookup for point fields
    const pointById = new Map<string, { clientCode: string; name: string; address: string }>();
    for (const wk of WEEK_KEYS) {
      const c = byWeek.get(wk);
      if (!c) continue;
      for (const s of c.stops) {
        if (!pointById.has(s.pointId)) {
          pointById.set(s.pointId, {
            clientCode: s.clientCode,
            name: s.name,
            address: s.address,
          });
        }
      }
    }

    for (const pid of union) {
      const info = pointById.get(pid);
      const row = new Array(COLS).fill('');
      row[0] = rr.route;
      row[1] = info?.clientCode || '';
      row[2] = info?.name || '';
      row[3] = info?.address || '';

      for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
        const wk = WEEK_KEYS[wi];
        const base = 4 + wi * 3;
        const cell = weekPointMap.get(wk)?.get(pid);
        if (cell) {
          row[base] = cell.order;
          row[base + 1] = cell.visit;
          row[base + 2] = round1(cell.segKm);
        }
      }

      aoa.push(row);
    }

    // Start bottom row (return-to-start segment)
    const startBottom = new Array(COLS).fill('');
    startBottom[2] = 'Старт';
    startBottom[3] = rr.startPoint.address;
    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const wk = WEEK_KEYS[wi];
      const base = 4 + wi * 3;
      const back = weekReturnSeg.get(wk);
      if (typeof back === 'number') {
        startBottom[base + 2] = back;
      }
    }
    aoa.push(startBottom);

    // Totals row
    const totalsRow = new Array(COLS).fill('');
    totalsRow[0] = `${rr.route} Итог`;
    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const wk = WEEK_KEYS[wi];
      const base = 4 + wi * 3;
      const tot = weekTotals.get(wk);
      if (tot) {
        totalsRow[base] = tot.count;
        totalsRow[base + 1] = tot.visit;
        totalsRow[base + 2] = round1(tot.km);
      }
    }
    aoa.push(totalsRow);

    // Empty spacer
    aoa.push(new Array(COLS).fill(''));
  }

  return { aoa, merges };
}

export function buildTerritoryRouteReportWorkbook(run: TerritoryCalcRun): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  for (const rr of run.routes) {
    const { aoa, merges } = buildRouteSheetAOA(rr);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;

    // Set column widths to be readable
    ws['!cols'] = [
      { wch: 14 }, // Route
      { wch: 14 }, // Client code
      { wch: 26 }, // Name
      { wch: 46 }, // Address
      // 12 columns for weeks
      ...Array.from({ length: 12 }, () => ({ wch: 10 })),
    ];

    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(rr.route));
  }

  return wb;
}
