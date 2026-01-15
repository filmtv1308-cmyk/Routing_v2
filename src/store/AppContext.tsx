import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { AppData, User, Session, MapMode, Page, Point, RoadMileageReport, TerritoryCalcRun } from '@/types';
import { STORAGE_KEY, SESSION_KEY, REMEMBER_KEY, ROUTE_COLORS } from '@/constants';
import { defaultData } from './defaultData';
import { uid, normalizeFreqCode, normalizeDayCode } from '@/utils/helpers';

interface Filters {
  routes: Set<string>;
  branches: Set<string>;
  days: Set<string>;
  cycleWeeks: Set<number | string>;
}

interface Selection {
  selectedIds: Set<string>;
  mode: 'lasso' | 'rectangle' | null;
}

interface AppState {
  data: AppData;
  session: Session | null;
  page: Page;
  mapMode: MapMode;
  sectionRoute: string | null;
  filters: Filters;
  selection: Selection;
  theme: 'light' | 'dark';
  mileageOrderNumbers: Map<string, number> | null;

  /** Ephemeral track polyline for road mileage (not persisted) */
  roadTrack: { coords: [number, number][]; color: string; reportId?: string } | null;
}

interface AppContextType extends AppState {
  currentUser: () => User | null;
  isAdmin: () => boolean;
  login: (username: string, password: string, remember: boolean) => boolean;
  logout: () => void;

  addTerritoryCalcRun: (run: TerritoryCalcRun) => void;
  updateTerritoryCalcRun: (run: TerritoryCalcRun) => void;
  deleteTerritoryCalcRun: (id: string) => void;
  clearTerritoryCalcRuns: () => void;
  setPage: (page: Page) => void;
  setMapMode: (mode: MapMode) => void;
  setSectionRoute: (route: string | null) => void;
  setFilters: (filters: Partial<Filters>) => void;
  toggleRouteFilter: (route: string) => void;
  toggleBranchFilter: (branch: string) => void;
  toggleDayFilter: (day: string, shiftKey?: boolean) => void;
  toggleCycleFilter: (week: number | string, shiftKey?: boolean) => void;
  clearFilters: () => void;
  togglePointSelection: (id: string) => void;
  addPointsToSelection: (ids: string[]) => void;
  selectAllVisible: (points: Point[]) => void;
  clearSelection: () => void;
  setSelectionMode: (mode: 'lasso' | 'rectangle' | null) => void;
  updatePoints: (points: Point[]) => void;
  addPoints: (points: Point[]) => void;
  addPointsFromFiles: (points: Point[], files: { fileName: string; count: number; importedAt: string; kind?: 'excel' }[]) => void;
  deletePointsBySourceFile: (fileName: string) => void;
  deleteAllPoints: () => void;
  updatePolygons: (polygons: AppData['polygons']) => void;
  addPolygons: (polygons: AppData['polygons']) => void;
  addPolygonsFromFiles: (polygons: AppData['polygons'], files: { fileName: string; count: number; importedAt: string; kind?: 'txt' | 'json'; color?: string }[]) => void;
  deletePolygonsBySourceFile: (fileName: string) => void;
  deleteAllPolygons: () => void;
  updateStartPoints: (startPoints: AppData['startPoints']) => void;
  deleteAllStartPoints: () => void;
  updateUsers: (users: User[]) => void;
  addUser: (user: User) => void;
  deleteUser: (id: string) => void;
  addMileageReport: (report: AppData['mileageReports'] extends (infer R)[] | undefined ? R : never) => void;
  deleteMileageReport: (id: string) => void;
  clearMileageReports: () => void;

  addRoadMileageReport: (report: RoadMileageReport) => void;
  deleteRoadMileageReport: (id: string) => void;
  clearRoadMileageReports: () => void;

  setMileageOrderNumbers: (map: Map<string, number> | null) => void;
  setRoadTrack: (track: { coords: [number, number][]; color: string; reportId?: string } | null) => void;
  toggleTheme: () => void;
  routesFromPoints: () => string[];
  branchesFromPoints: () => string[];
  colorForRoute: (route: string) => string;
  saveData: () => void;
  resetToDemo: () => void;
  importData: (data: AppData) => void;
  getRememberedCredentials: () => { login: string; password: string } | null;
}

const AppContext = createContext<AppContextType | null>(null);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}

function loadData(): AppData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const d = defaultData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    return d;
  }
  try {
    const d = JSON.parse(raw) as AppData;
    d.users = d.users || [];
    d.points = d.points || [];
    d.polygons = d.polygons || [];
    d.startPoints = d.startPoints || [];
    d.importMeta = d.importMeta || {};
    d.importMeta.pointsFiles = d.importMeta.pointsFiles || [];
    d.importMeta.polygonFiles = d.importMeta.polygonFiles || [];

    d.mileageReports = d.mileageReports || [];
    d.roadMileageReports = d.roadMileageReports || [];
    d.territoryCalcRuns = d.territoryCalcRuns || [];

    const hasAdmin = d.users.some(u => u?.login === 'admin');
    if (!hasAdmin) {
      d.users.push({ id: uid(), fullName: 'Администратор', login: 'admin', password: 'admin123', role: 'Admin', route: '' });
    }
    const hasUser = d.users.some(u => u?.login === 'user');
    if (!hasUser) {
      d.users.push({ id: uid(), fullName: 'Торговый представитель', login: 'user', password: 'user123', role: 'User', route: 'R1' });
    }

    for (const p of d.points) {
      if (p.frequencyCode) p.frequencyCode = normalizeFreqCode(p.frequencyCode);
      if (p.visitDayCode) p.visitDayCode = normalizeDayCode(p.visitDayCode);
      if (!p.visitOrderByWeek || typeof p.visitOrderByWeek !== 'object') {
        p.visitOrderByWeek = {};
      }
      // normalize visitMinutes: if empty/invalid => 15
      const vm = typeof p.visitMinutes === 'number'
        ? p.visitMinutes
        : Number(String(p.visitMinutes ?? '').replace(',', '.'));
      if (!Number.isFinite(vm) || vm <= 0) {
        p.visitMinutes = 15;
      } else {
        p.visitMinutes = Math.round(vm);
      }
    }

    return d;
  } catch {
    const d = defaultData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    return d;
  }
}

function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadTheme(): 'light' | 'dark' {
  const t = localStorage.getItem('rm_theme') || 'light';
  return t === 'dark' ? 'dark' : 'light';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(() => ({
    data: loadData(),
    session: loadSession(),
    page: 'map',
    mapMode: 'territory',
    sectionRoute: null,
    filters: {
      routes: new Set(),
      branches: new Set(),
      days: new Set(),
      cycleWeeks: new Set()
    },
    selection: {
      selectedIds: new Set(),
      mode: null
    },
    theme: loadTheme(),
    mileageOrderNumbers: null,
    roadTrack: null
  }));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);

  const saveData = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }, [state.data]);

  useEffect(() => {
    const interval = setInterval(saveData, 30000);
    return () => clearInterval(interval);
  }, [saveData]);

  const currentUser = useCallback(() => {
    if (!state.session) return null;
    return state.data.users.find(u => u.id === state.session?.userId) || null;
  }, [state.session, state.data.users]);

  const isAdmin = useCallback(() => {
    const u = currentUser();
    return u?.role === 'Admin';
  }, [currentUser]);

  const routesFromPoints = useCallback(() => {
    const set = new Set(state.data.points.map(p => p.route).filter(Boolean));
    return [...set].sort();
  }, [state.data.points]);

  const branchesFromPoints = useCallback(() => {
    const set = new Set(state.data.points.map(p => p.branch).filter(Boolean));
    return [...set].sort();
  }, [state.data.points]);

  const colorForRoute = useCallback((route: string) => {
    if (!route) return '#64748b';
    const routes = routesFromPoints();
    const idx = Math.max(0, routes.indexOf(route));
    return ROUTE_COLORS[idx % ROUTE_COLORS.length];
  }, [routesFromPoints]);

  const login = useCallback((username: string, password: string, remember: boolean) => {
    const user = state.data.users.find(u => u.login === username && u.password === password);
    if (!user) return false;
    
    const session = { userId: user.id };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    
    if (remember) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ login: username, password }));
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }
    
    setState(s => ({ ...s, session }));
    return true;
  }, [state.data.users]);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setState(s => ({ ...s, session: null }));
  }, []);

  const getRememberedCredentials = useCallback(() => {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        localStorage.removeItem(REMEMBER_KEY);
      }
    }
    return null;
  }, []);

  const setPage = useCallback((page: Page) => {
    setState(s => ({ ...s, page }));
  }, []);

  const setMapMode = useCallback((mode: MapMode) => {
    setState((s) => {
      // when switching to "section" we must pick a concrete route, otherwise the map/list can explode
      // with all points and cause long blocking renders.
      let nextSectionRoute = s.sectionRoute;

      if (mode === 'section') {
        const u = s.session ? s.data.users.find((x) => x.id === s.session!.userId) : null;
        const allRoutes = Array.from(new Set(s.data.points.map((p) => p.route).filter(Boolean))).sort();
        const allowedRoutes = (u && u.role === 'User' && u.route)
          ? allRoutes.filter((r) => r === u.route)
          : allRoutes;

        if (!nextSectionRoute || !allowedRoutes.includes(nextSectionRoute)) {
          nextSectionRoute = allowedRoutes.length > 0 ? allowedRoutes[0] : null;
        }
      }

      return {
        ...s,
        mapMode: mode,
        sectionRoute: nextSectionRoute,
        mileageOrderNumbers: null,
        filters: {
          ...s.filters,
          routes: new Set(),
          branches: new Set(),
        },
        selection: {
          ...s.selection,
          selectedIds: new Set(),
        },
      };
    });
  }, []);

  const setSectionRoute = useCallback((route: string | null) => {
    setState(s => ({ ...s, sectionRoute: route }));
  }, []);

  const setFilters = useCallback((filters: Partial<Filters>) => {
    setState(s => ({
      ...s,
      filters: { ...s.filters, ...filters }
    }));
  }, []);

  const toggleRouteFilter = useCallback((route: string) => {
    setState(s => {
      const newRoutes = new Set(s.filters.routes);
      if (newRoutes.has(route)) {
        newRoutes.delete(route);
      } else {
        newRoutes.add(route);
      }
      return { ...s, filters: { ...s.filters, routes: newRoutes } };
    });
  }, []);

  const toggleBranchFilter = useCallback((branch: string) => {
    setState(s => {
      const newBranches = new Set(s.filters.branches);
      if (newBranches.has(branch)) {
        newBranches.delete(branch);
      } else {
        newBranches.add(branch);
      }
      return { ...s, filters: { ...s.filters, branches: newBranches } };
    });
  }, []);

  const toggleDayFilter = useCallback((day: string, shiftKey = false) => {
    setState(s => {
      if (s.mapMode === 'section' && !shiftKey) {
        if (s.filters.days.size === 1 && s.filters.days.has(day)) {
          return { ...s, filters: { ...s.filters, days: new Set() }, mileageOrderNumbers: null };
        }
        return { ...s, filters: { ...s.filters, days: new Set([day]) }, mileageOrderNumbers: null };
      }
      const newDays = new Set(s.filters.days);
      if (newDays.has(day)) {
        newDays.delete(day);
      } else {
        newDays.add(day);
      }
      return { ...s, filters: { ...s.filters, days: newDays }, mileageOrderNumbers: null };
    });
  }, []);

  const toggleCycleFilter = useCallback((week: number | string, shiftKey = false) => {
    setState(s => {
      if (s.mapMode === 'section' && !shiftKey) {
        if (s.filters.cycleWeeks.size === 1 && s.filters.cycleWeeks.has(week)) {
          return { ...s, filters: { ...s.filters, cycleWeeks: new Set() }, mileageOrderNumbers: null };
        }
        return { ...s, filters: { ...s.filters, cycleWeeks: new Set([week]) }, mileageOrderNumbers: null };
      }
      const newWeeks = new Set(s.filters.cycleWeeks);
      if (newWeeks.has(week)) {
        newWeeks.delete(week);
      } else {
        newWeeks.add(week);
      }
      return { ...s, filters: { ...s.filters, cycleWeeks: newWeeks }, mileageOrderNumbers: null };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setState(s => ({
      ...s,
      filters: {
        routes: new Set(),
        branches: new Set(),
        days: new Set(),
        cycleWeeks: new Set()
      }
    }));
  }, []);

  const togglePointSelection = useCallback((id: string) => {
    setState(s => {
      const newSelected = new Set(s.selection.selectedIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return { ...s, selection: { ...s.selection, selectedIds: newSelected } };
    });
  }, []);

  const addPointsToSelection = useCallback((ids: string[]) => {
    if (!ids || ids.length === 0) return;
    setState(s => {
      const newSelected = new Set(s.selection.selectedIds);
      ids.forEach(id => newSelected.add(id));
      return { ...s, selection: { ...s.selection, selectedIds: newSelected } };
    });
  }, []);

  const selectAllVisible = useCallback((points: Point[]) => {
    setState(s => {
      const allSelected = points.every(p => s.selection.selectedIds.has(p.id));
      if (allSelected) {
        const newSelected = new Set(s.selection.selectedIds);
        points.forEach(p => newSelected.delete(p.id));
        return { ...s, selection: { ...s.selection, selectedIds: newSelected } };
      } else {
        const newSelected = new Set(s.selection.selectedIds);
        points.forEach(p => newSelected.add(p.id));
        return { ...s, selection: { ...s.selection, selectedIds: newSelected } };
      }
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState(s => ({ ...s, selection: { ...s.selection, selectedIds: new Set() } }));
  }, []);

  const setSelectionMode = useCallback((mode: 'lasso' | 'rectangle' | null) => {
    setState(s => ({ ...s, selection: { ...s.selection, mode } }));
  }, []);

  const updatePoints = useCallback((points: Point[]) => {
    setState(s => {
      const newData = { ...s.data, points };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addPoints = useCallback((points: Point[]) => {
    setState(s => {
      const byCode = new Map(s.data.points.map(p => [String(p.clientCode || '').trim(), p]));
      for (const p of points) {
        const key = String(p.clientCode || '').trim();
        if (!key) continue;
        if (byCode.has(key)) {
          const existing = byCode.get(key)!;
          const keepId = existing.id;
          const keepOrder = existing.visitOrderByWeek;
          Object.assign(existing, p);
          // preserve stable identity and keep manual order if not explicitly provided
          existing.id = keepId;
          if (!p.visitOrderByWeek && keepOrder) {
            existing.visitOrderByWeek = keepOrder;
          }
        } else {
          byCode.set(key, p);
        }
      }
      const newPoints = Array.from(byCode.values());
      const newData = { ...s.data, points: newPoints };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addPointsFromFiles = useCallback((points: Point[], files: { fileName: string; count: number; importedAt: string; kind?: 'excel' }[]) => {
    setState(s => {
      // upsert points by clientCode
      const byCode = new Map(s.data.points.map(p => [String(p.clientCode || '').trim(), p]));
      for (const p of points) {
        const key = String(p.clientCode || '').trim();
        if (!key) continue;
        if (byCode.has(key)) {
          const existing = byCode.get(key)!;
          const keepId = existing.id;
          const keepOrder = existing.visitOrderByWeek;
          Object.assign(existing, p);
          existing.id = keepId;
          if (!p.visitOrderByWeek && keepOrder) {
            existing.visitOrderByWeek = keepOrder;
          }
        } else {
          byCode.set(key, p);
        }
      }

      const nextFiles = [...(s.data.importMeta?.pointsFiles || [])];
      for (const f of files) {
        const idx = nextFiles.findIndex(x => x.fileName === f.fileName);
        if (idx >= 0) nextFiles[idx] = { ...nextFiles[idx], ...f };
        else nextFiles.unshift({ ...f });
      }

      const newData = {
        ...s.data,
        points: Array.from(byCode.values()),
        importMeta: {
          ...(s.data.importMeta || {}),
          pointsFiles: nextFiles
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deletePointsBySourceFile = useCallback((fileName: string) => {
    setState(s => {
      const removedIds = new Set(s.data.points.filter(p => p.sourceFile === fileName).map(p => p.id));
      const nextPoints = s.data.points.filter(p => p.sourceFile !== fileName);

      const nextSelected = new Set(s.selection.selectedIds);
      removedIds.forEach(id => nextSelected.delete(id));

      const nextFiles = (s.data.importMeta?.pointsFiles || []).filter(f => f.fileName !== fileName);

      const newData = {
        ...s.data,
        points: nextPoints,
        importMeta: {
          ...(s.data.importMeta || {}),
          pointsFiles: nextFiles
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return {
        ...s,
        data: newData,
        selection: { ...s.selection, selectedIds: nextSelected }
      };
    });
  }, []);

  const deleteAllPoints = useCallback(() => {
    setState(s => {
      const newData = {
        ...s.data,
        points: [],
        importMeta: {
          ...(s.data.importMeta || {}),
          pointsFiles: []
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData, selection: { ...s.selection, selectedIds: new Set() } };
    });
  }, []);

  const updatePolygons = useCallback((polygons: AppData['polygons']) => {
    setState(s => {
      const newData = { ...s.data, polygons };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addPolygons = useCallback((polygons: AppData['polygons']) => {
    setState(s => {
      const newData = { ...s.data, polygons: [...s.data.polygons, ...polygons] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addPolygonsFromFiles = useCallback((polygons: AppData['polygons'], files: { fileName: string; count: number; importedAt: string; kind?: 'txt' | 'json'; color?: string }[]) => {
    setState(s => {
      const nextFiles = [...(s.data.importMeta?.polygonFiles || [])];
      for (const f of files) {
        const idx = nextFiles.findIndex(x => x.fileName === f.fileName);
        if (idx >= 0) nextFiles[idx] = { ...nextFiles[idx], ...f };
        else nextFiles.unshift({ ...f });
      }

      const newData = {
        ...s.data,
        polygons: [...s.data.polygons, ...polygons],
        importMeta: {
          ...(s.data.importMeta || {}),
          polygonFiles: nextFiles
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deletePolygonsBySourceFile = useCallback((fileName: string) => {
    setState(s => {
      const nextPolygons = s.data.polygons.filter(p => p.sourceFile !== fileName);
      const nextFiles = (s.data.importMeta?.polygonFiles || []).filter(f => f.fileName !== fileName);
      const newData = {
        ...s.data,
        polygons: nextPolygons,
        importMeta: {
          ...(s.data.importMeta || {}),
          polygonFiles: nextFiles
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deleteAllPolygons = useCallback(() => {
    setState(s => {
      const newData = {
        ...s.data,
        polygons: [],
        importMeta: {
          ...(s.data.importMeta || {}),
          polygonFiles: []
        }
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const updateStartPoints = useCallback((startPoints: AppData['startPoints']) => {
    setState(s => {
      const newData = { ...s.data, startPoints };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deleteAllStartPoints = useCallback(() => {
    setState(s => {
      const newData = { ...s.data, startPoints: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const updateUsers = useCallback((users: User[]) => {
    setState(s => {
      const newData = { ...s.data, users };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addUser = useCallback((user: User) => {
    setState(s => {
      const newData = { ...s.data, users: [...s.data.users, user] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deleteUser = useCallback((id: string) => {
    setState(s => {
      const newData = { ...s.data, users: s.data.users.filter(u => u.id !== id) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addMileageReport = useCallback((report: NonNullable<AppData['mileageReports']>[number]) => {
    setState(s => {
      const reports = [report, ...(s.data.mileageReports || [])].slice(0, 50);
      const newData = { ...s.data, mileageReports: reports };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deleteMileageReport = useCallback((id: string) => {
    setState(s => {
      const newData = { ...s.data, mileageReports: (s.data.mileageReports || []).filter(r => r.id !== id) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const clearMileageReports = useCallback(() => {
    setState(s => {
      const newData = { ...s.data, mileageReports: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addRoadMileageReport = useCallback((report: RoadMileageReport) => {
    setState(s => {
      const reports = [report, ...(s.data.roadMileageReports || [])].slice(0, 200);
      const newData = { ...s.data, roadMileageReports: reports };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const addTerritoryCalcRun = useCallback((run: TerritoryCalcRun) => {
    setState(s => {
      const runs = [run, ...(s.data.territoryCalcRuns || [])].slice(0, 50);
      // As per latest requirements, territory runs replace legacy reports UI.
      // We keep old arrays in data for backward-compat, but new UI ignores them.
      const newData = { ...s.data, territoryCalcRuns: runs };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const updateTerritoryCalcRun = useCallback((run: TerritoryCalcRun) => {
    setState(s => {
      const next = (s.data.territoryCalcRuns || []).map(r => (r.id === run.id ? run : r));
      const newData = { ...s.data, territoryCalcRuns: next };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deleteTerritoryCalcRun = useCallback((id: string) => {
    setState(s => {
      const next = (s.data.territoryCalcRuns || []).filter(r => r.id !== id);
      const newData = { ...s.data, territoryCalcRuns: next };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const clearTerritoryCalcRuns = useCallback(() => {
    setState(s => {
      const newData = { ...s.data, territoryCalcRuns: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const deleteRoadMileageReport = useCallback((id: string) => {
    setState(s => {
      const newData = {
        ...s.data,
        roadMileageReports: (s.data.roadMileageReports || []).filter(r => r.id !== id)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const clearRoadMileageReports = useCallback(() => {
    setState(s => {
      const newData = { ...s.data, roadMileageReports: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      return { ...s, data: newData };
    });
  }, []);

  const setMileageOrderNumbers = useCallback((map: Map<string, number> | null) => {
    setState(s => ({ ...s, mileageOrderNumbers: map }));
  }, []);

  const setRoadTrack = useCallback((track: { coords: [number, number][]; color: string; reportId?: string } | null) => {
    setState(s => ({ ...s, roadTrack: track }));
  }, []);

  const toggleTheme = useCallback(() => {
    setState(s => {
      const newTheme = s.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('rm_theme', newTheme);
      return { ...s, theme: newTheme };
    });
  }, []);

  const resetToDemo = useCallback(() => {
    const d = defaultData();

    setState(prev => {
      // Try to keep the current session after reset (important for Admin UI)
      let nextSession: Session | null = prev.session;

      const prevUser = prev.session
        ? prev.data.users.find(u => u.id === prev.session!.userId)
        : null;

      if (prevUser) {
        const matchByLogin = d.users.find(u => u.login === prevUser.login);
        if (matchByLogin) {
          nextSession = { userId: matchByLogin.id };
        } else if (prevUser.role === 'Admin') {
          const demoAdmin = d.users.find(u => u.login === 'admin');
          nextSession = demoAdmin ? { userId: demoAdmin.id } : null;
        } else {
          nextSession = null;
        }
      } else {
        // If session is invalid already, keep it null
        nextSession = null;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      if (nextSession) localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      else localStorage.removeItem(SESSION_KEY);

      return { ...prev, data: d, session: nextSession };
    });
  }, []);

  const importData = useCallback((incoming: AppData) => {
    setState(prev => {
      // --- migrate/normalize incoming data ---
      const data: AppData = {
        users: incoming.users || [],
        points: incoming.points || [],
        polygons: incoming.polygons || [],
        startPoints: incoming.startPoints || [],
        mileageReports: incoming.mileageReports || [],
        roadMileageReports: incoming.roadMileageReports || [],
        territoryCalcRuns: incoming.territoryCalcRuns || [],
        importMeta: {
          pointsFiles: incoming.importMeta?.pointsFiles || [],
          polygonFiles: incoming.importMeta?.polygonFiles || []
        }
      };

      // ensure required accounts exist
      const hasAdmin = data.users.some(u => u?.login === 'admin');
      if (!hasAdmin) {
        data.users.push({ id: uid(), fullName: 'Администратор', login: 'admin', password: 'admin123', role: 'Admin', route: '' });
      }
      const hasUser = data.users.some(u => u?.login === 'user');
      if (!hasUser) {
        data.users.push({ id: uid(), fullName: 'Торговый представитель', login: 'user', password: 'user123', role: 'User', route: 'R1' });
      }

      // normalize points (freq/day/order object/visit minutes)
      for (const p of data.points) {
        if (p.frequencyCode) p.frequencyCode = normalizeFreqCode(p.frequencyCode);
        if (p.visitDayCode) p.visitDayCode = normalizeDayCode(p.visitDayCode);
        if (!p.visitOrderByWeek || typeof p.visitOrderByWeek !== 'object') {
          p.visitOrderByWeek = {};
        }
        const vm = typeof p.visitMinutes === 'number'
          ? p.visitMinutes
          : Number(String(p.visitMinutes ?? '').replace(',', '.'));
        if (!Number.isFinite(vm) || vm <= 0) {
          p.visitMinutes = 15;
        } else {
          p.visitMinutes = Math.round(vm);
        }
      }

      // --- preserve admin access: remap session by login ---
      let nextSession: Session | null = prev.session;

      const prevUser = prev.session
        ? prev.data.users.find(u => u.id === prev.session!.userId)
        : null;

      if (prevUser) {
        const matchByLogin = data.users.find(u => u.login === prevUser.login);
        if (matchByLogin) {
          nextSession = { userId: matchByLogin.id };
        } else if (prevUser.role === 'Admin') {
          const adminUser = data.users.find(u => u.login === 'admin');
          nextSession = adminUser ? { userId: adminUser.id } : null;
        } else {
          nextSession = null;
        }
      } else {
        // If session exists but userId not present in imported backup — drop it
        if (nextSession && !data.users.some(u => u.id === nextSession!.userId)) {
          nextSession = null;
        }
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      if (nextSession) localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      else localStorage.removeItem(SESSION_KEY);

      // If user lost admin rights after import, force page back to map
      const nextPage: Page = nextSession ? prev.page : 'map';

      return { ...prev, data, session: nextSession, page: nextPage };
    });
  }, [uid, normalizeFreqCode, normalizeDayCode]);

  const value = useMemo<AppContextType>(() => ({
    ...state,
    currentUser,
    isAdmin,
    login,
    logout,
    setPage,
    setMapMode,
    setSectionRoute,
    setFilters,
    toggleRouteFilter,
    toggleBranchFilter,
    toggleDayFilter,
    toggleCycleFilter,
    clearFilters,
    togglePointSelection,
    addPointsToSelection,
    selectAllVisible,
    clearSelection,
    setSelectionMode,
    updatePoints,
    addPoints,
    addPointsFromFiles,
    deletePointsBySourceFile,
    deleteAllPoints,
    updatePolygons,
    addPolygons,
    addPolygonsFromFiles,
    deletePolygonsBySourceFile,
    deleteAllPolygons,
    updateStartPoints,
    deleteAllStartPoints,
    updateUsers,
    addUser,
    deleteUser,
    addMileageReport,
    deleteMileageReport,
    clearMileageReports,
    addRoadMileageReport,
    deleteRoadMileageReport,
    clearRoadMileageReports,
    addTerritoryCalcRun,
    updateTerritoryCalcRun,
    deleteTerritoryCalcRun,
    clearTerritoryCalcRuns,
    setMileageOrderNumbers,
    setRoadTrack,
    toggleTheme,
    routesFromPoints,
    branchesFromPoints,
    colorForRoute,
    saveData,
    resetToDemo,
    importData,
    getRememberedCredentials
  }), [state, currentUser, isAdmin, login, logout, setPage, setMapMode, setSectionRoute, setFilters, toggleRouteFilter, toggleBranchFilter, toggleDayFilter, toggleCycleFilter, clearFilters, togglePointSelection, addPointsToSelection, selectAllVisible, clearSelection, setSelectionMode, updatePoints, addPoints, addPointsFromFiles, deletePointsBySourceFile, deleteAllPoints, updatePolygons, addPolygons, addPolygonsFromFiles, deletePolygonsBySourceFile, deleteAllPolygons, updateStartPoints, deleteAllStartPoints, updateUsers, addUser, deleteUser, addMileageReport, deleteMileageReport, clearMileageReports, addRoadMileageReport, deleteRoadMileageReport, clearRoadMileageReports, addTerritoryCalcRun, updateTerritoryCalcRun, deleteTerritoryCalcRun, clearTerritoryCalcRuns, setMileageOrderNumbers, setRoadTrack, toggleTheme, routesFromPoints, branchesFromPoints, colorForRoute, saveData, resetToDemo, importData, getRememberedCredentials]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}
