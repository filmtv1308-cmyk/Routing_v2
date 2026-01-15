export interface User {
  id: string;
  fullName: string;
  login: string;
  password: string;
  role: 'Admin' | 'User';
  route: string;
}

export interface Point {
  id: string;
  branch: string;
  clientCode: string;
  name: string;
  address: string;
  lon: number;
  lat: number;
  channel: string;
  frequencyCode: string;
  visitMinutes: number | string;
  route: string;
  manager: string;
  leer: string;
  visitDayCode: string;
  sourceFile?: string;
  visitOrderByWeek?: Record<string, number>;
}

export interface Polygon {
  id: string;
  name: string;
  color: string;
  /** Delivery days (codes 1-7) */
  days: string[];
  coords: [number, number][];
  sourceFile?: string;

  /** Optional details imported from API JSON */
  deliveryDaysOffset?: number;
  deliveryDays?: { dayCode: string; from?: string; till?: string }[];
  takeOrderDays?: { dayCode: string; from?: string; till?: string }[];
}

export interface StartPoint {
  id: string;
  route: string;
  address: string;
  lat: number;
  lon: number;
}

export interface MileageReportDay {
  day: string;
  dayCode: string;
  pointsCount: number;
  /** Distance in km */
  distance: number;
  /** Drive time in minutes (legacy field) */
  time: number;
  /** Optional: total visit/service time in minutes */
  serviceMinutes?: number;
  /** Optional: total time = drive + service (minutes) */
  totalMinutes?: number;
  segments: { from: string; to: string; distance: number }[];
}

export interface MileageReportWeek {
  weekNumber: number;
  weekOffset: number;
  cycleCode: string;
  isOdd: boolean;
  totalPoints: number;
  /** Total distance in km */
  totalDistance: number;
  /** Total drive time in minutes (legacy field) */
  totalTime: number;
  /** Optional: total visit/service time in minutes */
  totalServiceMinutes?: number;
  /** Optional: total time = drive + service (minutes) */
  totalMinutes?: number;
  days: MileageReportDay[];
}

export interface MileageReport {
  id: string;
  createdAt: string;
  route: string;
  startPoint: { lat: number; lon: number; address: string };
  totalPoints: number;
  /** Total distance in km */
  totalDistance: number;
  /** Total drive time in minutes (legacy field) */
  totalTime: number;
  /** Optional: total visit/service time in minutes */
  totalServiceMinutes?: number;
  /** Optional: total time = drive + service (minutes) */
  totalMinutes?: number;

  /** Optional meta about how this report was computed */
  scope?: 'territory' | 'section';
  orderMode?: RoadMileageOrderMode;
  orderSaved?: boolean;

  weeklyData: MileageReportWeek[];
  details: (MileageReportDay & { weekNumber: number; weekLabel: string })[];
  filterInfo: {
    weeks: number[];
    days: string[];
    hasWeekFilter: boolean;
    hasDayFilter: boolean;
  };
}

export type RoadMileageOrderMode = 'useExistingAndFill' | 'rebuildNearest';

export interface RoadMileageStop {
  pointId: string;
  clientCode: string;
  name: string;
  lat: number;
  lon: number;
  visitMinutes: number;
}

export interface RoadMileageLeg {
  from: { type: 'start' | 'point'; id?: string; label: string };
  to: { type: 'start' | 'point'; id?: string; label: string };
  distanceKm: number;
  driveMinutes: number;
}

export interface RoadMileageReport {
  /** One report for: route + (day) + (one W-cycle week) */
  id: string;
  createdAt: string;

  calcProvider: 'osrm';
  calcProfile: 'driving';

  route: string;
  dayCode: string; // 1..5
  dayLabel: string;

  /** W-week key ("1".."4") used to read/write visitOrderByWeek */
  weekKey: string;
  isoWeek: number;

  orderMode: RoadMileageOrderMode;
  /** True if the calculated order was persisted into visitOrderByWeek[weekKey] */
  orderSaved: boolean;

  start: { lat: number; lon: number; address: string };
  stops: RoadMileageStop[];

  driveKm: number;
  driveMinutes: number;
  serviceMinutes: number;
  totalMinutes: number;

  legs: RoadMileageLeg[];

  /** Optional track geometry if user enabled it */
  geometry?: {
    type: 'LineString';
    coords: [number, number][]; // [lat, lon]
  };
}

/** Territory calculation run (multi-route, multi-day, multi-week) */
export interface TerritoryCalcStop {
  pointId: string;
  clientCode: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  visitMinutes: number;
}

export interface TerritoryCalcStraightSegment {
  from: string;
  to: string;
  distanceKm: number;
}

export interface TerritoryCalcRoadLeg {
  from: string;
  to: string;
  distanceKm: number;
  driveMinutes: number;
}

export interface TerritoryCalcCombo {
  weekOffset: number;
  isoWeek: number;
  displayWeek: number;
  weekKey: string; // "1".."4"
  dayCode: string; // 1..5
  dayLabel: string;

  orderMode: RoadMileageOrderMode;

  stops: TerritoryCalcStop[];

  straight: {
    distanceKm: number;
    driveMinutes: number;
    serviceMinutes: number;
    totalMinutes: number;
    segments: TerritoryCalcStraightSegment[];
  };

  /** Optional road-based result (computed later for export #3) */
  road?: {
    calcProvider: 'osrm';
    computedAt: string;
    status: 'ok' | 'skipped' | 'error';
    errorMessage?: string;
    driveKm: number;
    driveMinutes: number;
    serviceMinutes: number;
    totalMinutes: number;
    legs: TerritoryCalcRoadLeg[];
  };
}

export interface TerritoryCalcRoute {
  route: string;
  startPoint: { lat: number; lon: number; address: string };
  combos: TerritoryCalcCombo[];
}

export interface TerritoryCalcRun {
  id: string;
  createdAt: string;
  orderMode: RoadMileageOrderMode;
  orderSaved: boolean;

  filtersSnapshot: {
    routes: string[];
    branches: string[];
    days: string[];
    cycleWeeks: Array<number | string>;
  };

  missingStartRoutes: string[];
  routes: TerritoryCalcRoute[];
}

export interface ImportMetaFile {
  fileName: string;
  count: number;
  importedAt: string;
  kind?: 'excel' | 'txt' | 'json';
  color?: string;
}

export interface AppData {
  users: User[];
  points: Point[];
  polygons: Polygon[];
  startPoints: StartPoint[];

  /** Legacy/approx mileage reports (haversine based) */
  mileageReports?: MileageReport[];

  /** New: road-based reports (OSRM in browser) */
  roadMileageReports?: RoadMileageReport[];

  /** New: detailed Territory runs (multi-route) for exporting */
  territoryCalcRuns?: TerritoryCalcRun[];

  importMeta?: {
    pointsFiles?: ImportMetaFile[];
    polygonFiles?: ImportMetaFile[];
  };
}

export interface Session {
  userId: string;
}

export type MapMode = 'territory' | 'section';
export type Page = 'map' | 'stats' | 'admin' | 'backup';
