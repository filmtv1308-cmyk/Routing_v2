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

function buildRouteSheetAOA(params: {
  route: string;
  reports: RoadMileageReport[];
}): { aoa: any[][]; merges: XLSX.Range[] } {
  const { route, reports } = params;

  // We build a layout similar to Territory export, but with road metrics and 4 sub-columns per W.
  const COLS = 4 + 4 * 4; // Route, Client code, Name, Address + (W1..W4)*(Order,Visit,Leg km,Leg drive)

  const aoa: any[][] = [];
  const merges: XLSX.Range[] = [];

  // Group by day -> weekKey
  const byDay = new Map<string, Map<WeekKey, RoadMileageReport>>();
  for (const r of reports) {
    const dayCode = String(r.dayCode);
    if (!['1', '2', '3', '4', '5'].includes(dayCode)) continue;
    const wk = String(r.weekKey) as WeekKey;
    if (!WEEK_KEYS.includes(wk)) continue;
    if (!byDay.has(dayCode)) byDay.set(dayCode, new Map());
    byDay.get(dayCode)!.set(wk, r);
  }

  const dayCodesSorted = Array.from(byDay.keys()).sort((a, b) => Number(a) - Number(b));

  for (const dayCode of dayCodesSorted) {
    const dayLabel = DAY_CODE_TO_LABEL[dayCode] || dayCode;
    const byWeek = byDay.get(dayCode)!;

    // Day title row (merged)
    const dayRow = new Array(COLS).fill('');
    dayRow[0] = dayLabel;
    const dayRowIndex = aoa.length;
    aoa.push(dayRow);
    merges.push({ s: { r: dayRowIndex, c: 0 }, e: { r: dayRowIndex, c: COLS - 1 } });

    // Header top
    const headerTop = new Array(COLS).fill('');
    headerTop[0] = 'Route';
    headerTop[1] = 'Client code';
    headerTop[2] = 'Name';
    headerTop[3] = 'Address';

    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const wk = WEEK_KEYS[wi];
      const base = 4 + wi * 4;
      headerTop[base] = `W${wk}`;
      const r = aoa.length;
      merges.push({ s: { r, c: base }, e: { r, c: base + 3 } });
    }
    aoa.push(headerTop);

    // Header sub
    const headerSub = new Array(COLS).fill('');
    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const base = 4 + wi * 4;
      headerSub[base] = 'Order';
      headerSub[base + 1] = 'Visit (min)';
      headerSub[base + 2] = 'Leg km';
      headerSub[base + 3] = 'Leg drive (min)';
    }
    aoa.push(headerSub);

    // Start top row
    const startTop = new Array(COLS).fill('');
    startTop[2] = 'Старт';
    // Use any available report start address
    startTop[3] = getStartAddress(byWeek.get('1') || byWeek.get('2') || byWeek.get('3') || byWeek.get('4') || null);
    aoa.push(startTop);

    // Build per-week maps: pointId -> cell
    type Cell = { order: number; visit: number; legKm: number; legDrive: number };
    const weekPointMap = new Map<WeekKey, Map<string, Cell>>();
    const weekReturnLeg = new Map<WeekKey, { km: number; drive: number }>();
    const weekTotals = new Map<WeekKey, { count: number; visit: number; km: number; drive: number }>();

    for (const wk of WEEK_KEYS) {
      const rep = byWeek.get(wk);
      if (!rep) continue;

      const mp = new Map<string, Cell>();
      for (let i = 0; i < rep.stops.length; i++) {
        const s = rep.stops[i];
        const leg = rep.legs[i];
        mp.set(s.pointId, {
          order: i + 1,
          visit: s.visitMinutes,
          legKm: leg ? round1(leg.distanceKm) : 0,
          legDrive: leg ? Math.round(leg.driveMinutes) : 0,
        });
      }
      weekPointMap.set(wk, mp);

      const lastLeg = rep.legs[rep.legs.length - 1];
      if (lastLeg) {
        weekReturnLeg.set(wk, { km: round1(lastLeg.distanceKm), drive: Math.round(lastLeg.driveMinutes) });
      }

      weekTotals.set(wk, {
        count: rep.stops.length,
        visit: Math.round(rep.serviceMinutes),
        km: round1(rep.driveKm),
        drive: Math.round(rep.driveMinutes),
      });
    }

    // union list of pointIds for the day
    const baseW: WeekKey | null = byWeek.has('1') ? '1' : (WEEK_KEYS.find((wk) => byWeek.has(wk)) || null);
    const union: string[] = [];
    const seen = new Set<string>();

    const pushStopIds = (wk: WeekKey) => {
      const rep = byWeek.get(wk);
      if (!rep) return;
      for (const s of rep.stops) {
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

    // point fields lookup
    const pointById = new Map<string, { clientCode: string; name: string; address: string }>();
    for (const wk of WEEK_KEYS) {
      const rep = byWeek.get(wk);
      if (!rep) continue;
      for (const s of rep.stops) {
        if (!pointById.has(s.pointId)) {
          const addr = (s as any)?.address || '';
          pointById.set(s.pointId, { clientCode: s.clientCode, name: s.name, address: addr });
        }
      }
    }

    for (const pid of union) {
      const info = pointById.get(pid);
      const row = new Array(COLS).fill('');
      row[0] = route;
      row[1] = info?.clientCode || '';
      row[2] = info?.name || '';
      row[3] = info?.address || '';

      for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
        const wk = WEEK_KEYS[wi];
        const base = 4 + wi * 4;
        const cell = weekPointMap.get(wk)?.get(pid);
        if (cell) {
          row[base] = cell.order;
          row[base + 1] = cell.visit;
          row[base + 2] = round1(cell.legKm);
          row[base + 3] = cell.legDrive;
        }
      }

      aoa.push(row);
    }

    // Start bottom (return)
    const startBottom = new Array(COLS).fill('');
    startBottom[2] = 'Старт (возврат)';
    startBottom[3] = getStartAddress(byWeek.get('1') || byWeek.get('2') || byWeek.get('3') || byWeek.get('4') || null);
    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const wk = WEEK_KEYS[wi];
      const base = 4 + wi * 4;
      const back = weekReturnLeg.get(wk);
      if (back) {
        startBottom[base + 2] = round1(back.km);
        startBottom[base + 3] = back.drive;
      }
    }
    aoa.push(startBottom);

    // Totals row
    const totalsRow = new Array(COLS).fill('');
    totalsRow[0] = `${route} Итог`;
    for (let wi = 0; wi < WEEK_KEYS.length; wi++) {
      const wk = WEEK_KEYS[wi];
      const base = 4 + wi * 4;
      const tot = weekTotals.get(wk);
      if (tot) {
        totalsRow[base] = tot.count;
        totalsRow[base + 1] = tot.visit;
        totalsRow[base + 2] = round1(tot.km);
        totalsRow[base + 3] = tot.drive;
      }
    }
    aoa.push(totalsRow);

    // spacer
    aoa.push(new Array(COLS).fill(''));
  }

  return { aoa, merges };
}

/**
 * Build an XLSX workbook for Section “road mileage” reports.
 * - One sheet per route
 * - Inside: blocks for days (ПН–ПТ)
 * - Columns: W1..W4 × (Order, Visit, Leg km, Leg drive)
 */
export function buildSectionRoadMileageWorkbook(reports: RoadMileageReport[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const byRoute = new Map<string, RoadMileageReport[]>();
  for (const r of reports) {
    const route = r.route || '—';
    if (!byRoute.has(route)) byRoute.set(route, []);
    byRoute.get(route)!.push(r);
  }

  const routes = Array.from(byRoute.keys()).sort();
  for (const route of routes) {
    const rr = byRoute.get(route)!;
    const { aoa, merges } = buildRouteSheetAOA({ route, reports: rr });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;

    ws['!cols'] = [
      { wch: 14 }, // Route
      { wch: 14 }, // Client code
      { wch: 30 }, // Name
      { wch: 46 }, // Address
      // 16 columns: weeks
      ...Array.from({ length: 16 }, () => ({ wch: 12 })),
    ];

    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(route));
  }

  return wb;
}
