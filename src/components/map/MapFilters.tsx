import { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '@/store/AppContext';
import { DAY_CODE_TO_LABEL, DAY_COLORS } from '@/constants';
import { getISOWeekNumber, getCycleIndexByISOWeek } from '@/utils/helpers';
import { Point } from '@/types';
import { BulkEditPointsModal } from '@/components/modals/BulkEditPointsModal';
import { RoadMileageModal } from '@/components/modals/RoadMileageModal';
import { TerritoryMileageModal } from '@/components/modals/TerritoryMileageModal';

interface MapFiltersProps {
  filteredPoints: Point[];
  onSearch: (query: string) => void;
  searchQuery: string;
  onFitAll: () => void;
}

export function MapFilters({ filteredPoints, onSearch, searchQuery, onFitAll }: MapFiltersProps) {
  const {
    data,
    mapMode,
    setMapMode,
    sectionRoute,
    setSectionRoute,
    filters,
    toggleRouteFilter,
    toggleBranchFilter,
    toggleDayFilter,
    toggleCycleFilter,
    clearFilters,
    setFilters,
    routesFromPoints,
    branchesFromPoints,
    colorForRoute,
    selection,
    selectAllVisible,
    clearSelection,
    currentUser,
  } = useAppContext();

  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [roadMileageOpen, setRoadMileageOpen] = useState(false);
  const [territoryMileageOpen, setTerritoryMileageOpen] = useState(false);

  // Close modals when switching map mode to prevent wrong modal usage
  useEffect(() => {
    if (mapMode === 'section') {
      setTerritoryMileageOpen(false);
    }
    if (mapMode === 'territory') {
      setRoadMileageOpen(false);
    }
  }, [mapMode]);

  const routes = routesFromPoints();
  const branches = branchesFromPoints();
  const user = currentUser();

  // Filter routes by user if User role
  const availableRoutes = user?.role === 'User' && user.route
    ? routes.filter((r) => r === user.route)
    : routes;

  const routesForSelectedBranches = useMemo(() => {
    if (filters.branches.size === 0) return availableRoutes;
    const filteredByBranch = data.points.filter((p) => filters.branches.has(p.branch));
    const routeSet = new Set(filteredByBranch.map((p) => p.route).filter(Boolean));
    return availableRoutes.filter((r) => routeSet.has(r));
  }, [availableRoutes, data.points, filters.branches]);

  const displayedRoutes = mapMode === 'section' ? availableRoutes : routesForSelectedBranches;

  // Ensure sectionRoute is set when switching to Section mode (never setState during render)
  useEffect(() => {
    if (mapMode !== 'section') return;
    if (sectionRoute) return;
    if (displayedRoutes.length === 0) return;
    setSectionRoute(displayedRoutes[0]);
  }, [mapMode, sectionRoute, displayedRoutes, setSectionRoute]);

  const today = new Date();
  const currentISOWeek = getISOWeekNumber(today);

  return (
    <div className="p-3 border-b border-slate-200 dark:border-white/10">
      {/* Mode switcher */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
          <button
            onClick={() => setMapMode('territory')}
            className={`px-3 py-1.5 text-xs font-medium ${
              mapMode === 'territory'
                ? 'bg-sky-500 text-white'
                : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/20'
            }`}
          >
            Территории
          </button>
          <button
            onClick={() => setMapMode('section')}
            className={`px-3 py-1.5 text-xs font-medium ${
              mapMode === 'section'
                ? 'bg-sky-500 text-white'
                : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/20'
            }`}
          >
            Секции
          </button>
        </div>

        {mapMode === 'territory' && (
          <button
            onClick={() => setTerritoryMileageOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-xl bg-violet-500 text-white hover:bg-violet-600"
            title="Массовый расчёт по всем активным маршрутам/дням/W1–W4 (оценка по прямой)"
          >
            🚗 Пробег (оценка)
          </button>
        )}

        {mapMode === 'section' && (
          <button
            onClick={() => setRoadMileageOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-xl bg-emerald-500 text-white hover:bg-emerald-600"
            title="Расчёт пробега по дорогам (OSRM)"
          >
            🚗 Пробег (дороги)
          </button>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-400 text-slate-900 dark:text-white"
          placeholder="Поиск или коды через , ; пробел"
        />
        <button
          onClick={onFitAll}
          className="shrink-0 w-10 h-10 rounded-xl grid place-items-center border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10"
          title="Центрировать все"
        >
          ⊕
        </button>
      </div>

      {/* Branch filters - only in territory mode */}
      {mapMode === 'territory' && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">Филиалы</span>
            <div className="flex gap-1">
              <button
                onClick={() => setFilters({ branches: new Set() })}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20"
              >
                Все
              </button>
              <button
                onClick={() => setFilters({ branches: new Set() })}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20"
              >
                Сброс
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
            {branches.map((b) => {
              const isActive = filters.branches.size === 0 || filters.branches.has(b);
              return (
                <button
                  key={b}
                  onClick={() => toggleBranchFilter(b)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${
                    isActive
                      ? 'bg-sky-500 border-transparent text-white'
                      : 'border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-400 opacity-50 bg-transparent'
                  }`}
                >
                  {b}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Routes filter */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {mapMode === 'section' ? 'ТП (маршрут)' : 'Маршруты'}
          </span>
          {mapMode !== 'section' && (
            <div className="flex gap-1">
              <button
                onClick={() => setFilters({ routes: new Set() })}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20"
              >
                Все
              </button>
              <button
                onClick={() => setFilters({ routes: new Set() })}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20"
              >
                Сброс
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
          {displayedRoutes.map((r) => {
            const color = colorForRoute(r);
            const isActive = mapMode === 'section'
              ? sectionRoute === r
              : filters.routes.size === 0 || filters.routes.has(r);
            return (
              <button
                key={r}
                onClick={() => {
                  if (mapMode === 'section') {
                    setSectionRoute(r);
                  } else {
                    toggleRouteFilter(r);
                  }
                }}
                className={`text-[10px] px-2 py-1 rounded-lg border transition-all ${
                  isActive
                    ? 'border-transparent text-white'
                    : 'border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-400 opacity-50'
                }`}
                style={{ background: isActive ? color : 'transparent' }}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      {/* Days filter */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Дни недели</span>
          <div className="flex gap-1">
            <button
              onClick={() => setFilters({ days: new Set() })}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20"
            >
              Все
            </button>
            <button
              onClick={() => setFilters({ days: new Set() })}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20"
            >
              Сброс
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {['1', '2', '3', '4', '5', '6', '7'].map((code) => {
            const label = DAY_CODE_TO_LABEL[code];
            const color = DAY_COLORS[code];
            const isActive = filters.days.size === 0 || filters.days.has(code);
            return (
              <button
                key={code}
                onClick={(e) => toggleDayFilter(code, e.shiftKey)}
                className={`text-[10px] px-2 py-1 rounded-lg border transition-all font-medium ${
                  isActive
                    ? 'border-transparent text-white'
                    : 'border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-400 opacity-50'
                }`}
                style={{ background: isActive ? color : 'transparent' }}
                title={mapMode === 'section' ? 'Клик — одиночный выбор, Shift+клик — множественный' : ''}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cycle filter */}
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-500 dark:text-slate-400">Цикличность (недели ISO)</span>
          <button
            onClick={() => setFilters({ cycleWeeks: new Set() })}
            className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20"
          >
            Сброс
          </button>
        </div>
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => {
            const weekNum = currentISOWeek + i;
            const displayWeek = weekNum > 52 ? weekNum - 52 : weekNum;
            const cycleIndex = getCycleIndexByISOWeek(weekNum);
            const cycleCode = `1.${cycleIndex}`;
            const isActive = filters.cycleWeeks.has(i);
            return (
              <button
                key={i}
                onClick={(e) => toggleCycleFilter(i, e.shiftKey)}
                className={`text-[10px] px-2 py-1 rounded-lg border transition-all font-semibold ${
                  isActive
                    ? 'bg-violet-500 border-transparent text-white'
                    : 'border-slate-300 dark:border-white/20 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
                }`}
                title={`Неделя ${displayWeek} (ISO), ${cycleCode} в четырёхнедельном цикле`}
              >
                {displayWeek} [{cycleCode}]
              </button>
            );
          })}
          <button
            onClick={(e) => toggleCycleFilter('Z0', e.shiftKey)}
            className={`ml-2 text-[10px] px-2 py-1 rounded-lg border transition-all font-semibold ${
              filters.cycleWeeks.has('Z0')
                ? 'bg-slate-600 border-transparent text-white'
                : 'bg-slate-100 dark:bg-white/10 border-slate-300 dark:border-white/20 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/20'
            }`}
            title="Цикличность 0: показать точки только для выходных (СБ/ВС)"
          >
            0
          </button>
        </div>
      </div>

      {/* Stats and controls */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs text-slate-600 dark:text-slate-300/70">
          На карте: <span className="font-semibold">{filteredPoints.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearFilters}
            className="text-[10px] px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-900/50"
          >
            Сбросить всё
          </button>
        </div>
      </div>

      {/* Selection panel */}
      <div className="mt-2 p-2 bg-slate-50 dark:bg-white/5 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filteredPoints.length > 0 && filteredPoints.every((p) => selection.selectedIds.has(p.id))}
              onChange={() => selectAllVisible(filteredPoints)}
              className="w-4 h-4 rounded accent-sky-500"
              title="Выбрать все видимые"
            />
            <span className="text-xs text-slate-600 dark:text-slate-300/70">
              Выбрано: <span className="font-semibold">{selection.selectedIds.size}</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setBulkEditOpen(true)}
              disabled={selection.selectedIds.size === 0}
              className="text-[10px] px-2 py-0.5 rounded bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed"
              title={
                mapMode === 'section'
                  ? 'Массовое изменение: день / цикличность'
                  : 'Массовое изменение: маршрут / день / цикличность'
              }
            >
              Изменить
            </button>
            <button
              onClick={clearSelection}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20"
            >
              Сброс
            </button>
          </div>
        </div>
      </div>

      <BulkEditPointsModal open={bulkEditOpen} onClose={() => setBulkEditOpen(false)} />
      {mapMode === 'section' && (
        <RoadMileageModal open={roadMileageOpen} onClose={() => setRoadMileageOpen(false)} />
      )}
      {mapMode === 'territory' && (
        <TerritoryMileageModal
          open={territoryMileageOpen}
          onClose={() => setTerritoryMileageOpen(false)}
          visiblePoints={filteredPoints}
        />
      )}
    </div>
  );
}
