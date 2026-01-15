import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { useAppContext } from '@/store/AppContext';
import { POINT_HEADERS, POLYGON_COLORS } from '@/constants';
import { uid, normalizeFreqCode, normalizeDayCode, downloadBlob, getCycleIndexByISOWeek } from '@/utils/helpers';
import { Point, User } from '@/types';

type AdminTab = 'users' | 'import-points' | 'import-polygons' | 'import-start' | 'calendar' | 'help';

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('import-points');
  const {
    data,
    updateUsers,
    addUser,
    deleteUser,
    addPointsFromFiles,
    deletePointsBySourceFile,
    deleteAllPoints,
    addPolygonsFromFiles,
    deletePolygonsBySourceFile,
    deleteAllPolygons,
    updateStartPoints,
    deleteAllStartPoints,
    routesFromPoints
  } = useAppContext();

  const [importMsg, setImportMsg] = useState('');
  const [polygonsMsg, setPolygonsMsg] = useState('');
  const [startMsg, setStartMsg] = useState('');
  const [polygonColorIndex, setPolygonColorIndex] = useState(0);
  const [calendarYear, setCalendarYear] = useState(2025);

  // Points import
  const handlePointsImport = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setImportMsg(`Загрузка ${files.length} файл(ов)...`);

    const importedAt = new Date().toISOString();
    const allPoints: Point[] = [];
    const fileMeta: { fileName: string; count: number; importedAt: string; kind?: 'excel' }[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[];

        let fileCount = 0;

        for (let i = 0; i < json.length; i++) {
          const row = json[i];
          const lonRaw = row['GPS долгота'] ?? row['Долгота'] ?? '';
          const latRaw = row['GPS широта'] ?? row['Широта'] ?? '';

          const vmRaw = row['Время на посещение'];
          const vm = Number(String(vmRaw ?? '').replace(',', '.'));

          const point: Point = {
            id: uid(),
            branch: String(row['Филиал'] ?? '').trim(),
            clientCode: String(row['Код клиента'] ?? row['Код'] ?? '').trim(),
            name: String(row['Название'] ?? '').trim(),
            address: String(row['Адрес'] ?? '').trim(),
            lon: Number(String(lonRaw).replace(',', '.')),
            lat: Number(String(latRaw).replace(',', '.')),
            channel: String(row['Канал'] ?? row['Канал продаж'] ?? '').trim(),
            frequencyCode: normalizeFreqCode(row['Частота']),
            visitMinutes: Number.isFinite(vm) && vm > 0 ? Math.round(vm) : 15,
            route: String(row['Маршрут'] ?? '').trim(),
            manager: String(row['Менеджер'] ?? '').trim(),
            leer: String(row['Леер'] ?? row['Лидер'] ?? '').trim(),
            visitDayCode: normalizeDayCode(row['День посещения'] ?? row['День']),
            sourceFile: file.name,
            visitOrderByWeek: {}
          };

          const rowNo = i + 2;
          if (!point.clientCode) errors.push(`${file.name}, строка ${rowNo}: "Код клиента" обязателен.`);
          if (!point.name) errors.push(`${file.name}, строка ${rowNo}: "Название" обязательно.`);
          if (!isFinite(point.lat) || !isFinite(point.lon)) errors.push(`${file.name}, строка ${rowNo}: координаты должны быть числом.`);

          // optional manual order columns
          const w1 = row['Порядок W1'];
          const w2 = row['Порядок W2'];
          const w3 = row['Порядок W3'];
          const w4 = row['Порядок W4'];
          const toNum = (v: unknown) => {
            const n = Number(String(v ?? '').replace(',', '.'));
            return Number.isFinite(n) ? n : null;
          };
          const n1 = toNum(w1); if (n1 != null) point.visitOrderByWeek!['1'] = n1;
          const n2 = toNum(w2); if (n2 != null) point.visitOrderByWeek!['2'] = n2;
          const n3 = toNum(w3); if (n3 != null) point.visitOrderByWeek!['3'] = n3;
          const n4 = toNum(w4); if (n4 != null) point.visitOrderByWeek!['4'] = n4;

          allPoints.push(point);
          fileCount++;
        }

        fileMeta.push({ fileName: file.name, count: fileCount, importedAt, kind: 'excel' });
      } catch (e) {
        console.error(e);
        errors.push(`Файл "${file.name}": ошибка чтения.`);
      }
    }

    if (allPoints.length > 0) {
      addPointsFromFiles(allPoints, fileMeta);
    }

    if (errors.length > 0) {
      setImportMsg(`Импорт завершён с предупреждениями. Файлов: ${files.length}. Загружено строк: ${allPoints.length}. Ошибок: ${errors.length}.`);
    } else {
      setImportMsg(`Импорт выполнен: файлов ${files.length}, загружено строк: ${allPoints.length}.`);
    }
  }, [addPointsFromFiles]);

  // Download template
  const downloadTemplate = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const sample = {
      'Филиал': 'Алматы',
      'Код клиента': 'A1001',
      'Название': 'Магазин "Ромашка"',
      'Адрес': 'Алматы, пр. Абая 10',
      'GPS долгота': 76.9279,
      'GPS широта': 43.2383,
      'Канал': 'Розница',
      'Частота': '4',
      'Время на посещение': 20,
      'Маршрут': 'R1',
      'Менеджер': 'Иванов И.И.',
      'Леер': 'Петров П.П.',
      'День посещения': '1'
    };
    const ws = XLSX.utils.json_to_sheet([{
      ...sample,
      'Порядок W1': '1',
      'Порядок W2': '',
      'Порядок W3': '',
      'Порядок W4': ''
    }], { header: POINT_HEADERS });
    XLSX.utils.book_append_sheet(wb, ws, 'Точки');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob('RouteMaster_Шаблон_Точки.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }, []);

  // Export points
  const exportPoints = useCallback(() => {
    const rows = data.points.map(p => ({
      'Филиал': p.branch || '',
      'Код клиента': p.clientCode || '',
      'Название': p.name || '',
      'Адрес': p.address || '',
      'GPS долгота': isFinite(p.lon) ? p.lon : '',
      'GPS широта': isFinite(p.lat) ? p.lat : '',
      'Канал': p.channel || '',
      'Частота': normalizeFreqCode(p.frequencyCode) || '',
      'Время на посещение': p.visitMinutes ?? '',
      'Маршрут': p.route || '',
      'Менеджер': p.manager || '',
      'Леер': p.leer || '',
      'День посещения': normalizeDayCode(p.visitDayCode) || '',
      'Порядок W1': p.visitOrderByWeek?.['1'] ?? '',
      'Порядок W2': p.visitOrderByWeek?.['2'] ?? '',
      'Порядок W3': p.visitOrderByWeek?.['3'] ?? '',
      'Порядок W4': p.visitOrderByWeek?.['4'] ?? ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows, { header: POINT_HEADERS });
    XLSX.utils.book_append_sheet(wb, ws, 'Точки');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob('RouteMaster_Точки_Экспорт.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }, [data.points]);

  // Polygons import (TXT)
  const handlePolygonsImportTxt = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPolygonsMsg(`Загрузка TXT: ${files.length} файл(ов)...`);

    const importedAt = new Date().toISOString();
    const dayMapping: Record<string, string> = {
      'ПН': '1', 'ПН.': '1', 'ПОНЕДЕЛЬНИК': '1',
      'ВТ': '2', 'ВТ.': '2', 'ВТОРНИК': '2',
      'СР': '3', 'СР.': '3', 'СРЕДА': '3',
      'ЧТ': '4', 'ЧТ.': '4', 'ЧЕТВЕРГ': '4',
      'ПТ': '5', 'ПТ.': '5', 'ПЯТНИЦА': '5',
      'СБ': '6', 'СБ.': '6', 'СУББОТА': '6',
      'ВС': '7', 'ВС.': '7', 'ВОСКРЕСЕНЬЕ': '7'
    };

    const allPolys: typeof data.polygons = [];
    const fileMeta: { fileName: string; count: number; importedAt: string; kind?: 'txt' | 'json'; color?: string }[] = [];
    let colorIdx = polygonColorIndex;

    for (const file of Array.from(files)) {
      const fileColor = POLYGON_COLORS[colorIdx % POLYGON_COLORS.length];
      colorIdx++;

      const before = allPolys.length;

      try {
        const text = await file.text();
        const lines = text.split(/\r?\n/);

        let currentPoly: typeof data.polygons[0] | null = null;
        let expectingDays = false;

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed) {
            if (currentPoly && currentPoly.coords.length >= 3) {
              allPolys.push(currentPoly);
            }
            currentPoly = null;
            expectingDays = false;
            continue;
          }

          const coordMatch = trimmed.match(/^(-?\d+[.,]?\d*)\s*[,;\t]\s*(-?\d+[.,]?\d*)$/);

          if (coordMatch) {
            const lat = parseFloat(coordMatch[1].replace(',', '.'));
            const lon = parseFloat(coordMatch[2].replace(',', '.'));

            if (isFinite(lat) && isFinite(lon)) {
              if (!currentPoly) {
                currentPoly = {
                  id: uid(),
                  name: `Зона ${allPolys.length + 1}`,
                  color: fileColor,
                  days: ['1', '2', '3', '4', '5'],
                  coords: [],
                  sourceFile: file.name
                };
              }
              currentPoly.coords.push([lat, lon]);
              expectingDays = false;
            }
          } else {
            const parts = trimmed.toUpperCase().split(/[\s,;]+/).filter(Boolean);
            const days = parts.map(p => dayMapping[p]).filter(Boolean);

            if (days.length > 0 && currentPoly && expectingDays) {
              currentPoly.days = days;
              expectingDays = false;
            } else {
              if (currentPoly && currentPoly.coords.length >= 3) {
                allPolys.push(currentPoly);
              }
              currentPoly = {
                id: uid(),
                name: trimmed,
                color: fileColor,
                days: ['1', '2', '3', '4', '5'],
                coords: [],
                sourceFile: file.name
              };
              expectingDays = true;
            }
          }
        }

        if (currentPoly && currentPoly.coords.length >= 3) {
          allPolys.push(currentPoly);
        }
      } catch (e) {
        console.error(e);
      }

      const added = allPolys.length - before;
      fileMeta.push({ fileName: file.name, count: Math.max(0, added), importedAt, kind: 'txt', color: fileColor });
    }

    setPolygonColorIndex(colorIdx);

    if (allPolys.length > 0) {
      addPolygonsFromFiles(allPolys, fileMeta);
      setPolygonsMsg(`Импортировано полигонов (TXT): ${allPolys.length}`);
    } else {
      setPolygonsMsg('TXT: Не найдено полигонов с минимум 3 точками.');
    }
  }, [addPolygonsFromFiles, polygonColorIndex]);

  // Polygons import (JSON API format) — supports multiple files
  const handlePolygonsImportJson = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPolygonsMsg(`Загрузка JSON: ${files.length} файл(ов)...`);

    const importedAt = new Date().toISOString();
    const allPolys: typeof data.polygons = [];
    const fileMeta: { fileName: string; count: number; importedAt: string; kind?: 'txt' | 'json'; color?: string }[] = [];
    let colorIdx = polygonColorIndex;

    const toDayCode = (idx: number) => String(idx + 1); // 0..6 -> 1..7

    const extractRings = (geometry: any): [number, number][][] => {
      if (!geometry || !geometry.type || !geometry.coordinates) return [];
      if (geometry.type === 'Polygon') {
        // coordinates: [ [ [lon,lat], ... ] , ...holes]
        const outer = geometry.coordinates?.[0];
        if (!Array.isArray(outer)) return [];
        return [outer.map((c: any) => [Number(c[1]), Number(c[0])] as [number, number])];
      }
      if (geometry.type === 'MultiPolygon') {
        // coordinates: [ [ [ [lon,lat], ... ] ] , ...]
        const polys = geometry.coordinates;
        if (!Array.isArray(polys)) return [];
        const rings: [number, number][][] = [];
        for (const poly of polys) {
          const outer = poly?.[0];
          if (!Array.isArray(outer)) continue;
          rings.push(outer.map((c: any) => [Number(c[1]), Number(c[0])] as [number, number]));
        }
        return rings;
      }
      return [];
    };

    const parseItemToPolygons = (item: any, fileName: string, fileColor: string) => {
      const nameBase = item?.geo?.name || item?.name || `Зона`;

      const deliveryDaysRaw = Array.isArray(item?.delivery_order?.days) ? item.delivery_order.days : [];
      const takeDaysRaw = Array.isArray(item?.take_order?.days) ? item.take_order.days : [];

      const deliveryDays = deliveryDaysRaw
        .map((d: any, i: number) => ({
          dayCode: toDayCode(i),
          enabled: !!d?.enabled,
          from: typeof d?.from_time === 'string' ? d.from_time : undefined,
          till: typeof d?.till_time === 'string' ? d.till_time : undefined
        }))
        .filter((d: any) => d.enabled)
        .map((d: any) => ({ dayCode: d.dayCode, from: d.from, till: d.till }));

      const takeOrderDays = takeDaysRaw
        .map((d: any, i: number) => ({
          dayCode: toDayCode(i),
          enabled: !!d?.enabled,
          from: typeof d?.from_time === 'string' ? d.from_time : undefined,
          till: typeof d?.till_time === 'string' ? d.till_time : undefined
        }))
        .filter((d: any) => d.enabled)
        .map((d: any) => ({ dayCode: d.dayCode, from: d.from, till: d.till }));

      const days = deliveryDays.length > 0 ? deliveryDays.map((d: { dayCode: string }) => d.dayCode) : (Array.isArray(item?.delivery_order?.days) ? ['1','2','3','4','5'] : ['1','2','3','4','5']);
      const deliveryDaysOffset = typeof item?.delivery_order?.delivery_days_offset === 'number' ? item.delivery_order.delivery_days_offset : undefined;

      const features = item?.geo?.shape?.features;
      const featureArr = Array.isArray(features) ? features : [];
      let ringIndex = 0;

      for (const f of featureArr) {
        const rings = extractRings(f?.geometry);
        for (const ring of rings) {
          const coords = ring.filter(c => isFinite(c[0]) && isFinite(c[1]));
          if (coords.length < 3) continue;

          const name = ringIndex === 0 ? nameBase : `${nameBase} (${ringIndex + 1})`;
          ringIndex++;

          allPolys.push({
            id: uid(),
            name,
            color: fileColor,
            days,
            coords,
            sourceFile: fileName,
            deliveryDaysOffset,
            deliveryDays,
            takeOrderDays
          });
        }
      }

      // Fallback: some APIs might provide geometry directly
      if (ringIndex === 0 && item?.geo?.shape?.geometry) {
        const rings = extractRings(item.geo.shape.geometry);
        for (const ring of rings) {
          const coords = ring.filter(c => isFinite(c[0]) && isFinite(c[1]));
          if (coords.length < 3) continue;
          allPolys.push({
            id: uid(),
            name: nameBase,
            color: fileColor,
            days,
            coords,
            sourceFile: fileName,
            deliveryDaysOffset,
            deliveryDays,
            takeOrderDays
          });
        }
      }
    };

    const errors: string[] = [];

    for (const file of Array.from(files)) {
      const fileColor = POLYGON_COLORS[colorIdx % POLYGON_COLORS.length];
      colorIdx++;
      const before = allPolys.length;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          parseItemToPolygons(item, file.name, fileColor);
        }
      } catch (e) {
        console.error(e);
        errors.push(`${file.name}: ошибка чтения/парсинга JSON`);
      }
      const added = allPolys.length - before;
      fileMeta.push({ fileName: file.name, count: Math.max(0, added), importedAt, kind: 'json', color: fileColor });
    }

    setPolygonColorIndex(colorIdx);

    if (allPolys.length > 0) {
      addPolygonsFromFiles(allPolys, fileMeta);
      setPolygonsMsg(`Импортировано полигонов (JSON): ${allPolys.length}${errors.length ? ` • Ошибок: ${errors.length}` : ''}`);
    } else {
      setPolygonsMsg(errors.length ? `JSON: Ошибки (${errors.length}). Полигоны не импортированы.` : 'JSON: валидных полигонов не найдено.');
    }
  }, [addPolygonsFromFiles, polygonColorIndex]);

  // Start points import
  const handleStartImport = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    setStartMsg('Загрузка файла...');

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, unknown>[];

      const arr = json.map(row => ({
        id: uid(),
        route: String(row['Маршрут'] ?? '').trim(),
        address: String(row['Адрес старта'] ?? '').trim(),
        lat: Number(String(row['GPS широта'] ?? '').replace(',', '.')),
        lon: Number(String(row['GPS долгота'] ?? '').replace(',', '.'))
      }));

      updateStartPoints(arr);
      setStartMsg(`Импортировано стартов: ${arr.length}`);
    } catch (e) {
      console.error(e);
      setStartMsg('Ошибка импорта стартовых точек.');
    }
  }, [updateStartPoints]);

  // Start template
  const downloadStartTemplate = useCallback(() => {
    const wb = XLSX.utils.book_new();
    const rows = [{ 'Маршрут': 'R1', 'Адрес старта': 'Склад R1', 'GPS широта': 43.245, 'GPS долгота': 76.91 }];
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Старт');
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob('RouteMaster_Шаблон_Старт.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }, []);

  // Users management
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const routes = routesFromPoints();

  const handleSaveUser = useCallback((user: User) => {
    if (data.users.find(u => u.id === user.id)) {
      updateUsers(data.users.map(u => u.id === user.id ? user : u));
    } else {
      addUser(user);
    }
    setEditingUser(null);
  }, [data.users, updateUsers, addUser]);

  // ISO week number + ISO week-year
  const getISOWeekInfo = (date: Date): { week: number; isoYear: number } => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const isoYear = d.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { week, isoYear };
  };

  const getISOWeeksInYear = (year: number): number => {
    // 28 Dec is always in the last ISO week of its year
    return getISOWeekInfo(new Date(Date.UTC(year, 11, 28))).week;
  };

  const cycleBgClass = (cycleIndex: number): string => {
    switch (cycleIndex) {
      case 1:
        return 'bg-emerald-100 dark:bg-emerald-900/40';
      case 2:
        return 'bg-violet-100 dark:bg-violet-900/40';
      case 3:
        return 'bg-rose-100 dark:bg-rose-900/40';
      case 4:
      default:
        return 'bg-cyan-100 dark:bg-cyan-900/40';
    }
  };

  // Week calendar
  const renderCalendar = () => {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const dayNames = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[calc(100vh-380px)] overflow-auto">
        {months.map((monthName, month) => {
          const firstDay = new Date(calendarYear, month, 1);
          const lastDay = new Date(calendarYear, month + 1, 0);
          let startDayOfWeek = firstDay.getDay() - 1;
          if (startDayOfWeek < 0) startDayOfWeek = 6;
          let currentDay = 1;
          const totalDays = lastDay.getDate();
          const weeks: React.ReactNode[] = [];

          while (currentDay <= totalDays) {
            const weekDate = new Date(calendarYear, month, currentDay);
            const { week: isoWeek, isoYear } = getISOWeekInfo(weekDate);
            const isOddWeek = isoWeek % 2 === 1;

            // 4-week cycle used in the app: 1.1..1.4
            const cycleIndex = getCycleIndexByISOWeek(isoWeek);
            const weekBg = cycleBgClass(cycleIndex);

            const isOtherIsoYear = isoYear !== calendarYear;
            const dimClass = isOtherIsoYear ? 'opacity-40' : '';

            const dayCells = [];
            for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
              if (currentDay === 1 && dayOfWeek < startDayOfWeek) {
                dayCells.push(<td key={dayOfWeek} className="py-1 px-0.5 text-center" />);
              } else if (currentDay > totalDays) {
                dayCells.push(<td key={dayOfWeek} className="py-1 px-0.5 text-center" />);
              } else {
                const dayDate = new Date(calendarYear, month, currentDay);
                const isToday = dayDate.toDateString() === new Date().toDateString();
                const isWeekend = dayOfWeek >= 5;
                dayCells.push(
                  <td
                    key={dayOfWeek}
                    className={`py-1 px-0.5 text-center ${isToday ? 'bg-sky-500 text-white rounded-full font-bold' : isWeekend ? 'text-rose-500 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}
                  >
                    {currentDay}
                  </td>
                );
                currentDay++;
              }
            }

            if (startDayOfWeek > 0) startDayOfWeek = 0;

            weeks.push(
              <tr key={weeks.length}>
                <td className={`py-1 px-1 text-center font-bold rounded ${weekBg} ${isOddWeek ? 'border-l-2 border-sky-400' : 'border-l-2 border-amber-400'} ${dimClass}`}>
                  {isoWeek}
                </td>
                {dayCells}
              </tr>
            );
          }

          return (
            <div key={month} className="bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl p-3">
              <div className="text-center font-semibold text-sm mb-2 pb-2 border-b border-slate-200 dark:border-white/10 text-slate-900 dark:text-white">
                {monthName} {calendarYear}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 dark:text-slate-400">
                    <th className="py-1 px-0.5 text-center font-medium">Нед</th>
                    {dayNames.map(d => <th key={d} className="py-1 px-0.5 text-center font-medium">{d}</th>)}
                  </tr>
                </thead>
                <tbody>{weeks}</tbody>
              </table>
            </div>
          );
        })}
      </div>
    );
  };

  const tabs: { id: AdminTab; title: string }[] = [
    { id: 'users', title: '👥 Пользователи' },
    { id: 'import-points', title: '📍 Импорт точек' },
    { id: 'import-polygons', title: '🗺️ Импорт полигонов' },
    { id: 'import-start', title: '🏁 Точки старта' },
    { id: 'calendar', title: '📅 Календарь недель' },
    { id: 'help', title: '📖 Информация' }
  ];

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">Админ. панель</div>
            <div className="text-sm text-slate-600 dark:text-slate-300/70">Импорт/управление данными</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-4 border-b border-slate-200 dark:border-white/10 flex flex-wrap gap-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 text-sm rounded-t-xl border border-b-0 ${
                activeTab === t.id
                  ? 'bg-white dark:bg-white/10 border-slate-200 dark:border-white/10'
                  : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10'
              } text-slate-700 dark:text-slate-300`}
            >
              {t.title}
            </button>
          ))}
        </div>

        {/* Users tab */}
        {activeTab === 'users' && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-slate-900 dark:text-white">Пользователи</div>
              <button
                onClick={() => setEditingUser({ id: uid(), fullName: '', login: '', password: '', role: 'User', route: '' })}
                className="rounded-xl px-3 py-2 text-sm text-white bg-[#2196F3]"
              >
                + Создать
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs text-slate-500 dark:text-slate-300/60">
                    <th className="px-3 py-2">ФИО</th>
                    <th className="px-3 py-2">Логин</th>
                    <th className="px-3 py-2">Роль</th>
                    <th className="px-3 py-2">Маршрут</th>
                    <th className="px-3 py-2 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map(u => (
                    <tr key={u.id} className="border-b border-slate-200 dark:border-white/10">
                      <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-300">{u.fullName}</td>
                      <td className="px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300">{u.login}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-300">{u.role}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-300">{u.route}</td>
                      <td className="px-3 py-2 text-sm text-right">
                        <button
                          onClick={() => setEditingUser(u)}
                          className="px-2 py-1 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300"
                        >
                          Редактировать
                        </button>
                        {u.login !== 'admin' && (
                          <button
                            onClick={() => {
                              if (confirm('Удалить пользователя?')) {
                                deleteUser(u.id);
                              }
                            }}
                            className="ml-2 px-2 py-1 rounded-lg border border-rose-200 text-rose-700 dark:border-rose-400/30 dark:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-400/10"
                          >
                            Удалить
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Edit user modal */}
            {editingUser && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 w-full max-w-md">
                  <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-white">
                    {data.users.find(u => u.id === editingUser.id) ? 'Редактировать' : 'Создать'} пользователя
                  </h3>
                  <div className="space-y-3">
                    <input
                      value={editingUser.fullName}
                      onChange={e => setEditingUser({ ...editingUser, fullName: e.target.value })}
                      placeholder="ФИО"
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white"
                    />
                    <input
                      value={editingUser.login}
                      onChange={e => setEditingUser({ ...editingUser, login: e.target.value })}
                      placeholder="Логин"
                      disabled={!!data.users.find(u => u.id === editingUser.id)}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white disabled:opacity-50"
                    />
                    <input
                      value={editingUser.password}
                      onChange={e => setEditingUser({ ...editingUser, password: e.target.value })}
                      placeholder="Пароль"
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white"
                    />
                    <select
                      value={editingUser.role}
                      onChange={e => setEditingUser({ ...editingUser, role: e.target.value as 'Admin' | 'User' })}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white"
                    >
                      <option value="Admin">Admin</option>
                      <option value="User">User</option>
                    </select>
                    <select
                      value={editingUser.route}
                      onChange={e => setEditingUser({ ...editingUser, route: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-slate-900 dark:text-white"
                    >
                      <option value="">(не назначен)</option>
                      {routes.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setEditingUser(null)}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={() => handleSaveUser(editingUser)}
                      className="flex-1 px-3 py-2 rounded-xl bg-[#2196F3] text-white"
                    >
                      Сохранить
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Import points tab */}
        {activeTab === 'import-points' && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={downloadTemplate} className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300">
                📥 Скачать шаблон
              </button>
              <button onClick={exportPoints} className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300">
                📤 Экспорт
              </button>
              <label className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-slate-700 dark:text-slate-300">
                📄 Импорт Excel (можно несколько)
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  className="hidden"
                  onChange={e => {
                    handlePointsImport(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <button
                onClick={() => {
                  if (data.points.length === 0) {
                    setImportMsg('Нет точек для удаления.');
                    return;
                  }
                  if (confirm(`Удалить все ${data.points.length} точек?`)) {
                    deleteAllPoints();
                    setImportMsg('Точки удалены.');
                  }
                }}
                className="rounded-xl px-3 py-2 text-sm border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
              >
                🗑️ Очистить
              </button>
            </div>

            {importMsg && <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">{importMsg}</div>}

            <div className="mt-3 p-4 bg-slate-50 dark:bg-white/5 rounded-xl">
              <div className="text-lg font-semibold mb-3 text-slate-900 dark:text-white">📊 Всего загружено: {data.points.length} точек</div>

              <div className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Загруженные файлы:</div>
              {(data.importMeta?.pointsFiles?.length || 0) === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">Файлы не загружены</div>
              ) : (
                <div className="space-y-2">
                  {(data.importMeta?.pointsFiles || []).map(f => (
                    <div key={f.fileName} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate" title={f.fileName}>📄 {f.fileName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">Импорт: {new Date(f.importedAt).toLocaleString('ru-RU')}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-xs font-semibold text-sky-600">{f.count} строк</div>
                        <button
                          onClick={() => {
                            if (!confirm(`Удалить данные, загруженные из файла “${f.fileName}”?`)) return;
                            deletePointsBySourceFile(f.fileName);
                          }}
                          className="text-xs px-2 py-1 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
                        >
                          🗑️ Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Данные кэшируются в браузере (localStorage). После перезагрузки страницы импортированные файлы и их точки остаются.
              </div>
            </div>
          </div>
        )}

        {/* Import polygons tab */}
        {activeTab === 'import-polygons' && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <label className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-slate-700 dark:text-slate-300">
                📄 Импорт TXT (можно несколько)
                <input
                  type="file"
                  accept=".txt,text/plain"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handlePolygonsImportTxt(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <label className="rounded-xl px-3 py-2 text-sm border border-sky-200 dark:border-sky-400/30 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/30 cursor-pointer">
                📦 Импорт JSON (API формат, можно несколько)
                <input
                  type="file"
                  accept=".json,application/json"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handlePolygonsImportJson(e.target.files);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <button
                onClick={() => {
                  if (data.polygons.length === 0) {
                    setPolygonsMsg('Нет полигонов для удаления.');
                    return;
                  }
                  if (confirm(`Удалить все ${data.polygons.length} полигонов?`)) {
                    deleteAllPolygons();
                    setPolygonsMsg('Полигоны удалены.');
                  }
                }}
                className="rounded-xl px-3 py-2 text-sm border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
              >
                🗑️ Очистить
              </button>
            </div>

            {polygonsMsg && <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">{polygonsMsg}</div>}

            <div className="mt-3 p-4 bg-slate-50 dark:bg-white/5 rounded-xl">
              <div className="text-lg font-semibold mb-3 text-slate-900 dark:text-white">🗺️ Загружено полигонов: {data.polygons.length}</div>

              <div className="text-sm font-semibold mb-2 text-slate-900 dark:text-white">Загруженные файлы:</div>
              {(data.importMeta?.polygonFiles?.length || 0) === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">Файлы не загружены</div>
              ) : (
                <div className="space-y-2">
                  {(data.importMeta?.polygonFiles || []).map(f => (
                    <div key={f.fileName} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-white dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="inline-block w-3 h-3 rounded" style={{ background: f.color || '#94a3b8', opacity: 0.8 }} />
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate" title={f.fileName}>📄 {f.fileName}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{f.kind?.toUpperCase() || 'FILE'} • {new Date(f.importedAt).toLocaleString('ru-RU')}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-xs font-semibold text-sky-600">{f.count} зон</div>
                        <button
                          onClick={() => {
                            if (!confirm(`Удалить полигоны, загруженные из файла “${f.fileName}”?`)) return;
                            deletePolygonsBySourceFile(f.fileName);
                          }}
                          className="text-xs px-2 py-1 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
                        >
                          🗑️ Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Данные кэшируются в браузере (localStorage). После перезагрузки страницы импортированные файлы и их полигоны остаются.
              </div>
            </div>

            <div className="mt-3 text-xs text-slate-600 dark:text-slate-400">
              JSON (API): поддерживаются массивы объектов с <code className="font-mono">geo.name</code>, <code className="font-mono">geo.shape.features[0].geometry</code>, <code className="font-mono">delivery_order.days</code>, <code className="font-mono">take_order.days</code>.
            </div>
          </div>
        )}

        {/* Import start tab */}
        {activeTab === 'import-start' && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={downloadStartTemplate} className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300">
                📥 Шаблон стартов
              </button>
              <label className="rounded-xl px-3 py-2 text-sm border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer text-slate-700 dark:text-slate-300">
                📄 Импорт Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={e => handleStartImport(e.target.files)}
                />
              </label>
              <button
                onClick={() => {
                  if (data.startPoints.length === 0) {
                    setStartMsg('Нет точек старта для удаления.');
                    return;
                  }
                  if (confirm(`Удалить все ${data.startPoints.length} точек старта?`)) {
                    deleteAllStartPoints();
                    setStartMsg('Точки старта удалены.');
                  }
                }}
                className="rounded-xl px-3 py-2 text-sm border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
              >
                🗑️ Очистить
              </button>
            </div>
            {startMsg && <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">{startMsg}</div>}
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[500px]">
                <thead>
                  <tr className="text-left text-xs text-slate-500 dark:text-slate-300/60">
                    <th className="px-3 py-2">Маршрут</th>
                    <th className="px-3 py-2">Адрес старта</th>
                    <th className="px-3 py-2">GPS широта</th>
                    <th className="px-3 py-2">GPS долгота</th>
                  </tr>
                </thead>
                <tbody>
                  {data.startPoints.map(s => (
                    <tr key={s.id} className="border-b border-slate-200 dark:border-white/10">
                      <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-300">{s.route}</td>
                      <td className="px-3 py-2 text-sm text-slate-700 dark:text-slate-300">{s.address}</td>
                      <td className="px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300">{s.lat}</td>
                      <td className="px-3 py-2 text-sm font-mono text-slate-700 dark:text-slate-300">{s.lon}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Calendar tab */}
        {activeTab === 'calendar' && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Год:</label>
              <select
                value={calendarYear}
                onChange={e => setCalendarYear(Number(e.target.value))}
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                {Array.from({ length: 8 }, (_, i) => 2023 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <div className="text-xs text-slate-500 dark:text-slate-400">Номера недель по ISO 8601</div>
            </div>

            {/* Legend */}
            <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Легенда: чётность недели (цветная полоса слева)</div>
                <div className="flex flex-wrap gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-white/70 dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                    <span className="inline-block w-3 h-3 rounded-sm border-l-4 border-sky-400" /> Нечётная ISO-неделя
                  </span>
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-white/70 dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                    <span className="inline-block w-3 h-3 rounded-sm border-l-4 border-amber-400" /> Чётная ISO-неделя
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Полоса соответствует <b>чётности номера ISO-недели</b> (1,3,5… — нечётные; 2,4,6… — чётные).
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white mb-2">Легенда: 4-недельный цикл (цвет фона)</div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-white/70 dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                    <span className="inline-block w-3 h-3 rounded bg-emerald-200 dark:bg-emerald-900/40 border border-emerald-200/60 dark:border-emerald-700/30" /> 1.1 (W1)
                  </span>
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-white/70 dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                    <span className="inline-block w-3 h-3 rounded bg-violet-200 dark:bg-violet-900/40 border border-violet-200/60 dark:border-violet-700/30" /> 1.2 (W2)
                  </span>
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-white/70 dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                    <span className="inline-block w-3 h-3 rounded bg-rose-200 dark:bg-rose-900/40 border border-rose-200/60 dark:border-rose-700/30" /> 1.3 (W3)
                  </span>
                  <span className="inline-flex items-center gap-2 px-2 py-1 rounded bg-white/70 dark:bg-white/10 border border-slate-200/60 dark:border-white/10">
                    <span className="inline-block w-3 h-3 rounded bg-cyan-200 dark:bg-cyan-900/40 border border-cyan-200/60 dark:border-cyan-700/30" /> 1.4 (W4)
                  </span>
                </div>
                <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Фон соответствует <b>номеру недели в 4-недельном цикле</b>, который используется в кодах частоты <code className="font-mono">1,1..1,4</code>.
                </div>
              </div>

              <div className="lg:col-span-2 text-[11px] text-slate-500 dark:text-slate-400">
                Примечание: часть дней января может относиться к ISO-неделе предыдущего года, а конец декабря — к ISO-неделе следующего года.
                Такие номера недель отображаются в календаре, но приглушены.
              </div>
            </div>

            {/* All ISO weeks panel */}
            <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">Все ISO-недели {calendarYear} (1–{getISOWeeksInYear(calendarYear)})</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">цвет фона = 4-недельный цикл, полоса = чётность</div>
              </div>
              <div className="flex flex-wrap gap-1 max-h-28 overflow-auto">
                {Array.from({ length: getISOWeeksInYear(calendarYear) }, (_, i) => i + 1).map((w) => {
                  const isOdd = w % 2 === 1;
                  const ci = getCycleIndexByISOWeek(w);
                  const bg = cycleBgClass(ci);
                  return (
                    <div
                      key={w}
                      title={`Неделя ${w} • ${isOdd ? 'нечётная' : 'чётная'} • цикл 1.${ci}`}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold ${bg} ${isOdd ? 'border-l-2 border-sky-400' : 'border-l-2 border-amber-400'} text-slate-800 dark:text-slate-100`}
                    >
                      {w}
                      <span className="ml-1 text-[10px] opacity-70">[{`1.${ci}`}]</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {renderCalendar()}
          </div>
        )}

        {/* Help tab */}
        {activeTab === 'help' && (
          <div className="mt-4">
            <div className="space-y-6 max-h-[calc(100vh-280px)] overflow-y-auto pr-2">
              {/* Intro */}
              <div className="rounded-xl p-4 border border-sky-200 dark:border-sky-800/30 bg-gradient-to-r from-sky-50 to-indigo-50 dark:from-sky-900/20 dark:to-indigo-900/20">
                <div className="text-lg font-bold text-sky-700 dark:text-sky-300">📖 Инструкция по Route Master</div>
                <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                  <b>Route Master</b> — приложение для управления торговыми точками, маршрутами (ТП), днями посещений и цикличностью.
                  Все данные хранятся локально в браузере (кэшируются) и доступны после перезагрузки.
                </div>
              </div>

              {/* Caching */}
              <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4">
                <div className="font-semibold text-base mb-2">💾 Кэширование данных</div>
                <div className="text-sm text-slate-700 dark:text-slate-300 space-y-2">
                  <p>
                    Приложение сохраняет данные в <b>localStorage</b> (память браузера). Поэтому импортированные точки/полигоны/старты
                    не нужно загружать заново после обновления страницы.
                  </p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li><b>Экспорт/импорт</b> доступен на вкладке <b>Бэкап</b> (только Admin).</li>
                    <li>Если очистить данные сайта/браузера — кэш будет удалён.</li>
                  </ul>
                </div>
              </div>

              {/* Imports */}
              <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4">
                <div className="font-semibold text-base mb-3">📥 Импорты (Админ. панель)</div>
                <div className="text-sm text-slate-700 dark:text-slate-300 space-y-3">
                  <div>
                    <div className="font-semibold">1) Импорт точек (Excel)</div>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Можно загрузить <b>несколько Excel-файлов</b> одновременно.</li>
                      <li>После импорта файлы отображаются списком: <b>имя файла + количество строк</b>, можно удалить каждый файл отдельно.</li>
                      <li>Обновление/добавление выполняется по <b>Коду клиента</b> (clientCode).</li>
                      <li>Колонки: Филиал, Код клиента, Название, Адрес, GPS долгота, GPS широта, Канал, Частота, Время, Маршрут, Менеджер, Леер, День посещения, Порядок W1–W4.</li>
                    </ul>
                  </div>

                  <div>
                    <div className="font-semibold">2) Импорт полигонов (TXT / JSON API)</div>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Поддерживается загрузка <b>нескольких файлов</b> TXT и JSON.</li>
                      <li>Каждый файл получает свой цвет (для удобства визуального разделения зон).</li>
                      <li>Для JSON (API) подтягиваются <b>дни доставки</b> и <b>окна времени</b>; при клике по полигону показывается всплывающая информация.</li>
                      <li>Можно удалить полигоны <b>по файлу</b> (удаляются все зоны из этого файла).</li>
                    </ul>
                  </div>

                  <div>
                    <div className="font-semibold">3) Точки старта (Excel)</div>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Колонки: Маршрут, Адрес старта, GPS широта, GPS долгота.</li>
                      <li>На карте отображаются <b>флажками</b> и показываются только для маршрутов, чьи точки сейчас видимы.</li>
                      <li>Нужны для расчёта пробега в режиме «Секции».</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Territory mode */}
              <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4">
                <div className="font-semibold text-base mb-3">🗺️ Режим «Территории» (зоны ответственности)</div>
                <div className="text-sm text-slate-700 dark:text-slate-300 space-y-3">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Доступен <b>множественный выбор</b> филиалов и маршрутов.</li>
                    <li>Зоны (полигоны) помогают визуально разделять территорию ответственности и дни доставки.</li>
                    <li>Выделяйте точки через чекбоксы в списке или инструментами на карте (лассо/прямоугольник).</li>
                  </ul>

                  <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-lg">
                    <div className="font-semibold mb-1">Массовое редактирование (кнопка «Изменить»)</div>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>В Территориях можно массово назначить: <b>маршрут</b>, <b>день посещения</b>, <b>цикличность</b>.</li>
                      <li>Изменения сохраняются и попадают в <b>Экспорт точек</b>.</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Section mode */}
              <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4">
                <div className="font-semibold text-base mb-3">🧩 Режим «Секции» (работа с одним маршрутом/ТП)</div>
                <div className="text-sm text-slate-700 dark:text-slate-300 space-y-3">
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Выбирается <b>один маршрут</b> (ТП).</li>
                    <li>Точки окрашиваются по дням недели.</li>
                    <li>Доступен расчёт пробега (если есть точка старта).</li>
                  </ul>

                  <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-lg">
                    <div className="font-semibold mb-1">Перенос на другой день / цикличность</div>
                    <ul className="list-disc pl-5 space-y-1">
                      <li>Выделите точки (чекбоксами или на карте) → нажмите <b>Изменить</b>.</li>
                      <li>В Секции можно менять только: <b>День посещения</b> и <b>Цикличность (частоту)</b>.</li>
                      <li>Правило: <b>Частота = 0</b> допускается только при днях <b>СБ/ВС</b>.</li>
                      <li>Все изменения сохраняются и доступны в <b>Экспорте</b>.</li>
                    </ul>
                  </div>

                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                    <div className="font-semibold mb-1">Подсказка по частотам (цикличности)</div>
                    <div className="text-xs text-slate-700 dark:text-slate-200">
                      <div><b>4</b> — еженедельно</div>
                      <div><b>2,1</b> — каждая нечётная ISO-неделя, <b>2,2</b> — каждая чётная</div>
                      <div><b>1,1..1,4</b> — 1–4 неделя в четырёхнедельном цикле</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Shortcuts */}
              <div className="border border-slate-200 dark:border-white/10 rounded-xl p-4">
                <div className="font-semibold text-base mb-2">⌨️ Горячие клавиши</div>
                <div className="text-sm text-slate-700 dark:text-slate-300">
                  <ul className="list-disc pl-5 space-y-1">
                    <li><b>Ctrl+F</b> — фокус на поиск (на странице Карта)</li>
                    <li><b>Escape</b> — закрыть модальное окно / отменить инструмент выделения</li>
                    <li><b>Shift+клик</b> — множественный выбор в фильтрах (в режиме Секции)</li>
                  </ul>
                </div>
              </div>

              <div className="text-center text-xs text-slate-400 dark:text-slate-500 py-2">
                Route Master • Документация внутри приложения (без PDF)
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
