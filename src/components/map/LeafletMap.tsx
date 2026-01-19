import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { Point, Polygon as PolygonType, StartPoint } from '@/types';
import { useAppContext } from '@/store/AppContext';
import { DAY_CODE_TO_LABEL, DAY_COLORS } from '@/constants';
import { normalizeDayCode, getFreqLabelFromCode, pointInPolygon, getISOWeekNumber } from '@/utils/helpers';

interface LeafletMapProps {
  points: Point[];
  polygons: PolygonType[];
  startPoints: StartPoint[];
  onMapReady?: (map: L.Map) => void;
  onPointClick?: (pointId: string) => void;
}

/* ===================== ИКОНКИ ТОЧЕК ===================== */

function makeDivIcon(color: string, orderNumber: number | null = null): L.DivIcon {
  // 🔥 ОПТИМАЛЬНЫЙ РАЗМЕР КАК РАНЬШЕ
  const size = orderNumber != null ? 22 : 18;
  const fontSize = orderNumber != null ? 11 : 9;

  const html = `
    <div style="position:relative; width:${size}px; height:${size}px;">
      <div style="
        width:${size}px;
        height:${size}px;
        border-radius:${size / 2}px;
        background:${color};
        border:2px solid #ffffff;
        box-shadow:0 2px 6px rgba(0,0,0,.25)
      "></div>

      ${
        orderNumber != null
          ? `<div style="
              position:absolute;
              inset:0;
              display:flex;
              align-items:center;
              justify-content:center;
              color:#fff;
              font-weight:800;
              font-size:${fontSize}px;
              text-shadow:0 1px 2px rgba(0,0,0,0.6);
            ">${orderNumber}</div>`
          : ''
      }
    </div>
  `;

  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/* ===================== ФЛАГ СТАРТА ===================== */

function makeStartFlagIcon(color: string): L.DivIcon {
  const size = 22;

  const html = `
    <div style="width:${size}px; height:${size}px;">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24">
        <path d="M6 3v18" stroke="#fff" stroke-width="2"/>
        <path d="M7 4c2.5 1.3 4.6 1.3 7 0 2.2-1.2 4.2-1.2 6 0v9c-1.8-1.2-3.8-1.2-6 0-2.4 1.3-4.5 1.3-7 0V4z"
              fill="${color}" stroke="#fff" stroke-width="1.4"/>
      </svg>
    </div>
  `;

  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/* ===================== КОМПОНЕНТ ===================== */

export function LeafletMap({ points, polygons, startPoints, onMapReady, onPointClick }: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const markersRef = useRef<Map<string, L.Marker>>(new Map());

  const polygonLayerRef = useRef<L.LayerGroup | null>(null);
  const startLayerRef = useRef<L.LayerGroup | null>(null);
  const pointsLayerRef = useRef<L.LayerGroup | null>(null);
  const selectionLayerRef = useRef<L.LayerGroup | null>(null);
  const roadTrackLayerRef = useRef<L.LayerGroup | null>(null);

  const {
    mapMode,
    colorForRoute,
    mileageOrderNumbers,
    selection,
    setSelectionMode,
    addPointsToSelection,
    filters,
    sectionRoute,
    roadTrack,
  } = useAppContext();

  /* ===================== ИНИЦИАЛИЗАЦИЯ КАРТЫ ===================== */

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,

      // 🔥 КРИТИЧНО ДЛЯ СКОРОСТИ
      preferCanvas: false,          // DivIcon быстрее в DOM
      fadeAnimation: false,
      zoomAnimation: false,
      markerZoomAnimation: false,
      inertia: true,
      updateWhenIdle: true,
    }).setView([43.2383, 76.9279], 11);

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      detectRetina: false,   // ❌ не грузим двойные тайлы
      keepBuffer: 2,        // ❌ минимальный буфер
      updateWhenIdle: true,
      attribution: '',
    });

    osm.addTo(map);

    pointsLayerRef.current = L.layerGroup().addTo(map);
    polygonLayerRef.current = L.layerGroup().addTo(map);
    startLayerRef.current = L.layerGroup().addTo(map);
    selectionLayerRef.current = L.layerGroup().addTo(map);
    roadTrackLayerRef.current = L.layerGroup().addTo(map);

    mapRef.current = map;
    onMapReady?.(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [onMapReady]);

  /* ===================== ПОЛИГОНЫ ===================== */

  useEffect(() => {
    if (!polygonLayerRef.current) return;
    polygonLayerRef.current.clearLayers();

    for (const poly of polygons) {
      if (!poly.coords || poly.coords.length < 3) continue;

      const color = poly.color || '#78a890';

      const layer = L.polygon(poly.coords, {
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.2,
      });

      polygonLayerRef.current.addLayer(layer);
    }
  }, [polygons]);

  /* ===================== СТАРТ ТОЧКИ ===================== */

  useEffect(() => {
    if (!startLayerRef.current) return;
    startLayerRef.current.clearLayers();

    const visibleRoutes = new Set(points.map(p => p.route).filter(Boolean));

    for (const sp of startPoints) {
      if (!isFinite(sp.lat) || !isFinite(sp.lon)) continue;
      if (!sp.route || !visibleRoutes.has(sp.route)) continue;

      const icon = makeStartFlagIcon(colorForRoute(sp.route));
      const m = L.marker([sp.lat, sp.lon], { icon });

      startLayerRef.current.addLayer(m);
    }
  }, [startPoints, colorForRoute, points]);

  /* ===================== ТОЧКИ (ГЛАВНОЕ) ===================== */

  useEffect(() => {
    if (!pointsLayerRef.current) return;

    const existing = markersRef.current;
    const visibleIds = new Set<string>();

    // Контекст нумерации в секциях
    const manualOrderWeekKey = (() => {
      if (mapMode !== 'section') return null;
      if (!sectionRoute) return null;
      if (filters.days.size !== 1) return null;
      if (filters.cycleWeeks.size !== 1) return null;

      const only = Array.from(filters.cycleWeeks)[0];
      if (typeof only !== 'number') return null;

      const d = new Date();
      d.setDate(d.getDate() + only * 7);
      const isoWeek = getISOWeekNumber(d);
      const w = ((isoWeek - 1) % 4) + 1;

      return String(w);
    })();

    for (const p of points) {
      if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
      visibleIds.add(p.id);

      const day = normalizeDayCode(p.visitDayCode);
      const color =
        mapMode === 'section' && day
          ? DAY_COLORS[day] || '#64748b'
          : colorForRoute(p.route);

      const manualOrderNum = manualOrderWeekKey
        ? p.visitOrderByWeek?.[manualOrderWeekKey] ?? null
        : null;

      const orderNum = mileageOrderNumbers?.get(p.id) ?? manualOrderNum;

      let marker = existing.get(p.id);

      if (!marker) {
        const icon = makeDivIcon(color, orderNum);

        marker = L.marker([p.lat, p.lon], { icon });

        marker.on('click', () => {
          onPointClick?.(p.id);
        });

        existing.set(p.id, marker);
        pointsLayerRef.current.addLayer(marker);
      } else {
        marker.setIcon(makeDivIcon(color, orderNum));

        if (!pointsLayerRef.current.hasLayer(marker)) {
          pointsLayerRef.current.addLayer(marker);
        }
      }
    }

    // удаляем старые
    for (const [id, marker] of existing) {
      if (!visibleIds.has(id)) {
        pointsLayerRef.current.removeLayer(marker);
        existing.delete(id);
      }
    }
  }, [
    points,
    mapMode,
    colorForRoute,
    mileageOrderNumbers,
    filters.cycleWeeks,
    filters.days,
    sectionRoute,
    onPointClick,
  ]);

  /* ===================== ТРЕК ===================== */

  useEffect(() => {
    if (!roadTrackLayerRef.current) return;
    roadTrackLayerRef.current.clearLayers();

    if (!roadTrack?.coords || roadTrack.coords.length < 2) return;

    const poly = L.polyline(roadTrack.coords, {
      color: roadTrack.color || '#22c55e',
      weight: 4,
      opacity: 0.9,
    });

    roadTrackLayerRef.current.addLayer(poly);
  }, [roadTrack]);

  /* ===================== ВЫДЕЛЕНИЕ ===================== */

  const handleLasso = useCallback(() => {
    if (!mapRef.current || !selectionLayerRef.current) return;
    setSelectionMode('lasso');
    mapRef.current.dragging.disable();
    selectionLayerRef.current.clearLayers();
  }, [setSelectionMode]);

  const handleRectangle = useCallback(() => {
    if (!mapRef.current || !selectionLayerRef.current) return;
    setSelectionMode('rectangle');
    mapRef.current.dragging.disable();
    selectionLayerRef.current.clearLayers();
  }, [setSelectionMode]);

  const cancelSelection = useCallback(() => {
    if (!mapRef.current) return;
    setSelectionMode(null);
    mapRef.current.dragging.enable();
    selectionLayerRef.current?.clearLayers();
  }, [setSelectionMode]);

  /* ===================== UI ===================== */

  return (
    <div className="relative h-full w-full rm-map">
      <div ref={mapContainerRef} className="h-full w-full" />

      <div className="absolute top-3 right-3 bg-white/90 border border-slate-200 rounded-xl shadow px-3 py-2 text-xs z-[1000]">
        <div className="font-semibold mb-1 text-slate-900">Выделение</div>
        <div className="flex gap-1">
          <button onClick={handleLasso}>🔷</button>
          <button onClick={handleRectangle}>▢</button>
        </div>
      </div>
    </div>
  );
}