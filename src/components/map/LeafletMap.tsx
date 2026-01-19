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

function makeDivIcon(color: string, orderNumber: number | null = null): L.DivIcon {
  // Numbered markers: slightly larger (+~15%) together with digit
  const size = orderNumber != null ? 17 : 14;
  const fontSize = orderNumber != null ? 9 : 7;
  const html = `
    <div style="position:relative; width:${size}px; height:${size}px;">
      <div style="width:${size}px; height:${size}px; border-radius:${size / 2}px; background:${color}; border:2px solid #ffffff; box-shadow:0 3px 8px rgba(0,0,0,.25)"></div>
      ${orderNumber != null ? `<div style="position:absolute; inset:0; display:grid; place-items:center; color:#fff; font-weight:800; font-size:${fontSize}px; text-shadow:0 1px 2px rgba(0,0,0,0.5);">${orderNumber}</div>` : ''}
    </div>`;
  return L.divIcon({ html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] });
}

function makeStartFlagIcon(color: string): L.DivIcon {
  // Чуть больше, чем кружки точек (14px) — увеличено на 15%
  const size = 23;
  const html = `
    <div style="position:relative; width:${size}px; height:${size}px;">
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 3px 8px rgba(0,0,0,.25));">
        <!-- pole -->
        <path d="M6 3v18" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
        <path d="M6 3v18" stroke="rgba(0,0,0,0.25)" stroke-width="3.6" stroke-linecap="round" opacity="0.35"/>
        <!-- flag -->
        <path d="M7 4c2.5 1.3 4.6 1.3 7 0 2.2-1.2 4.2-1.2 6 0v9c-1.8-1.2-3.8-1.2-6 0-2.4 1.3-4.5 1.3-7 0V4z" fill="${color}" stroke="#ffffff" stroke-width="1.6"/>
        <!-- base -->
        <circle cx="6" cy="21" r="2.2" fill="#ffffff"/>
        <circle cx="6" cy="21" r="1.3" fill="${color}"/>
      </svg>
    </div>`;
  return L.divIcon({
    html,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

export function LeafletMap({ points, polygons, startPoints, onMapReady, onPointClick }: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const polygonLayerRef = useRef<L.LayerGroup | null>(null);
  const startLayerRef = useRef<L.LayerGroup | null>(null);
  const pointsLayerRef = useRef<L.LayerGroup | null>(null);
  const selectionLayerRef = useRef<L.LayerGroup | null>(null);
  const roadTrackLayerRef = useRef<L.LayerGroup | null>(null);
  
  const { mapMode, colorForRoute, mileageOrderNumbers, selection, setSelectionMode, addPointsToSelection, filters, sectionRoute, roadTrack } = useAppContext();

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
  zoomControl: true,
  attributionControl: false,   // ❌ ПОЛНОСТЬЮ УБИРАЕМ НАДПИСИ
  preferCanvas: true,
  renderer: L.canvas(),
  fadeAnimation: false,
  zoomAnimation: false,
  markerZoomAnimation: false,
  inertia: true,
  updateWhenIdle: true,
}).setView([43.2383, 76.9279], 11);
    
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '',
  detectRetina: true,
  updateWhenIdle: true,
  keepBuffer: 8,
  crossOrigin: true,
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

  // Update polygons
  useEffect(() => {
    if (!polygonLayerRef.current) return;
    polygonLayerRef.current.clearLayers();

    const fmtDay = (code: string) => DAY_CODE_TO_LABEL[normalizeDayCode(code)] || code;
    const fmtWindow = (from?: string, till?: string) => {
      if (from && till) return `${from}–${till}`;
      if (from) return `с ${from}`;
      if (till) return `до ${till}`;
      return '';
    };

    for (const poly of polygons) {
      if (!poly.coords || poly.coords.length < 3) continue;
      const color = poly.color || '#78a890';

      const daysLabels = (poly.days || []).map(fmtDay).filter(Boolean);

      const deliveryRows = (poly.deliveryDays && poly.deliveryDays.length > 0)
        ? poly.deliveryDays
            .map(d => ({
              label: fmtDay(d.dayCode),
              window: fmtWindow(d.from, d.till)
            }))
        : daysLabels.map(l => ({ label: l, window: '' }));

      const takeOrderRows = (poly.takeOrderDays && poly.takeOrderDays.length > 0)
        ? poly.takeOrderDays
            .map(d => ({
              label: fmtDay(d.dayCode),
              window: fmtWindow(d.from, d.till)
            }))
        : [];

      const chips = (rows: { label: string; window: string }[]) => {
        if (rows.length === 0) return '<span style="color:#94a3b8">Не указаны</span>';
        return rows
          .map(r => {
            const txt = r.window ? `${r.label} ${r.window}` : r.label;
            return `<span style="background:${color}; color:#fff; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:6px">${txt}</span>`;
          })
          .join('');
      };

      const layer = L.polygon(poly.coords, {
        color,
        weight: 2.5,
        fillColor: color,
        fillOpacity: 0.20,
        opacity: 0.8
      });

      layer.bindPopup(
        `
        <div style="min-width:240px">
          <div style="font-weight:800; font-size:14px; color:${color}; border-bottom:2px solid ${color}; padding-bottom:6px; margin-bottom:8px">
            📍 ${poly.name || 'Зона доставки'}
          </div>

          <div style="font-size:13px">
            <div style="margin-bottom:6px"><b>Дни доставки:</b></div>
            <div style="display:flex; flex-wrap:wrap; gap:4px">
              ${chips(deliveryRows)}
            </div>

            ${typeof poly.deliveryDaysOffset === 'number' ? `
              <div style="margin-top:8px; color:#64748b; font-size:12px">
                <b>Смещение доставки:</b> +${poly.deliveryDaysOffset} дн.
              </div>
            ` : ''}

            ${takeOrderRows.length > 0 ? `
              <div style="margin-top:10px">
                <div style="margin-bottom:6px"><b>Приём заказов:</b></div>
                <div style="display:flex; flex-wrap:wrap; gap:4px">
                  ${chips(takeOrderRows)}
                </div>
              </div>
            ` : ''}

            ${poly.sourceFile ? `
              <div style="margin-top:10px; font-size:11px; color:#94a3b8">Источник: ${poly.sourceFile}</div>
            ` : ''}
          </div>
        </div>
        `,
        { maxWidth: 340 }
      );

      polygonLayerRef.current.addLayer(layer);
    }
  }, [polygons]);

  // Update start points
  useEffect(() => {
    if (!startLayerRef.current) return;
    startLayerRef.current.clearLayers();

    // Показываем старты только для маршрутов, которые реально присутствуют среди отображаемых точек
    const visibleRoutes = new Set(points.map(p => p.route).filter(Boolean));

    for (const sp of startPoints) {
      if (!isFinite(sp.lat) || !isFinite(sp.lon)) continue;
      if (!sp.route || !visibleRoutes.has(sp.route)) continue;

      const color = colorForRoute(sp.route);
      const icon = makeStartFlagIcon(color);
      const m = L.marker([sp.lat, sp.lon], { icon });
      m.bindPopup(`
        <div style="min-width:220px">
          <div style="font-weight:700">🏁 Старт маршрута ${sp.route || ''}</div>
          <div style="margin-top:4px; font-size:12px; color:#64748b">${sp.address || ''}</div>
        </div>
      `);
      startLayerRef.current.addLayer(m);
    }
  }, [startPoints, colorForRoute, points]);

  // Update points
  useEffect(() => {
    if (!pointsLayerRef.current) return;
    const existingMarkers = markersRef.current;
    const visibleIds = new Set<string>();

    // Manual order context (Section mode): show numbers from visitOrderByWeek when day+week selected
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

    for (const p of points) {
      if (!isFinite(p.lat) || !isFinite(p.lon)) continue;
      visibleIds.add(p.id);

      const day = normalizeDayCode(p.visitDayCode);
      const color = mapMode === 'section' && day ? (DAY_COLORS[day] || '#64748b') : colorForRoute(p.route);

      // Prefer mileage order numbers when present; otherwise in manual-order context show W-order
      const manualOrderNum = manualOrderWeekKey ? (p.visitOrderByWeek?.[manualOrderWeekKey] ?? null) : null;
      const orderNum = mileageOrderNumbers?.get(p.id) ?? manualOrderNum;

      let marker = existingMarkers.get(p.id);
      
      if (!marker) {
  marker = L.circleMarker([p.lat, p.lon], {
    radius: orderNum != null ? 6 : 4,
    color: '#ffffff',
    weight: 1,
    fillColor: color,
    fillOpacity: 0.9,
    pane: 'markerPane',
  });

        const freqLabel = getFreqLabelFromCode(p.frequencyCode);
        const dayLabel = day ? (DAY_CODE_TO_LABEL[day] || '') : '';
        marker.on('click', () => {
  const freqLabel = getFreqLabelFromCode(p.frequencyCode);
  const dayLabel = day ? (DAY_CODE_TO_LABEL[day] || '') : '';

  marker.bindPopup(`
    <div style="min-width:250px">
      <div style="font-weight:800; font-size:14px">${p.name || ''}</div>
      <div style="margin-top:4px; font-size:12px; color:#64748b">${p.address || ''}</div>
      <div style="margin-top:8px; font-size:12px">
        <div><b>Код клиента:</b> ${p.clientCode || ''}</div>
        <div><b>Филиал:</b> ${p.branch || ''}</div>
        <div><b>Маршрут:</b> ${p.route || ''}</div>
        <div><b>Канал:</b> ${p.channel || ''}</div>
        ${freqLabel ? `<div><b>Частота:</b> ${freqLabel}</div>` : ''}
        ${dayLabel ? `<div><b>День:</b> ${dayLabel}</div>` : ''}
        ${p.visitMinutes ? `<div><b>Время на посещение:</b> ${p.visitMinutes} мин</div>` : ''}
        ${p.manager ? `<div><b>Менеджер:</b> ${p.manager}</div>` : ''}
        ${p.leer ? `<div><b>Леер:</b> ${p.leer}</div>` : ''}
      </div>
    </div>
  `);

  marker.openPopup();
  onPointClick?.(p.id);
});

        // Click on marker: scroll list to point
        marker.on('click', () => {
          onPointClick?.(p.id);
        });

        existingMarkers.set(p.id, marker);
        pointsLayerRef.current.addLayer(marker);
      } else {
  (marker as L.CircleMarker).setStyle({
    fillColor: color,
    radius: orderNum != null ? 6 : 4,
  });
        if (!pointsLayerRef.current.hasLayer(marker)) {
          pointsLayerRef.current.addLayer(marker);
        }
      }
    }

    // Remove markers no longer visible
    for (const [id, marker] of existingMarkers) {
      if (!visibleIds.has(id)) {
        pointsLayerRef.current.removeLayer(marker);
        existingMarkers.delete(id);
      }
    }
  }, [points, mapMode, colorForRoute, mileageOrderNumbers, filters.cycleWeeks, filters.days, sectionRoute, onPointClick]);

  // Update road track (polyline)
  useEffect(() => {
    if (!roadTrackLayerRef.current) return;
    roadTrackLayerRef.current.clearLayers();
    if (!roadTrack) return;
    if (!roadTrack.coords || roadTrack.coords.length < 2) return;

    const poly = L.polyline(roadTrack.coords, {
      color: roadTrack.color || '#22c55e',
      weight: 4,
      opacity: 0.95
    });
    roadTrackLayerRef.current.addLayer(poly);

    // keep it visible but don't steal focus; user can still fit/zoom manually
  }, [roadTrack]);

  // Selection tools
  const handleLasso = useCallback(() => {
    if (!mapRef.current || !selectionLayerRef.current) return;
    setSelectionMode('lasso');
    mapRef.current.dragging.disable();
    mapRef.current.getContainer().style.cursor = 'crosshair';
    selectionLayerRef.current.clearLayers();
  }, [setSelectionMode]);

  const handleRectangle = useCallback(() => {
    if (!mapRef.current || !selectionLayerRef.current) return;
    setSelectionMode('rectangle');
    mapRef.current.dragging.disable();
    mapRef.current.getContainer().style.cursor = 'crosshair';
    selectionLayerRef.current.clearLayers();
  }, [setSelectionMode]);

  const cancelSelection = useCallback(() => {
    if (!mapRef.current) return;
    setSelectionMode(null);
    mapRef.current.dragging.enable();
    mapRef.current.getContainer().style.cursor = '';
    selectionLayerRef.current?.clearLayers();
  }, [setSelectionMode]);

  // Selection drawing handlers
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    
    let isDrawing = false;
    let startLatLng: L.LatLng | null = null;
    let currentShape: L.Polygon | L.Rectangle | null = null;
    const drawingPoints: [number, number][] = [];

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      if (!selection.mode) return;
      isDrawing = true;
      startLatLng = e.latlng;
      drawingPoints.length = 0;
      drawingPoints.push([e.latlng.lat, e.latlng.lng]);

      if (selection.mode === 'rectangle') {
        const b = L.latLngBounds(e.latlng, e.latlng);
        currentShape = L.rectangle(b, {
          color: '#2196F3',
          weight: 2,
          fillOpacity: 0.2
        }).addTo(selectionLayerRef.current!);
      } else if (selection.mode === 'lasso') {
        currentShape = L.polyline([e.latlng], {
          color: '#2196F3',
          weight: 2
        }).addTo(selectionLayerRef.current!) as unknown as L.Polygon;
      }
    };

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!isDrawing || !selection.mode || !currentShape) return;

      if (selection.mode === 'rectangle' && startLatLng) {
        (currentShape as L.Rectangle).setBounds(L.latLngBounds(startLatLng, e.latlng));
      } else if (selection.mode === 'lasso') {
        drawingPoints.push([e.latlng.lat, e.latlng.lng]);
        (currentShape as unknown as L.Polyline).addLatLng(e.latlng);
      }
    };

    const onMouseUp = (e: L.LeafletMouseEvent) => {
      if (!isDrawing || !selection.mode) return;
      isDrawing = false;

      if (selection.mode === 'rectangle' && startLatLng) {
        const bounds = L.latLngBounds([startLatLng.lat, startLatLng.lng], [e.latlng.lat, e.latlng.lng]);
        const ids: string[] = [];
        for (const p of points) {
          if (isFinite(p.lat) && isFinite(p.lon) && bounds.contains([p.lat, p.lon])) {
            ids.push(p.id);
          }
        }
        addPointsToSelection(ids);
      } else if (selection.mode === 'lasso') {
        drawingPoints.push([e.latlng.lat, e.latlng.lng]);
        if (drawingPoints.length > 2) {
          drawingPoints.push(drawingPoints[0]);
          const ids: string[] = [];
          for (const p of points) {
            if (isFinite(p.lat) && isFinite(p.lon) && pointInPolygon([p.lat, p.lon], drawingPoints)) {
              ids.push(p.id);
            }
          }
          addPointsToSelection(ids);
        }
      }

      cancelSelection();
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
    };
  }, [selection.mode, points, addPointsToSelection, cancelSelection, filters.cycleWeeks, filters.days, mapMode, sectionRoute]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selection.mode) {
        cancelSelection();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selection.mode, cancelSelection]);

  return (
    <div className="relative h-full w-full rm-map">
      <div ref={mapContainerRef} className="h-full w-full" />
      
      {/* Selection tools */}
      <div className="absolute top-3 right-3 bg-white/90 border border-slate-200 rounded-2xl shadow px-3 py-2 text-xs z-[1000]">
        <div className="font-semibold mb-1 text-slate-900">Выделение</div>
        <div className="flex gap-1">
          <button
            onClick={handleLasso}
            className={`px-2 py-1 rounded border border-slate-300 hover:bg-slate-100 ${
              selection.mode === 'lasso' ? 'bg-sky-500 text-white' : ''
            }`}
            title="Лассо - обвести область"
          >
            🔷
          </button>
          <button
            onClick={handleRectangle}
            className={`px-2 py-1 rounded border border-slate-300 dark:border-white/20 hover:bg-slate-100 dark:hover:bg-white/10 ${
              selection.mode === 'rectangle' ? 'bg-sky-500 text-white' : ''
            }`}
            title="Прямоугольник - выделить область"
          >
            ▢
          </button>
        </div>
      </div>
    </div>
  );
}
