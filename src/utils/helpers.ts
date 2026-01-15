import { FREQ_CODE_TO_LABEL, FREQ_LEGACY_TO_CANON, DAY_CODE_TO_LABEL, DAY_LABEL_TO_CODE } from '@/constants';

export function uid(): string {
  return Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function normalizeFreqCode(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  let str = typeof raw === 'number' ? String(raw) : String(raw).trim();
  if (!str) return '';
  str = str.replace(/\s+/g, '');
  
  if (FREQ_LEGACY_TO_CANON[str]) return FREQ_LEGACY_TO_CANON[str];
  
  if (str.includes('.')) {
    const c = str.replace('.', ',');
    if (FREQ_CODE_TO_LABEL[c]) return c;
    if (FREQ_LEGACY_TO_CANON[c]) return FREQ_LEGACY_TO_CANON[c];
    return c;
  }
  
  return str;
}

export function getFreqLabelFromCode(code: string): string {
  if (!code) return '';
  const canon = normalizeFreqCode(code);
  return FREQ_CODE_TO_LABEL[canon] || String(code);
}

export function normalizeDayCode(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  let str = typeof raw === 'number' ? String(Math.trunc(raw)) : String(raw).trim();
  if (!str) return '';
  if (DAY_CODE_TO_LABEL[str]) return str;
  const up = str.toUpperCase();
  if (DAY_LABEL_TO_CODE[up]) return DAY_LABEL_TO_CODE[up];
  return '';
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

export function getCycleIndexByISOWeek(targetISOWeek: number): number {
  let w = targetISOWeek;
  while (w > 52) w -= 52;
  while (w <= 0) w += 52;
  return ((w - 1) % 4) + 1;
}

export function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstDayOfWeek = firstDay.getDay() || 7;
  const dayOfMonth = date.getDate();
  return Math.ceil((dayOfMonth + firstDayOfWeek - 1) / 7);
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function roadDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineDistance(lat1, lon1, lat2, lon2) * 1.3;
}

export function pointMatchesCycleWeek(frequencyCode: string, targetISOWeek: number): boolean {
  const freqCode = normalizeFreqCode(frequencyCode);
  if (!freqCode) return true;
  
  const isOddWeek = targetISOWeek % 2 === 1;
  const cycleIndex = getCycleIndexByISOWeek(targetISOWeek);
  
  switch (freqCode) {
    case '0': return false;
    case '4': return true;
    case '2,1': return isOddWeek;
    case '2,2': return !isOddWeek;
    case '1,1': return cycleIndex === 1;
    case '1,2': return cycleIndex === 2;
    case '1,3': return cycleIndex === 3;
    case '1,4': return cycleIndex === 4;
    default: return true;
  }
}

export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  const x = point[0], y = point[1];
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
