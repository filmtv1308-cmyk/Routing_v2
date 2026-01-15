export interface OsrmRouteLeg {
  distance: number; // meters
  duration: number; // seconds
}

export interface OsrmRouteResponse {
  routes: Array<{
    distance: number;
    duration: number;
    legs: OsrmRouteLeg[];
    geometry?: {
      coordinates: [number, number][]; // [lon, lat]
      type: 'LineString';
    };
  }>;
}

export async function osrmRoute(params: {
  coords: { lat: number; lon: number }[]; // in visit order
  overview: 'false' | 'simplified' | 'full';
  geometries: 'geojson';
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<OsrmRouteResponse['routes'][number]> {
  const { coords, overview, geometries, timeoutMs = 20000, signal } = params;
  if (coords.length < 2) throw new Error('OSRM route requires at least 2 coords');

  const coordStr = coords.map((c) => `${c.lon},${c.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=${overview}&geometries=${geometries}&steps=false`;

  // Important: timeout must work even when an external AbortSignal is provided.
  // We "merge" signals by aborting our controller when either:
  // - timeout fires
  // - external signal aborts
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const t = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM error: ${res.status}`);
    const json = (await res.json()) as OsrmRouteResponse;
    if (!json.routes || json.routes.length === 0) throw new Error('OSRM: empty routes');
    return json.routes[0];
  } catch (e) {
    // Distinguish timeout from user cancellation.
    if (timedOut) {
      throw new Error(`OSRM timeout (${timeoutMs} ms)`);
    }
    throw e;
  } finally {
    window.clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
