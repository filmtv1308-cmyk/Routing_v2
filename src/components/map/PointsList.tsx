import { useEffect, useMemo, useRef, useState } from 'react';
import { Point } from '@/types';
import { useAppContext } from '@/store/AppContext';
import { DAY_CODE_TO_LABEL } from '@/constants';
import { getISOWeekNumber, normalizeDayCode, normalizeFreqCode } from '@/utils/helpers';

interface PointsListProps {
  points: Point[];
  onPointClick: (point: Point) => void;
  scrollToPointId?: string | null;
}

function getManualOrderWeekKey(cycleWeeks: Set<number | string>): string | null {
  if (cycleWeeks.size !== 1) return null;
  const only = Array.from(cycleWeeks)[0];
  if (typeof only !== 'number') return null;

  // Важно: корректно работаем на границе года (52/53 неделя) — считаем неделю от даты today + offset*7
  const d = new Date();
  d.setDate(d.getDate() + only * 7);
  const isoWeek = getISOWeekNumber(d); // 1..52/53

  // W1 = 1-я неделя года, далее по 4-недельному циклу
  const w = ((isoWeek - 1) % 4) + 1; // 1..4
  return String(w);
}

export function PointsList({ points, onPointClick, scrollToPointId }: PointsListProps) {
  const {
    data,
    mapMode,
    sectionRoute,
    filters,
    selection,
    togglePointSelection,
    colorForRoute,
    updatePoints,
    setMileageOrderNumbers
  } = useAppContext();

  const manualOrderWeekKey = useMemo(() => getManualOrderWeekKey(filters.cycleWeeks), [filters.cycleWeeks]);
  const isManualOrderContext =
    mapMode === 'section' &&
    !!sectionRoute &&
    filters.days.size === 1 &&
    !!manualOrderWeekKey &&
    !filters.cycleWeeks.has('Z0');

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    if (!scrollToPointId) return;
    const el = rowRefs.current.get(scrollToPointId);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlashId(scrollToPointId);
      const t = window.setTimeout(() => setFlashId((prev) => (prev === scrollToPointId ? null : prev)), 900);
      return () => window.clearTimeout(t);
    }
  }, [scrollToPointId, points.length]);

  const applyOrderForVisible = (orderedIds: string[]) => {
    if (!isManualOrderContext || !manualOrderWeekKey) return;

    const orderById = new Map<string, number>();
    for (let i = 0; i < orderedIds.length; i++) {
      orderById.set(orderedIds[i], i + 1);
    }

    const updated = data.points.map((p) => {
      const nextOrder = orderById.get(p.id);
      if (nextOrder == null) return p;
      return {
        ...p,
        visitOrderByWeek: {
          ...(p.visitOrderByWeek || {}),
          [manualOrderWeekKey]: nextOrder
        }
      };
    });

    updatePoints(updated);
    // если ранее был расчёт пробега — его номера нужно сбросить, чтобы сразу видеть W-порядок
    setMileageOrderNumbers(null);
  };

  const moveOneStep = (pointId: string, dir: -1 | 1) => {
    if (!isManualOrderContext) return;
    const ids = points.map((p) => p.id);
    const idx = ids.indexOf(pointId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= ids.length) return;
    const next = ids.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    applyOrderForVisible(next);
  };

  const onDropReorder = (targetId: string) => {
    if (!isManualOrderContext) return;
    if (!draggedId) return;
    if (draggedId === targetId) return;

    const ids = points.map((p) => p.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;

    const next = ids.slice();
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    applyOrderForVisible(next);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {isManualOrderContext && manualOrderWeekKey && (
        <div className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300/70 border-b border-slate-200 dark:border-white/10">
          Ручной порядок посещения активен: <b>W{manualOrderWeekKey}</b> (задаётся для выбранной недели и дня)
        </div>
      )}

      {points.map((p) => {
        const isSelected = selection.selectedIds.has(p.id);
        const dayLabel = DAY_CODE_TO_LABEL[normalizeDayCode(p.visitDayCode)] || '';
        const routeColor = colorForRoute(p.route);
        const freqCode = normalizeFreqCode(p.frequencyCode);
        const freqShort = freqCode ? `(${freqCode})` : '';
        const orderNumber = isManualOrderContext && manualOrderWeekKey
          ? (p.visitOrderByWeek?.[manualOrderWeekKey] ?? null)
          : null;

        return (
          <div
            key={p.id}
            ref={(el) => {
              rowRefs.current.set(p.id, el);
            }}
            draggable={isManualOrderContext}
            onDragStart={(e) => {
              if (!isManualOrderContext) return;
              setDraggedId(p.id);
              e.dataTransfer.effectAllowed = 'move';
              // чтобы курсор был "move" везде
              try { e.dataTransfer.setData('text/plain', p.id); } catch { /* noop */ }
            }}
            onDragEnd={() => {
              setDraggedId(null);
              setDragOverId(null);
            }}
            onDragOver={(e) => {
              if (!isManualOrderContext) return;
              e.preventDefault();
              setDragOverId(p.id);
            }}
            onDragLeave={() => {
              if (!isManualOrderContext) return;
              setDragOverId((prev) => (prev === p.id ? null : prev));
            }}
            onDrop={(e) => {
              if (!isManualOrderContext) return;
              e.preventDefault();
              onDropReorder(p.id);
              setDragOverId(null);
            }}
            onClick={() => onPointClick(p)}
            className={`h-[76px] mx-1.5 my-0.5 rounded-xl border px-2.5 py-1.5 shadow-sm cursor-pointer transition-colors ${
              isSelected
                ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20'
                : 'border-slate-200 dark:border-white/10 bg-white/90 dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10'
            } ${isManualOrderContext && dragOverId === p.id ? 'ring-2 ring-sky-400/70' : ''} ${flashId === p.id ? 'ring-2 ring-amber-400' : ''}`}
            title={isManualOrderContext ? 'Перетащите карточку, чтобы изменить порядок' : ''}
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  togglePointSelection(p.id);
                }}
                className="w-4 h-4 rounded accent-sky-500 shrink-0"
              />

              {isManualOrderContext && (
                <div
                  className="w-5 h-5 rounded-md grid place-items-center text-[9px] font-extrabold text-white shrink-0"
                  style={{ background: routeColor }}
                  title={orderNumber ? `Порядок: ${orderNumber}` : 'Порядок не задан'}
                >
                  {orderNumber ?? '—'}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[13px] font-semibold truncate leading-tight text-slate-900 dark:text-white">
                    {p.name || ''}
                  </div>
                  <div
                    className="shrink-0 text-[10px] px-2 py-0.5 rounded-full text-white"
                    style={{ background: routeColor }}
                  >
                    {p.route || '—'}
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate leading-tight mt-0.5">
                  {p.address || ''}
                </div>
              </div>

              {isManualOrderContext && (
                <div className="ml-1 flex flex-col gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveOneStep(p.id, -1);
                    }}
                    className="text-[10px] px-1 rounded border border-slate-200 dark:border-white/20 hover:bg-slate-100 dark:hover:bg-white/10"
                    title="Поднять на 1"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveOneStep(p.id, 1);
                    }}
                    className="text-[10px] px-1 rounded border border-slate-200 dark:border-white/20 hover:bg-slate-100 dark:hover:bg-white/10"
                    title="Опустить на 1"
                  >
                    ▼
                  </button>
                </div>
              )}
            </div>

            <div className="mt-1 flex items-center gap-1 ml-6 overflow-hidden whitespace-nowrap">
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 font-mono text-slate-700 dark:text-slate-300">
                {p.clientCode || ''}
              </span>
              {p.channel && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                  {p.channel}
                </span>
              )}
              {p.visitMinutes && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300">
                  {p.visitMinutes} мин
                </span>
              )}
              {freqCode && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                  {freqShort}
                </span>
              )}
              {dayLabel && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300">
                  {dayLabel}
                </span>
              )}
              {isManualOrderContext && manualOrderWeekKey && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300">
                  W{manualOrderWeekKey}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
