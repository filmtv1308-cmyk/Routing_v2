import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import * as XLSX from 'xlsx';
import { useAppContext } from '@/store/AppContext';
import { normalizeDayCode, downloadBlob } from '@/utils/helpers';
import { buildTerritoryRouteReportWorkbook } from '@/utils/territoryXlsx';
import { buildSectionRoadMileageWorkbook } from '@/utils/roadMileageSectionXlsx';
import { RoadMileageReport, TerritoryCalcRun } from '@/types';

Chart.register(...registerables);

export function StatsPage() {
  const {
    data,
    colorForRoute,
    deleteTerritoryCalcRun,
    clearTerritoryCalcRuns,
    deleteRoadMileageReport,
    clearRoadMileageReports,
  } = useAppContext();
  const [activeTab, setActiveTab] = useState<'charts' | 'territory' | 'sectionRoad'>('charts');

  const routesChartRef = useRef<HTMLCanvasElement>(null);
  const daysChartRef = useRef<HTMLCanvasElement>(null);
  const routesChartInstance = useRef<Chart | null>(null);
  const daysChartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    if (activeTab !== 'charts') return;

    routesChartInstance.current?.destroy();
    daysChartInstance.current?.destroy();

    const points = data.points;

    // Routes chart
    const routeCounts: Record<string, number> = {};
    for (const p of points) {
      const r = p.route || '—';
      routeCounts[r] = (routeCounts[r] || 0) + 1;
    }
    const routeLabels = Object.keys(routeCounts).sort();
    const routeData = routeLabels.map((l) => routeCounts[l]);

    if (routesChartRef.current) {
      routesChartInstance.current = new Chart(routesChartRef.current, {
        type: 'bar',
        data: {
          labels: routeLabels,
          datasets: [
            {
              label: 'Точек',
              data: routeData,
              backgroundColor: routeLabels.map((r) => colorForRoute(r)),
            },
          ],
        },
        options: { responsive: true, plugins: { legend: { display: false } } },
      });
    }

    // Days chart
    const dayCounts: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0 };
    for (const p of points) {
      const d = normalizeDayCode(p.visitDayCode);
      if (d) dayCounts[d]++;
    }
    const dayLabels = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];
    const dayData = ['1', '2', '3', '4', '5', '6', '7'].map((k) => dayCounts[k]);

    if (daysChartRef.current) {
      daysChartInstance.current = new Chart(daysChartRef.current, {
        type: 'bar',
        data: {
          labels: dayLabels,
          datasets: [
            {
              label: 'Посещения',
              data: dayData,
              backgroundColor: '#2196F3',
            },
          ],
        },
        options: { responsive: true, plugins: { legend: { display: false } } },
      });
    }

    return () => {
      routesChartInstance.current?.destroy();
      daysChartInstance.current?.destroy();
    };
  }, [data.points, colorForRoute, activeTab]);

  const territoryRuns = useMemo(() => (data.territoryCalcRuns || []), [data.territoryCalcRuns]);

  const exportRouteReportXlsx = (run: TerritoryCalcRun) => {
    const wb = buildTerritoryRouteReportWorkbook(run);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(
      `Территория_ОтчётМаршрут_${new Date(run.createdAt).toISOString().slice(0, 10)}.xlsx`,
      new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
  };

  const roadReports = useMemo(() => (data.roadMileageReports || []), [data.roadMileageReports]);

  const exportRoadReportsXlsx = (reports: RoadMileageReport[], namePrefix: string) => {
    // Enrich report stops with address (RoadMileageStop has no address field).
    // We keep export util generic and inject address into the "Name/Address" columns by patching stop name.
    // (The export util uses a lookup for address; here we prepare a map so it can fill addresses correctly.)
    const pointById = new Map(data.points.map((p) => [p.id, p] as const));

    const enriched = reports.map((r) => ({
      ...r,
      stops: r.stops.map((s) => {
        const p = pointById.get(s.pointId);
        // keep original name; address will be taken from pointById in util via this temporary field if present
        // We attach as (s as any).address to avoid mutating types.
        return Object.assign({}, s, { address: p?.address || '' }) as any;
      }),
    }));

    const wb = buildSectionRoadMileageWorkbook(enriched as any);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(
      `${namePrefix}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      new Blob([out], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    );
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      {/* Tabs */}
      <div className="mb-4 border-b border-slate-200 dark:border-white/10 flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveTab('charts')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'charts'
              ? 'border-sky-500 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          📊 Графики
        </button>
        <button
          onClick={() => setActiveTab('territory')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'territory'
              ? 'border-sky-500 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          🧾 Отчёты территории
        </button>
        <button
          onClick={() => setActiveTab('sectionRoad')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            activeTab === 'sectionRoad'
              ? 'border-sky-500 text-sky-600'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          🚗 Секции (дороги)
        </button>
      </div>

      {activeTab === 'charts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
            <div className="font-semibold text-slate-900 dark:text-white">Точки по маршрутам</div>
            <canvas ref={routesChartRef} className="mt-3" />
          </div>
          <div className="bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
            <div className="font-semibold text-slate-900 dark:text-white">Посещения по дням</div>
            <canvas ref={daysChartRef} className="mt-3" />
          </div>
        </div>
      )}

      {activeTab === 'territory' && (
        <div className="bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="font-semibold text-lg text-slate-900 dark:text-white">🧾 Отчёты расчёта (Территории)</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Здесь сохраняются запуски «🚗 Пробег (оценка)» из режима Территории. Каждый запуск можно экспортировать в Excel: один файл, каждый маршрут — отдельная вкладка.
              </div>
            </div>

            <button
              onClick={() => {
                const cnt = territoryRuns.length;
                if (cnt === 0) {
                  alert('Нет отчётов для удаления.');
                  return;
                }
                if (confirm(`Удалить все ${cnt} отчётов территории?`)) {
                  clearTerritoryCalcRuns();
                }
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300"
            >
              🗑️ Очистить все
            </button>
          </div>

          {territoryRuns.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Пока нет сохранённых запусков. Выполните расчёт в режиме «Территории» → «🚗 Пробег (оценка)» и сохраните результат.
            </div>
          ) : (
            <div className="space-y-3">
              {territoryRuns.map((run) => {
                const totalRoutes = run.routes.length;
                const totalCombos = run.routes.reduce((s, r) => s + r.combos.length, 0);
                const totalStops = run.routes.reduce((s, r) => s + r.combos.reduce((ss, c) => ss + c.stops.length, 0), 0);

                return (
                  <div
                    key={run.id}
                    className="border border-slate-200 dark:border-white/10 rounded-xl p-4 hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          Запуск: {new Date(run.createdAt).toLocaleString('ru-RU')}
                          {run.orderSaved ? (
                            <span className="ml-2 text-xs text-emerald-600">(порядок сохранён)</span>
                          ) : (
                            <span className="ml-2 text-xs text-slate-400">(без сохранения порядка)</span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Маршрутов: <b>{totalRoutes}</b> • Комбинаций (W×дни): <b>{totalCombos}</b> • Точек: <b>{totalStops}</b>
                        </div>
                        {(run.missingStartRoutes?.length || 0) > 0 ? (
                          <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                            Пропущено маршрутов без старта: {run.missingStartRoutes.join(', ')}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => exportRouteReportXlsx(run)}
                          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200"
                        >
                          📤 Отчёт (XLSX)
                        </button>
                        <button
                          onClick={() => {
                            if (!confirm('Удалить этот запуск?')) return;
                            deleteTerritoryCalcRun(run.id);
                          }}
                          className="text-xs px-2 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'sectionRoad' && (
        <div className="bg-white/80 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <div className="font-semibold text-lg text-slate-900 dark:text-white">🚗 Пробег (дороги) — отчёты (Секции)</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Здесь сохраняются результаты расчёта «Секции → 🚗 Пробег (дороги)». Экспорт в Excel формируется при любом запуске: 1/несколько дней и 1/несколько недель.
                Формат экспорта: <b>одна вкладка = один маршрут</b>, внутри вкладки блоки по дням <b>ПН–ПТ</b> и колонки <b>W1–W4</b> (Order/Visit/Leg km/Leg drive).
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  if (roadReports.length === 0) {
                    alert('Нет отчётов для экспорта.');
                    return;
                  }
                  exportRoadReportsXlsx(roadReports, 'Секции_ПробегДороги');
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200"
              >
                📤 Экспорт всех (XLSX)
              </button>
              <button
                onClick={() => {
                  const cnt = roadReports.length;
                  if (cnt === 0) {
                    alert('Нет отчётов для удаления.');
                    return;
                  }
                  if (confirm(`Удалить все ${cnt} отчётов пробега по дорогам?`)) {
                    clearRoadMileageReports();
                  }
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300"
              >
                🗑️ Очистить все
              </button>
            </div>
          </div>

          {roadReports.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Пока нет сохранённых отчётов. Откройте «Карта → Секции → 🚗 Пробег (дороги)», выполните расчёт и сохраните результат.
            </div>
          ) : (
            <div className="space-y-3">
  {roadReports
  .filter((r) => r.dayCode === 'ALL')
  .slice()
  .sort((a, b) => (b.createdAt.localeCompare(a.createdAt)))
  .map((r) => {
    const runs = (r.meta?.runs || []);
    const totalCombos = runs.length;
    const totalStops = runs.reduce((s: number, x: any) => s + (x.stops || 0), 0);

    return (
      <div
        key={r.id}
        className="border border-slate-200 dark:border-white/10 rounded-xl p-4 hover:bg-slate-50 dark:hover:bg-white/5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 dark:text-white truncate">
              Запуск: {new Date(r.createdAt).toLocaleString('ru-RU')} • Маршрут: {r.route}
              {r.orderSaved ? (
                <span className="ml-2 text-xs text-emerald-600">(порядок сохранён)</span>
              ) : (
                <span className="ml-2 text-xs text-slate-400">(без сохранения порядка)</span>
              )}
            </div>

            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Комбинаций (дни × недели): <b>{totalCombos}</b> • Точек: <b>{totalStops}</b> • Пробег: <b>{r.driveKm} км</b> • Итого: <b>{Math.floor(r.totalMinutes / 60)}ч {r.totalMinutes % 60}м</b>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => exportRoadReportsXlsx([r], `Секции_ПробегДороги_${r.route}`)}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200"
            >
              📤 XLSX (общий)
            </button>

            <button
              onClick={() => {
                if (!confirm('Удалить этот отчёт?')) return;
                deleteRoadMileageReport(r.id);
              }}
              className="text-xs px-2 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-200"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    );
  })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
