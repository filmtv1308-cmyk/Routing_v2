import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import L from 'leaflet';
import { useAppContext } from '@/store/AppContext';
import { MapFilters } from '@/components/map/MapFilters';
import { PointsList } from '@/components/map/PointsList';
import { LeafletMap } from '@/components/map/LeafletMap';
import { Point } from '@/types';
import { normalizeDayCode, getISOWeekNumber, pointMatchesCycleWeek } from '@/utils/helpers';

export function MapPage() {
  const {
    data,
    mapMode,
    sectionRoute,
    filters,
    currentUser,
    selection
  } = useAppContext();

  const PANEL_WIDTH_KEY = 'rm_map_panel_width_v1';

  const clampPanelWidth = (w: number) => {
    const min = 280;
    const max = Math.floor(window.innerWidth * 0.55);
    if (!Number.isFinite(w)) return 350;
    return Math.max(min, Math.min(max, Math.floor(w)));
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(PANEL_WIDTH_KEY);
      const n = raw != null ? Number(raw) : 350;
      return clampPanelWidth(n || 350);
    } catch {
      return 350;
    }
  });
  const panelWidthRef = useRef(panelWidth);
  const [scrollToPointId, setScrollToPointId] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const isResizingRef = useRef(false);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  // Filter points
  const filteredPoints = useMemo(() => {
    let points = data.points;
    const user = currentUser();

    // User role filter
    if (user?.role === 'User' && user.route) {
      points = points.filter(p => p.route === user.route);
    }

    // Section mode - single route
    if (mapMode === 'section' && sectionRoute) {
      points = points.filter(p => p.route === sectionRoute);
    } else {
      // Territory mode - multiple routes
      if (filters.routes.size > 0) {
        points = points.filter(p => filters.routes.has(p.route));
      }
      // Branch filter
      if (filters.branches.size > 0) {
        points = points.filter(p => filters.branches.has(p.branch));
      }
    }

    // Day filter
    if (filters.days.size > 0) {
      points = points.filter(p => {
        const dayCode = normalizeDayCode(p.visitDayCode);
        return dayCode && filters.days.has(dayCode);
      });
    }

    // Cycle filter
    if (filters.cycleWeeks.size > 0) {
      const hasZeroFilter = filters.cycleWeeks.has('Z0');
      const weekOffsets = [...filters.cycleWeeks].filter(x => x !== 'Z0') as number[];
      const today = new Date();
      const currentISOWeek = getISOWeekNumber(today);

      if (hasZeroFilter && weekOffsets.length === 0) {
        points = points.filter(p => p.frequencyCode === '0');
      } else {
        points = points.filter(p => {
          for (const weekOffset of weekOffsets) {
            const targetISOWeek = currentISOWeek + weekOffset;
            if (pointMatchesCycleWeek(p.frequencyCode, targetISOWeek)) return true;
          }
          if (hasZeroFilter && p.frequencyCode === '0') return true;
          return false;
        });
      }
    }

    // Search
    if (searchQuery.trim()) {
      const separatorRegex = /[\s,;]+/;
      const parts = searchQuery.trim().split(separatorRegex).map(s => s.trim()).filter(Boolean);

      if (parts.length > 1) {
        const codesToFind = new Set(parts.slice(0, 100).map(c => c.toLowerCase()));
        points = points.filter(p => codesToFind.has((p.clientCode || '').toLowerCase()));
      } else {
        const q = searchQuery.toLowerCase();
        points = points.filter(p =>
          (p.clientCode || '').toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q) ||
          (p.address || '').toLowerCase().includes(q)
        );
      }
    }

    // If in Section mode with one day + one week selected => sort by manual order W1..W4
    const manualOrderWeekKey = (() => {
      if (mapMode !== 'section') return null;
      if (!sectionRoute) return null;
      if (filters.days.size !== 1) return null;
      if (filters.cycleWeeks.size !== 1) return null;
      if (filters.cycleWeeks.has('Z0')) return null;
      const only = Array.from(filters.cycleWeeks)[0];
      if (typeof only !== 'number') return null;
      const d = new Date();
      d.setDate(d.getDate() + only * 7);
      const isoWeek = getISOWeekNumber(d);
      const w = ((isoWeek - 1) % 4) + 1;
      return String(w);
    })();

    if (manualOrderWeekKey) {
      points = points.slice().sort((a, b) => {
        const oa = a.visitOrderByWeek?.[manualOrderWeekKey];
        const ob = b.visitOrderByWeek?.[manualOrderWeekKey];
        const na = typeof oa === 'number' && Number.isFinite(oa) ? oa : Number.POSITIVE_INFINITY;
        const nb = typeof ob === 'number' && Number.isFinite(ob) ? ob : Number.POSITIVE_INFINITY;
        if (na === nb) return 0;
        return na < nb ? -1 : 1;
      });
    }

    // Put selected points first (after manual sort)
    if (selection.selectedIds.size > 0 && points.length > 1) {
      const selected: Point[] = [];
      const rest: Point[] = [];
      for (const p of points) {
        (selection.selectedIds.has(p.id) ? selected : rest).push(p);
      }
      points = [...selected, ...rest];
    }

    return points;
  }, [data.points, mapMode, sectionRoute, filters, searchQuery, currentUser, selection.selectedIds]);

  const handlePointClick = useCallback((point: Point) => {
    if (mapRef.current) {
      mapRef.current.setView([point.lat, point.lon], 16, { animate: true });
    }
    // also scroll list to this point
    setScrollToPointId(point.id);
  }, []);

  const handleMapPointClick = useCallback((pointId: string) => {
    setScrollToPointId(pointId);
  }, []);

  const handleFitAll = useCallback(() => {
    if (!mapRef.current || filteredPoints.length === 0) return;
    const pts = filteredPoints.filter(p => isFinite(p.lat) && isFinite(p.lon));
    if (pts.length === 0) return;
    const bounds = L.latLngBounds(pts.map(p => [p.lat, p.lon] as [number, number]));
    mapRef.current.fitBounds(bounds.pad(0.1));
  }, [filteredPoints]);

  const handleMapReady = useCallback((map: L.Map) => {
    mapRef.current = map;
  }, []);

  // Resizer
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = clampPanelWidth(e.clientX - 64);
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // persist width
        try {
          localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidthRef.current));
        } catch {
          // ignore
        }

        setTimeout(() => mapRef.current?.invalidateSize(), 100);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Keep width valid on window resize and persist the clamped value
  useEffect(() => {
    const onResize = () => {
      setPanelWidth((w) => {
        const next = clampPanelWidth(w);
        try {
          localStorage.setItem(PANEL_WIDTH_KEY, String(next));
        } catch {
          // ignore
        }
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Side panel */}
      <div
        className="flex flex-col border-r border-slate-200/80 dark:border-white/10 bg-white/60 dark:bg-white/6"
        style={{ width: panelWidth, minWidth: 280 }}
      >
        <MapFilters
          filteredPoints={filteredPoints}
          onSearch={setSearchQuery}
          searchQuery={searchQuery}
          onFitAll={handleFitAll}
        />
        <PointsList points={filteredPoints} onPointClick={handlePointClick} scrollToPointId={scrollToPointId} />
      </div>

      {/* Resizer */}
      <div
        className="w-2 cursor-col-resize bg-transparent hover:bg-[#2196F3] transition-colors flex-shrink-0"
        onMouseDown={handleResizeStart}
      />

      {/* Map */}
      <div className="flex-1 min-w-0 relative">
        <LeafletMap
          points={filteredPoints}
          polygons={data.polygons}
          startPoints={data.startPoints}
          onMapReady={handleMapReady}
          onPointClick={handleMapPointClick}
        />
      </div>
    </div>
  );
}
