(function () {
  const WATER_MASK_PATH = "data/water-mask-san-diego.geojson?v=ca-coast-monterey-1";
  const MAPTILER_WATER_LAYER_ID = "Water";
  const WAVE_SESSION_KEY = "divepro-ca-wave-manifest-v7";
  const M_TO_FT = 3.280839895;
  const WAVE_STEP = 1.2;
  const SECONDARY_MIN_FT = 0.3;
  const DISTINCT_HEADING_DEG = 28;
  const SAME_TRAIN_DEG = 12;
  const PRIMARY_PARTICLE_COUNT = 170;
  const SECONDARY_PARTICLE_COUNT = 150;
  const WAVE_PARTICLE_SPEED = 0.00014;
  const WAVE_PARTICLE_REFERENCE_ZOOM = 8.5;
  const MARINE_HOURLY = [
    "wave_height",
    "wave_direction",
    "wave_period",
    "swell_wave_height",
    "swell_wave_direction",
    "swell_wave_period",
    "secondary_swell_wave_height",
    "secondary_swell_wave_direction",
    "secondary_swell_wave_period",
    "wind_wave_height",
    "wind_wave_direction",
    "wind_wave_period",
  ].join(",");
  const FORECAST_DAYS = 10;
  const FORECAST_HOURS = FORECAST_DAYS * 24;
  const NOW_FRAME_TOLERANCE_MS = 90 * 60 * 1000;
  const CA_BOUNDS = [
    [-123.8, 31.2],
    [-115.4, 38.0],
  ];
  const WAVE_BBOX = {
    west: CA_BOUNDS[0][0] - 1.4,
    south: CA_BOUNDS[0][1] - 0.8,
    east: CA_BOUNDS[1][0] + 0.8,
    north: CA_BOUNDS[1][1] + 0.8,
  };

  function ensureStylesheet() {
    if (document.querySelector('link[data-divepro-ocean-layers]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "ocean-layers.css?v=no-region-rose-1";
    link.setAttribute("data-divepro-ocean-layers", "1");
    document.head.appendChild(link);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function compassFromDegrees(degrees) {
    const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return points[Math.round(degrees / 22.5) % points.length];
  }

  function angularDistanceDeg(a, b) {
    return Math.min((a - b + 360) % 360, (b - a + 360) % 360);
  }

  function metersToFeet(meters) {
    const value = Number(meters);
    return Number.isFinite(value) ? value * M_TO_FT : null;
  }

  function finiteOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  /* Meteorological coming-from → going-to u (east) / v (north), same as wind particles. */
  function uvFromComingFrom(speed, directionDeg) {
    const magnitude = Number(speed);
    const direction = Number(directionDeg);
    if (!Number.isFinite(magnitude) || !Number.isFinite(direction)) return { u: null, v: null };
    const radians = (direction * Math.PI) / 180;
    return { u: -magnitude * Math.sin(radians), v: -magnitude * Math.cos(radians) };
  }

  function readHourlyTrain(hourly, timeIndex, prefixes) {
    for (const prefix of prefixes) {
      const heightFt = metersToFeet(hourly[`${prefix}_height`]?.[timeIndex]);
      const direction = finiteOrNull(hourly[`${prefix}_direction`]?.[timeIndex]);
      const period = finiteOrNull(hourly[`${prefix}_period`]?.[timeIndex]);
      if (Number.isFinite(heightFt) && Number.isFinite(direction)) {
        return { heightFt, direction, period };
      }
    }
    return { heightFt: null, direction: null, period: null };
  }

  function trainVisualSpeed(train) {
    if (!train || !Number.isFinite(train.heightFt) || !Number.isFinite(train.direction)) return null;
    const period = Number.isFinite(train.period) ? train.period : 8;
    const heightFactor = 0.85 + clamp(train.heightFt / 10, 0, 1) * 0.45;
    return (2.1 * heightFactor * 8) / Math.max(5.5, period);
  }

  function emptyTrain() {
    return { heightFt: null, direction: null, period: null };
  }

  function trainScore(train) {
    return (Number.isFinite(train.period) ? train.period : 0) * 8 + (train.heightFt || 0);
  }

  /* CA west coast: NE–SE coming-from is land-side, not a Pacific swell. */
  function isEasterlyComingFrom(degrees) {
    const heading = Number(degrees);
    return Number.isFinite(heading) && angularDistanceDeg(heading, 90) < 50;
  }

  /* Open-Meteo swaps swell_wave vs secondary_swell labels across neighboring
     cells. Cluster swell_* first so interpolation does not average two trains
     into one. Add wind-sea only when it is a distinct west-origin heading. */
  function pickTrains(hourly, timeIndex) {
    const swell = readHourlyTrain(hourly, timeIndex, ["swell_wave"]);
    const secondarySwell = readHourlyTrain(hourly, timeIndex, ["secondary_swell_wave"]);
    const windWave = readHourlyTrain(hourly, timeIndex, ["wind_wave"]);
    const combined = readHourlyTrain(hourly, timeIndex, ["wave"]);
    const swellLike = [swell, secondarySwell].filter((train) => (
      Number.isFinite(train?.heightFt) && Number.isFinite(train?.direction)
    ));
    const unique = [];
    swellLike.forEach((train) => {
      const twinIndex = unique.findIndex((other) => (
        angularDistanceDeg(other.direction, train.direction) < SAME_TRAIN_DEG
      ));
      if (twinIndex < 0) {
        unique.push(train);
        return;
      }
      if (trainScore(train) > trainScore(unique[twinIndex])) unique[twinIndex] = train;
    });
    const windDistinct = Number.isFinite(windWave.heightFt)
      && Number.isFinite(windWave.direction)
      && windWave.heightFt >= SECONDARY_MIN_FT
      && !isEasterlyComingFrom(windWave.direction)
      && unique.every((other) => (
        angularDistanceDeg(other.direction, windWave.direction) >= DISTINCT_HEADING_DEG
      ));
    if (windDistinct) unique.push(windWave);
    unique.sort((left, right) => {
      const periodDelta = (right.period || 0) - (left.period || 0);
      if (Math.abs(periodDelta) >= 1) return periodDelta;
      return (right.heightFt || 0) - (left.heightFt || 0);
    });
    const primary = unique[0]
      || (Number.isFinite(combined.heightFt) && Number.isFinite(combined.direction) ? combined : emptyTrain());
    const next = unique.find((train, index) => (
      index > 0
      && Number.isFinite(train.heightFt)
      && train.heightFt >= SECONDARY_MIN_FT
      && Number.isFinite(primary.direction)
      && angularDistanceDeg(primary.direction, train.direction) >= DISTINCT_HEADING_DEG
    ));
    const secondary = next || emptyTrain();
    return { primary, secondary };
  }

  function headingFromUv(u, v) {
    if (!Number.isFinite(u) || !Number.isFinite(v) || (u === 0 && v === 0)) return null;
    return (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
  }

  function lerpColor(a, b, t) {
    return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));
  }

  function colorFromStops(value, stops) {
    for (let index = 1; index < stops.length; index += 1) {
      const [next, color] = stops[index];
      const [prev, prevColor] = stops[index - 1];
      if (value <= next) {
        const t = clamp((value - prev) / Math.max(0.001, next - prev), 0, 1);
        return lerpColor(prevColor, color, t);
      }
    }
    return stops[stops.length - 1][1];
  }

  /* Brand wave-height scale (same family as wind):
     0 ft #0075df → 3 ft #13baee → 6 ft #a64bd8 → 10+ ft #ee13ba */
  function waveColor(heightFt) {
    return colorFromStops(heightFt, [
      [0, [0, 117, 223]],
      [3, [19, 186, 238]],
      [6, [166, 75, 216]],
      [10, [238, 19, 186]],
    ]);
  }
  window.__diveProWaveColor = waveColor;

  function smoothstep(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  /* Marine stratus: white / light-grey over ocean. Low cover almost
     invisible; high cover milky. Never a navy heatmap. */
  function cloudColor(coverPct) {
    const t = clamp(coverPct / 100, 0, 1);
    const density = smoothstep(t);
    const wispy = Math.pow(density, 1.28);
    const gray = Math.round(236 + 19 * wispy);
    const tint = Math.min(255, gray + 3);
    const alpha = Math.round(2 + 38 * wispy + 148 * wispy * wispy);
    return [gray, gray, tint, clamp(alpha, 0, 198)];
  }

  function hash2(ix, iy) {
    let n = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return (n >>> 0) / 4294967296;
  }

  function valueNoise2(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smoothstep(x - x0);
    const fy = smoothstep(y - y0);
    const n00 = hash2(x0, y0);
    const n10 = hash2(x0 + 1, y0);
    const n01 = hash2(x0, y0 + 1);
    const n11 = hash2(x0 + 1, y0 + 1);
    return n00 * (1 - fx) * (1 - fy) + n10 * fx * (1 - fy) + n01 * (1 - fx) * fy + n11 * fx * fy;
  }

  function fbm2(x, y) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let octave = 0; octave < 4; octave += 1) {
      sum += amp * valueNoise2(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return sum / norm;
  }

  function californiaGridPoints(step) {
    const lats = [];
    const lons = [];
    for (let lat = WAVE_BBOX.north; lat >= WAVE_BBOX.south - 1e-6; lat -= step) {
      lats.push(Number(lat.toFixed(2)));
    }
    for (let lon = WAVE_BBOX.west; lon <= WAVE_BBOX.east + 1e-6; lon += step) {
      lons.push(Number(lon.toFixed(2)));
    }
    const points = [];
    lats.forEach((lat, row) => {
      lons.forEach((lon, col) => points.push({ lat, lon, row, col }));
    });
    return { lats, lons, points, step };
  }

  async function fetchMarineBatch(points) {
    const url = new URL("https://marine-api.open-meteo.com/v1/marine");
    url.searchParams.set("latitude", points.map((point) => point.lat).join(","));
    url.searchParams.set("longitude", points.map((point) => point.lon).join(","));
    url.searchParams.set("hourly", MARINE_HOURLY);
    url.searchParams.set("timezone", "America/Los_Angeles");
    url.searchParams.set("forecast_days", String(FORECAST_DAYS));
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`Open-Meteo marine request failed (${response.status})`);
        const payload = await response.json();
        if (payload?.error) throw new Error(payload.reason || "Open-Meteo marine error");
        const rows = Array.isArray(payload) ? payload : [payload];
        if (rows.length !== points.length) throw new Error("Open-Meteo marine batch size mismatch");
        return rows;
      } catch (error) {
        lastError = error;
        await sleep(280 * (attempt + 1));
      }
    }
    throw lastError || new Error("Open-Meteo marine request failed");
  }

  async function fetchMarineBatches(points) {
    const results = [];
    for (let index = 0; index < points.length; index += 20) {
      results.push(...await fetchMarineBatch(points.slice(index, index + 20)));
    }
    return results;
  }

  function buildWaveManifest(lats, lons, points, results, step) {
    const times = results[0]?.hourly?.time || [];
    if (times.length < 8) throw new Error("California wave hourly times unavailable");
    const now = Date.now();
    let start = 0;
    let bestDelta = Infinity;
    times.forEach((stamp, index) => {
      const raw = String(stamp || "");
      const parsed = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)
        ? new Date(raw).getTime()
        : new Date(`${raw.replace(" ", "T")}`).getTime();
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
      let time = Number.isFinite(parsed) ? parsed : NaN;
      if (match && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
        const asUtc = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Los_Angeles",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(asUtc));
        const num = (type) => Number(parts.find((part) => part.type === type)?.value);
        const shown = Date.UTC(num("year"), num("month") - 1, num("day"), num("hour"), num("minute"));
        time = asUtc + (asUtc - shown);
      }
      if (!Number.isFinite(time)) return;
      const delta = Math.abs(time - now);
      if (delta < bestDelta) {
        start = index;
        bestDelta = delta;
      }
    });
    const windowTimes = times.slice(start, start + FORECAST_HOURS);
    const nx = lons.length;
    const ny = lats.length;
    const frames = windowTimes.map((iso, index) => {
      const timeIndex = start + index;
      const height = Array.from({ length: ny }, () => Array(nx).fill(null));
      const direction = Array.from({ length: ny }, () => Array(nx).fill(null));
      const period = Array.from({ length: ny }, () => Array(nx).fill(null));
      const primaryHeight = Array.from({ length: ny }, () => Array(nx).fill(null));
      const primaryDirection = Array.from({ length: ny }, () => Array(nx).fill(null));
      const primaryPeriod = Array.from({ length: ny }, () => Array(nx).fill(null));
      const primaryU = Array.from({ length: ny }, () => Array(nx).fill(null));
      const primaryV = Array.from({ length: ny }, () => Array(nx).fill(null));
      const secondaryHeight = Array.from({ length: ny }, () => Array(nx).fill(null));
      const secondaryDirection = Array.from({ length: ny }, () => Array(nx).fill(null));
      const secondaryPeriod = Array.from({ length: ny }, () => Array(nx).fill(null));
      const secondaryU = Array.from({ length: ny }, () => Array(nx).fill(null));
      const secondaryV = Array.from({ length: ny }, () => Array(nx).fill(null));
      points.forEach((point, pointIndex) => {
        const hourly = results[pointIndex]?.hourly || {};
        const meters = Number(hourly.wave_height?.[timeIndex]);
        const dir = Number(hourly.wave_direction?.[timeIndex]);
        const sec = Number(hourly.wave_period?.[timeIndex]);
        const { primary, secondary } = pickTrains(hourly, timeIndex);
        const primaryUv = uvFromComingFrom(trainVisualSpeed(primary), primary.direction);
        const secondaryUv = uvFromComingFrom(trainVisualSpeed(secondary), secondary.direction);
        height[point.row][point.col] = Number.isFinite(meters) ? meters * M_TO_FT : null;
        direction[point.row][point.col] = Number.isFinite(dir) ? dir : null;
        period[point.row][point.col] = Number.isFinite(sec) ? sec : null;
        primaryHeight[point.row][point.col] = primary.heightFt;
        primaryDirection[point.row][point.col] = primary.direction;
        primaryPeriod[point.row][point.col] = primary.period;
        primaryU[point.row][point.col] = primaryUv.u;
        primaryV[point.row][point.col] = primaryUv.v;
        secondaryHeight[point.row][point.col] = secondary.heightFt;
        secondaryDirection[point.row][point.col] = secondary.direction;
        secondaryPeriod[point.row][point.col] = secondary.period;
        secondaryU[point.row][point.col] = secondaryUv.u;
        secondaryV[point.row][point.col] = secondaryUv.v;
      });
      return {
        valid_utc: new Date(iso).toISOString(),
        iso,
        index,
        grid: {
          metadata: { source: "Open-Meteo marine waves", bbox: { ...WAVE_BBOX }, nx, ny, dx: step, dy: step },
          height,
          direction,
          period,
          primaryHeight,
          primaryDirection,
          primaryPeriod,
          primaryU,
          primaryV,
          secondaryHeight,
          secondaryDirection,
          secondaryPeriod,
          secondaryU,
          secondaryV,
        },
      };
    });
    if (!frames.length) throw new Error("California wave frames unavailable");
    return { run: "open-meteo-marine-california", frames };
  }

  function readCachedWaveManifest() {
    try {
      const raw = sessionStorage.getItem(WAVE_SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const grid = parsed?.frames?.[0]?.grid;
      if (!parsed?.frames?.length || !grid?.primaryHeight || !grid?.secondaryHeight) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCachedWaveManifest(manifest) {
    try {
      sessionStorage.setItem(WAVE_SESSION_KEY, JSON.stringify(manifest));
    } catch {
      /* ignore quota */
    }
  }

  async function loadWaveManifest() {
    const cached = readCachedWaveManifest();
    if (cached) return cached;
    const steps = [WAVE_STEP, 1.6];
    let lastError = null;
    for (const step of steps) {
      try {
        const { lats, lons, points } = californiaGridPoints(step);
        const results = await fetchMarineBatches(points);
        const manifest = buildWaveManifest(lats, lons, points, results, step);
        writeCachedWaveManifest(manifest);
        return manifest;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("California wave overlay unavailable");
  }

  function interpolateField(field, metadata, lon, lat) {
    if (!field || !metadata) return null;
    const { west, east, south, north } = metadata.bbox;
    const { nx, ny } = metadata;
    if (!nx || !ny) return null;
    const gx = clamp(((lon - west) / (east - west)) * (nx - 1), 0, nx - 1);
    const gy = clamp(((north - lat) / (north - south)) * (ny - 1), 0, ny - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;
    const corners = [
      { x: x0, y: y0, weight: (1 - tx) * (1 - ty) },
      { x: x1, y: y0, weight: tx * (1 - ty) },
      { x: x0, y: y1, weight: (1 - tx) * ty },
      { x: x1, y: y1, weight: tx * ty },
    ];
    let sum = 0;
    let total = 0;
    corners.forEach(({ x, y, weight }) => {
      const value = field[y]?.[x];
      if (!Number.isFinite(value) || weight <= 0) return;
      sum += value * weight;
      total += weight;
    });
    return total ? sum / total : null;
  }

  function fieldAt(field, x, y) {
    const value = field[y]?.[x];
    return Number.isFinite(value) ? value : null;
  }

  function cubicInterp(p0, p1, p2, p3, t) {
    const finite = [p0, p1, p2, p3].filter((value) => Number.isFinite(value));
    if (!finite.length) return null;
    const mid = Number.isFinite(p1) ? p1 : Number.isFinite(p2) ? p2 : finite[0];
    const fill = (value) => (Number.isFinite(value) ? value : mid);
    const a = fill(p0);
    const b = fill(p1);
    const c = fill(p2);
    const d = fill(p3);
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      2 * b
      + (-a + c) * t
      + (2 * a - 5 * b + 4 * c - d) * t2
      + (-a + 3 * b - 3 * c + d) * t3
    );
  }

  /* Bicubic + smoothstep. Raw bilinear on a ~0.7° cell makes diamond / plus-sign blobs. */
  function interpolateFieldBicubic(field, metadata, lon, lat) {
    if (!field || !metadata) return null;
    const { west, east, south, north } = metadata.bbox;
    const { nx, ny } = metadata;
    if (!nx || !ny) return null;
    const gx = clamp(((lon - west) / (east - west)) * (nx - 1), 0, nx - 1);
    const gy = clamp(((north - lat) / (north - south)) * (ny - 1), 0, ny - 1);
    const x1 = Math.floor(gx);
    const y1 = Math.floor(gy);
    const tx = smoothstep(gx - x1);
    const ty = smoothstep(gy - y1);
    const x0 = Math.max(0, x1 - 1);
    const x2 = Math.min(nx - 1, x1 + 1);
    const x3 = Math.min(nx - 1, x1 + 2);
    const y0 = Math.max(0, y1 - 1);
    const y2 = Math.min(ny - 1, y1 + 1);
    const y3 = Math.min(ny - 1, y1 + 2);
    const col0 = cubicInterp(fieldAt(field, x0, y0), fieldAt(field, x0, y1), fieldAt(field, x0, y2), fieldAt(field, x0, y3), ty);
    const col1 = cubicInterp(fieldAt(field, x1, y0), fieldAt(field, x1, y1), fieldAt(field, x1, y2), fieldAt(field, x1, y3), ty);
    const col2 = cubicInterp(fieldAt(field, x2, y0), fieldAt(field, x2, y1), fieldAt(field, x2, y2), fieldAt(field, x2, y3), ty);
    const col3 = cubicInterp(fieldAt(field, x3, y0), fieldAt(field, x3, y1), fieldAt(field, x3, y2), fieldAt(field, x3, y3), ty);
    const value = cubicInterp(col0, col1, col2, col3, tx);
    return Number.isFinite(value) ? value : null;
  }

  function bilinearCorners(metadata, lon, lat) {
    if (!metadata) return [];
    const { west, east, south, north } = metadata.bbox;
    const { nx, ny } = metadata;
    if (!nx || !ny) return [];
    const gx = clamp(((lon - west) / (east - west)) * (nx - 1), 0, nx - 1);
    const gy = clamp(((north - lat) / (north - south)) * (ny - 1), 0, ny - 1);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const x1 = Math.min(nx - 1, x0 + 1);
    const y1 = Math.min(ny - 1, y0 + 1);
    const tx = gx - x0;
    const ty = gy - y0;
    return [
      { x: x0, y: y0, weight: (1 - tx) * (1 - ty) },
      { x: x1, y: y0, weight: tx * (1 - ty) },
      { x: x0, y: y1, weight: (1 - tx) * ty },
      { x: x1, y: y1, weight: tx * ty },
    ];
  }

  function nearestGridCell(metadata, lon, lat) {
    const { west, east, south, north } = metadata.bbox;
    const { nx, ny } = metadata;
    const gx = clamp(((lon - west) / (east - west)) * (nx - 1), 0, nx - 1);
    const gy = clamp(((north - lat) / (north - south)) * (ny - 1), 0, ny - 1);
    return { x: Math.round(gx), y: Math.round(gy) };
  }

  function trainFromCell(grid, x, y, role) {
    const secondary = role === "secondary";
    const heightFt = fieldAt(secondary ? grid.secondaryHeight : grid.primaryHeight, x, y);
    const direction = fieldAt(secondary ? grid.secondaryDirection : grid.primaryDirection, x, y);
    const period = fieldAt(secondary ? grid.secondaryPeriod : grid.primaryPeriod, x, y);
    const u = fieldAt(secondary ? grid.secondaryU : grid.primaryU, x, y);
    const v = fieldAt(secondary ? grid.secondaryV : grid.primaryV, x, y);
    if (!Number.isFinite(heightFt) || !Number.isFinite(direction)) return null;
    if (heightFt < (secondary ? SECONDARY_MIN_FT : 0.15)) return null;
    const uv = Number.isFinite(u) && Number.isFinite(v)
      ? { u, v }
      : uvFromComingFrom(trainVisualSpeed({ heightFt, direction, period }), direction);
    if (!Number.isFinite(uv.u) || !Number.isFinite(uv.v)) return null;
    return { heightFt, direction, period, u: uv.u, v: uv.v };
  }

  function interpolateClusterMembers(members) {
    let uSum = 0;
    let vSum = 0;
    let heightSum = 0;
    let periodSum = 0;
    let periodWeight = 0;
    let weight = 0;
    members.forEach((member) => {
      const w = member.weight;
      if (!(w > 0)) return;
      if (Number.isFinite(member.u) && Number.isFinite(member.v)) {
        uSum += member.u * w;
        vSum += member.v * w;
      }
      if (Number.isFinite(member.heightFt)) heightSum += member.heightFt * w;
      if (Number.isFinite(member.period)) {
        periodSum += member.period * w;
        periodWeight += w;
      }
      weight += w;
    });
    if (!weight) return null;
    const u = uSum / weight;
    const v = vSum / weight;
    const heightFt = heightSum / weight;
    const heading = headingFromUv(u, v);
    if (!Number.isFinite(heightFt) || !Number.isFinite(heading)) return null;
    return {
      heightFt,
      direction: heading,
      period: periodWeight ? periodSum / periodWeight : null,
      u,
      v,
      compass: compassFromDegrees(heading),
    };
  }

  function clusterWeightedTrains(trains) {
    const clusters = [];
    trains.forEach((train) => {
      if (!Number.isFinite(train?.direction) || !Number.isFinite(train?.heightFt)) return;
      const twinIndex = clusters.findIndex((other) => (
        angularDistanceDeg(other.direction, train.direction) < SAME_TRAIN_DEG
      ));
      if (twinIndex < 0) {
        clusters.push({
          direction: train.direction,
          heightFt: train.heightFt,
          period: train.period,
          members: [train],
        });
        return;
      }
      clusters[twinIndex].members.push(train);
      if (trainScore(train) > trainScore(clusters[twinIndex])) {
        clusters[twinIndex].direction = train.direction;
        clusters[twinIndex].heightFt = train.heightFt;
        clusters[twinIndex].period = train.period;
      }
    });
    return clusters
      .map((cluster) => interpolateClusterMembers(cluster.members))
      .filter(Boolean)
      .sort((left, right) => {
        const periodDelta = (right.period || 0) - (left.period || 0);
        if (Math.abs(periodDelta) >= 1) return periodDelta;
        return (right.heightFt || 0) - (left.heightFt || 0);
      });
  }

  /* Re-cluster the four bilinear corners by heading, then interpolate
     inside each cluster. Period-ranked primary/secondary labels still
     swap across cells; heading clusters do not. */
  function sampleTrainsFromGrid(grid, lon, lat) {
    if (!grid?.metadata) return { primary: null, secondary: null };
    const weighted = [];
    bilinearCorners(grid.metadata, lon, lat).forEach(({ x, y, weight }) => {
      ["primary", "secondary"].forEach((role) => {
        const train = trainFromCell(grid, x, y, role);
        if (train) weighted.push({ ...train, weight });
      });
    });
    const clustered = clusterWeightedTrains(weighted);
    let primary = clustered[0] || null;
    let secondary = clustered.find((train, index) => (
      index > 0
      && train.heightFt >= SECONDARY_MIN_FT
      && primary
      && angularDistanceDeg(primary.direction, train.direction) >= DISTINCT_HEADING_DEG
    )) || null;
    if (!secondary) {
      const { x, y } = nearestGridCell(grid.metadata, lon, lat);
      const nearPrimary = trainFromCell(grid, x, y, "primary");
      const nearSecondary = trainFromCell(grid, x, y, "secondary");
      if (
        nearPrimary
        && nearSecondary
        && angularDistanceDeg(nearPrimary.direction, nearSecondary.direction) >= DISTINCT_HEADING_DEG
      ) {
        primary = { ...nearPrimary, compass: compassFromDegrees(nearPrimary.direction) };
        secondary = { ...nearSecondary, compass: compassFromDegrees(nearSecondary.direction) };
      } else if (nearPrimary && !primary) {
        primary = { ...nearPrimary, compass: compassFromDegrees(nearPrimary.direction) };
      }
    }
    return { primary, secondary };
  }

  function sampleTrainFromGrid(grid, lon, lat, role) {
    const { primary, secondary } = sampleTrainsFromGrid(grid, lon, lat);
    const train = role === "secondary" ? secondary : primary;
    if (!train) return null;
    if (train.heightFt < (role === "secondary" ? SECONDARY_MIN_FT : 0.15)) return null;
    return train;
  }

  function sampleWave(grid, lon, lat) {
    if (!grid) return null;
    const heightFt = interpolateField(grid.height, grid.metadata, lon, lat);
    if (!Number.isFinite(heightFt)) return null;
    const direction = interpolateField(grid.direction, grid.metadata, lon, lat);
    const period = interpolateField(grid.period, grid.metadata, lon, lat);
    const { primary, secondary } = sampleTrainsFromGrid(grid, lon, lat);
    return {
      heightFt,
      direction: primary?.direction ?? direction,
      period: primary?.period ?? period,
      compass: primary?.compass || (Number.isFinite(direction) ? compassFromDegrees(direction) : ""),
      primary,
      secondary,
    };
  }

  /* Open-Meteo headings are meteorological coming-from. Probe text uses that
     (SW swell = from the southwest). Arrows / particles use going-to. */
  function goingToDegrees(comingFrom) {
    const degrees = Number(comingFrom);
    return Number.isFinite(degrees) ? (degrees + 180) % 360 : null;
  }

  /* Place the swell rose fully over water: skip land from the seed (pin or
     map center), walk the longest water fetch, then park the disk well
     offshore so the ring, N/E/S/W, and both arrowheads sit on ocean.
     Not a hardcoded "always left" — Monterey / islands use their own fetch. */
  function findOceanRoseAnchor(options) {
    const width = Math.max(1, Number(options?.width) || 1);
    const height = Math.max(1, Number(options?.height) || 1);
    const isWater = typeof options?.isWater === "function" ? options.isWater : () => false;
    const seedX = Number.isFinite(options?.seedX) ? options.seedX : width * 0.42;
    const seedY = Number.isFinite(options?.seedY) ? options.seedY : height * 0.5;
    const radius = Math.max(36, Number(options?.radius) || Math.min(width, height) * 0.22);
    const pad = 8;

    function diskClear(cx, cy, r) {
      const clearR = r + 18;
      if (cx - clearR < pad || cy - clearR < pad || cx + clearR > width - pad || cy + clearR > height - pad) return false;
      if (!isWater(cx, cy)) return false;
      const step = Math.max(5, clearR / 6);
      for (let y = cy - clearR; y <= cy + clearR; y += step) {
        for (let x = cx - clearR; x <= cx + clearR; x += step) {
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > clearR * clearR) continue;
          if (!isWater(x, y)) return false;
        }
      }
      const labelR = r + 16;
      const labels = [[cx, cy - labelR], [cx + labelR, cy], [cx, cy + labelR], [cx - labelR, cy]];
      return labels.every(([x, y]) => (
        x >= pad && y >= pad && x <= width - pad && y <= height - pad && isWater(x, y)
      ));
    }

    /* Seed is often on land (CA pin / map center). Do not break on that
       first land pixel — that used to lock the heading to east (angle 0). */
    function offshoreAngle() {
      let best = Math.PI;
      let bestScore = -1;
      for (let i = 0; i < 16; i += 1) {
        const ang = (i / 16) * Math.PI * 2;
        let score = 0;
        let seenWater = false;
        let landSteps = 0;
        for (let d = 4; d < Math.min(width, height) * 0.74; d += 6) {
          const x = seedX + Math.cos(ang) * d;
          const y = seedY + Math.sin(ang) * d;
          if (x < pad || y < pad || x > width - pad || y > height - pad) break;
          if (isWater(x, y)) {
            seenWater = true;
            score += 1 + d * 0.02;
          } else if (seenWater) {
            break;
          } else {
            landSteps += 1;
          }
        }
        if (!seenWater) continue;
        score -= landSteps * 0.18;
        if (score > bestScore) {
          bestScore = score;
          best = ang;
        }
      }
      return best;
    }

    const angle = offshoreAngle();
    const radii = [radius, radius * 0.84, radius * 0.7, Math.max(36, radius * 0.54)];
    function pickAlongRay(tryRadius) {
      const hits = [];
      for (let d = 0; d < Math.min(width, height) * 0.78; d += 6) {
        const x = seedX + Math.cos(angle) * d;
        const y = seedY + Math.sin(angle) * d;
        if (diskClear(x, y, tryRadius)) hits.push({ x, y, radius: tryRadius, d });
      }
      if (!hits.length) return null;
      return hits[hits.length - 1];
    }
    for (const tryRadius of radii) {
      const along = pickAlongRay(tryRadius);
      if (along) return along;
      let best = null;
      const step = Math.max(12, Math.round(tryRadius * 0.5));
      for (let y = tryRadius + pad; y <= height - tryRadius - pad; y += step) {
        for (let x = tryRadius + pad; x <= width - tryRadius - pad; x += step) {
          if (!diskClear(x, y, tryRadius)) continue;
          const score = Math.cos(angle) * (x - seedX) + Math.sin(angle) * (y - seedY);
          if (!best || score > best.along) best = { x, y, radius: tryRadius, along: score };
        }
      }
      if (best) return best;
    }

    let open = null;
    const scanR = Math.max(36, radius * 0.58);
    const scanStep = Math.max(14, Math.round(scanR * 0.7));
    for (let y = scanR + pad; y <= height - scanR - pad; y += scanStep) {
      for (let x = scanR + pad; x <= width - scanR - pad; x += scanStep) {
        if (!diskClear(x, y, scanR)) continue;
        let neighbor = 0;
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          if (isWater(x + Math.cos(a) * scanR * 1.8, y + Math.sin(a) * scanR * 1.8)) neighbor += 1;
        }
        const along = Math.cos(angle) * (x - seedX) + Math.sin(angle) * (y - seedY);
        const score = neighbor * 20 + along;
        if (!open || score > open.score) open = { x, y, radius: scanR, score };
      }
    }
    if (open) return open;

    return {
      x: Math.max(radius + pad + 18, Math.min(width * 0.22, width - radius - pad)),
      y: height * 0.48,
      radius: Math.min(radius, Math.min(width, height) * 0.16),
    };
  }
  window.__diveProFindOceanRoseAnchor = findOceanRoseAnchor;

  function formatTrainToken(train) {
    if (!train || !Number.isFinite(train.heightFt)) return "";
    const height = `${Math.round(train.heightFt)} ft`;
    const period = Number.isFinite(train.period) ? `${Math.round(train.period)}s` : "";
    const comingFrom = Number(train.direction);
    const compass = Number.isFinite(comingFrom)
      ? (train.compass || compassFromDegrees(comingFrom))
      : "";
    return [height, period, compass].filter(Boolean).join(" · ");
  }

  function sampleCloud(grid, lon, lat) {
    if (!grid?.cloud || !grid.metadata) return null;
    const cover = interpolateFieldBicubic(grid.cloud, grid.metadata, lon, lat);
    return Number.isFinite(cover) ? { cover: clamp(cover, 0, 100) } : null;
  }

  /* Three-pass box blur ≈ Gaussian. Premultiplied so white-on-clear does not grey-fringe. */
  function blurCloudImage(image, width, height, radius, passes) {
    const src = image.data;
    const tmp = new Uint16Array(width * height * 4);
    const window = radius * 2 + 1;
    for (let pass = 0; pass < passes; pass += 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const xx = clamp(x + k, 0, width - 1);
            const i = (y * width + xx) * 4;
            const alpha = src[i + 3];
            r += src[i] * alpha;
            g += src[i + 1] * alpha;
            b += src[i + 2] * alpha;
            a += alpha;
          }
          const o = (y * width + x) * 4;
          tmp[o + 3] = Math.round(a / window);
          if (a > 0) {
            tmp[o] = Math.round(r / a);
            tmp[o + 1] = Math.round(g / a);
            tmp[o + 2] = Math.round(b / a);
          } else {
            tmp[o] = 0;
            tmp[o + 1] = 0;
            tmp[o + 2] = 0;
          }
        }
      }
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let k = -radius; k <= radius; k += 1) {
            const yy = clamp(y + k, 0, height - 1);
            const i = (yy * width + x) * 4;
            const alpha = tmp[i + 3];
            r += tmp[i] * alpha;
            g += tmp[i + 1] * alpha;
            b += tmp[i + 2] * alpha;
            a += alpha;
          }
          const o = (y * width + x) * 4;
          src[o + 3] = Math.round(a / window);
          if (a > 0) {
            src[o] = Math.round(r / a);
            src[o + 1] = Math.round(g / a);
            src[o + 2] = Math.round(b / a);
          } else {
            src[o] = 0;
            src[o + 1] = 0;
            src[o + 2] = 0;
          }
        }
      }
    }
  }

  function sampleCloudVisual(grid, lon, lat) {
    if (!grid?.cloud || !grid.metadata) return null;
    const warp = 0.36;
    const n1 = fbm2(lon * 1.55, lat * 1.55);
    const n2 = fbm2(lon * 1.55 + 31.7, lat * 1.55 - 14.2);
    const warpedLon = lon + (n1 * 2 - 1) * warp;
    const warpedLat = lat + (n2 * 2 - 1) * warp * 0.84;
    let cover = interpolateFieldBicubic(grid.cloud, grid.metadata, warpedLon, warpedLat);
    if (!Number.isFinite(cover)) cover = interpolateFieldBicubic(grid.cloud, grid.metadata, lon, lat);
    if (!Number.isFinite(cover)) return null;
    const texture = 0.7 + 0.58 * fbm2(lon * 5.6 + 8.1, lat * 5.6);
    return { cover: clamp(cover * texture, 0, 100) };
  }

  function nearestWaveFrame(manifest, iso) {
    const frames = manifest?.frames || [];
    if (!frames.length) return null;
    if (!iso) return frames[0];
    const target = new Date(iso).getTime();
    if (!Number.isFinite(target)) return frames[0];
    let best = frames[0];
    let bestDelta = Infinity;
    frames.forEach((frame) => {
      const time = new Date(frame.valid_utc || frame.iso).getTime();
      const delta = Math.abs(time - target);
      if (delta < bestDelta) {
        best = frame;
        bestDelta = delta;
      }
    });
    return best;
  }

  function normalizeWaterPolygons(waterMask) {
    return (waterMask?.features || []).flatMap((feature) => {
      const geometry = feature.geometry;
      if (!geometry) return [];
      if (geometry.type === "Polygon") return [geometry.coordinates];
      if (geometry.type === "MultiPolygon") return geometry.coordinates;
      return [];
    });
  }

  function geometryToPolygons(geometry) {
    if (!geometry) return [];
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates;
    return [];
  }

  /* Overlay maps never draw the swell rose: location-page Region Map,
     home California map (.home-map-card), and any full-page / extended
     map (map.html with or without ?spot=, .full-map-page, .full-map).
     The Swell card (#swellRose in app.js) is a separate widget and stays. */
  function isFullPageMap() {
    const body = document.body;
    if (!body) return false;
    if (body.classList.contains("full-map-page") || body.classList.contains("full-map")) return true;
    if (body.dataset.page === "map") return true;
    const path = String(location.pathname || "");
    return /(?:^|\/)map\.html$/i.test(path);
  }

  function regionMapHidesSwellRose(map) {
    if (map?.__diveProHideSwellCompass) return true;
    if (isFullPageMap()) return true;
    const container = map?.getContainer?.();
    if (container) {
      if (container.closest(".home-map-card, .full-map, .full-map-page")) return true;
      if (container.id === "spotRegionMap" && isFullPageMap()) return true;
      const card = container.closest(".region-map-card");
      if (card && !card.classList.contains("home-map-card")) return true;
      const heading = card?.querySelector("h2");
      if (heading && heading.textContent.trim() === "Region Map") return true;
    }
    return false;
  }

  function createOceanOverlay(map, waterMask) {
    const mapContainer = map.getContainer();
    const frame = mapContainer.closest(".spot-map-graphic") || mapContainer.closest(".map-frame");
    if (!frame) return null;
    const hideSwellCompass = regionMapHidesSwellRose(map);

    const waterPolygons = normalizeWaterPolygons(waterMask);
    const waveCanvas = document.createElement("canvas");
    waveCanvas.className = "ocean-overlay-canvas wave-overlay-canvas";
    const particleCanvas = document.createElement("canvas");
    particleCanvas.className = "ocean-overlay-canvas wave-particle-canvas";
    const cloudCanvas = document.createElement("canvas");
    cloudCanvas.className = "ocean-overlay-canvas cloud-overlay-canvas";
    const compassCanvas = document.createElement("canvas");
    compassCanvas.className = "ocean-overlay-canvas swell-compass-canvas";
    compassCanvas.setAttribute("aria-hidden", "true");
    const maskCanvas = document.createElement("canvas");
    frame.appendChild(waveCanvas);
    frame.appendChild(particleCanvas);
    frame.appendChild(cloudCanvas);
    if (!hideSwellCompass) frame.appendChild(compassCanvas);
    const waveCtx = waveCanvas.getContext("2d");
    const particleCtx = particleCanvas.getContext("2d");
    const cloudCtx = cloudCanvas.getContext("2d");
    const compassCtx = compassCanvas.getContext("2d");
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });
    let waveGrid = null;
    let cloudGrid = null;
    let needsMask = true;
    let maskData = null;
    let mapIsInteracting = false;
    let settleTimer;
    let primaryParticles = [];
    let secondaryParticles = [];
    let animationId = 0;

    function resize() {
      const rect = mapContainer.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      [waveCanvas, particleCanvas, cloudCanvas, compassCanvas].forEach((canvas) => {
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        canvas.width = Math.max(1, Math.round(rect.width * scale));
        canvas.height = Math.max(1, Math.round(rect.height * scale));
      });
      maskCanvas.width = waveCanvas.width;
      maskCanvas.height = waveCanvas.height;
      waveCtx.setTransform(scale, 0, 0, scale, 0, 0);
      particleCtx.setTransform(scale, 0, 0, scale, 0, 0);
      cloudCtx.setTransform(scale, 0, 0, scale, 0, 0);
      compassCtx.setTransform(scale, 0, 0, scale, 0, 0);
      maskCtx.setTransform(scale, 0, 0, scale, 0, 0);
      needsMask = true;
      maskData = null;
    }

    function isScreenPointOnWater(x, y) {
      drawWaterMask();
      const scaleX = maskCanvas.width / Math.max(1, maskCanvas.clientWidth || mapContainer.clientWidth);
      const scaleY = maskCanvas.height / Math.max(1, maskCanvas.clientHeight || mapContainer.clientHeight);
      const sampleX = Math.max(0, Math.min(maskCanvas.width - 1, Math.round(x * scaleX)));
      const sampleY = Math.max(0, Math.min(maskCanvas.height - 1, Math.round(y * scaleY)));
      if (!maskData) return false;
      return maskData[(sampleY * maskCanvas.width + sampleX) * 4 + 3] > 0;
    }

    function randomWaterPoint(role) {
      const fallback = map.unproject([-1000, -1000]);
      if (!waveGrid) return { x: -1000, y: -1000, lon: fallback.lng, lat: fallback.lat, age: 999 };
      for (let attempt = 0; attempt < 400; attempt += 1) {
        const point = [Math.random() * mapContainer.clientWidth, Math.random() * mapContainer.clientHeight];
        const lngLat = map.unproject(point);
        if (isScreenPointOnWater(point[0], point[1]) && sampleTrainFromGrid(waveGrid, lngLat.lng, lngLat.lat, role)) {
          return { x: point[0], y: point[1], lon: lngLat.lng, lat: lngLat.lat, age: Math.floor(Math.random() * 110) };
        }
      }
      return { x: -1000, y: -1000, lon: fallback.lng, lat: fallback.lat, age: 999 };
    }

    function seedParticles() {
      primaryParticles = Array.from({ length: PRIMARY_PARTICLE_COUNT }, () => randomWaterPoint("primary"));
      secondaryParticles = Array.from({ length: SECONDARY_PARTICLE_COUNT }, () => randomWaterPoint("secondary"));
    }

    function drawRing(ring) {
      ring.forEach((coordinate, index) => {
        const point = map.project([coordinate[0], coordinate[1]]);
        if (index === 0) maskCtx.moveTo(point.x, point.y);
        else maskCtx.lineTo(point.x, point.y);
      });
      maskCtx.closePath();
    }

    function drawPolygon(polygon) {
      maskCtx.beginPath();
      polygon.forEach(drawRing);
      maskCtx.fill("evenodd");
    }

    function getRenderedOceanPolygons() {
      if (!map.getLayer(MAPTILER_WATER_LAYER_ID)) return [];
      return map
        .queryRenderedFeatures(undefined, { layers: [MAPTILER_WATER_LAYER_ID] })
        .filter((feature) => feature.properties?.class === "ocean")
        .flatMap((feature) => geometryToPolygons(feature.geometry));
    }

    function drawWaterMask() {
      if (!needsMask) return;
      const rect = mapContainer.getBoundingClientRect();
      maskCtx.clearRect(0, 0, rect.width, rect.height);
      maskCtx.fillStyle = "#000";
      const rendered = getRenderedOceanPolygons();
      const polygons = rendered.length ? rendered : waterPolygons;
      polygons.forEach(drawPolygon);
      maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
      needsMask = false;
    }

    function clipToOcean(ctx, rect) {
      drawWaterMask();
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      const slug = document.body.classList.contains("home-directory") || document.body.dataset.page === "home" ? "home" : "";
      ctx.filter = `blur(${slug === "home" ? 10 : 36}px)`;
      ctx.drawImage(maskCanvas, 0, 0, rect.width, rect.height);
      ctx.filter = "none";
      ctx.drawImage(maskCanvas, 0, 0, rect.width, rect.height);
      ctx.restore();
    }

    function compassSeedPoint(rect) {
      const pin = map.__diveProSpotLngLat;
      if (Array.isArray(pin) && pin.length === 2 && Number.isFinite(pin[0]) && Number.isFinite(pin[1])) {
        const point = map.project(pin);
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y };
      }
      try {
        const center = map.getCenter();
        const point = map.project([center.lng, center.lat]);
        return { x: point.x, y: point.y };
      } catch {
        return { x: rect.width * 0.42, y: rect.height * 0.5 };
      }
    }

    function drawCompassArrow(ctx, cx, cy, comingFrom, color, length, strokeWidth, headSize, hubGap) {
      const heading = Number(comingFrom);
      if (!Number.isFinite(heading)) return;
      const rad = ((heading - 90) * Math.PI) / 180;
      const fromX = Math.cos(rad);
      const fromY = Math.sin(rad);
      const tailX = cx + fromX * length;
      const tailY = cy + fromY * length;
      const tipX = cx - fromX * hubGap;
      const tipY = cy - fromY * hubGap;
      const travelX = tipX - tailX;
      const travelY = tipY - tailY;
      const mag = Math.hypot(travelX, travelY) || 1;
      const ux = travelX / mag;
      const uy = travelY / mag;
      const px = -uy;
      const py = ux;
      const baseX = tipX - ux * headSize;
      const baseY = tipY - uy * headSize;
      const leftX = baseX + px * headSize * 0.62;
      const leftY = baseY + py * headSize * 0.62;
      const rightX = baseX - px * headSize * 0.62;
      const rightY = baseY - py * headSize * 0.62;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(baseX, baseY);
      ctx.strokeStyle = "#04101f";
      ctx.lineWidth = strokeWidth + 2.1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(baseX, baseY);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = strokeWidth + 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(baseX, baseY);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();
    }

    function geoCompassAnchor(rect, radius) {
      const pin = map.__diveProSpotLngLat;
      const center = (() => {
        try {
          const c = map.getCenter();
          return [c.lng, c.lat];
        } catch {
          return null;
        }
      })();
      const origin = Array.isArray(pin) && pin.length === 2 ? pin : center;
      if (!origin) return null;
      const pad = radius + 18;
      const headings = [270, 255, 240, 225, 210, 180, 285, 300];
      const dists = [0.08, 0.14, 0.22, 0.32, 0.45, 0.6];
      const cosLat = Math.max(0.25, Math.cos((origin[1] * Math.PI) / 180));
      let best = null;
      for (const dist of dists) {
        for (const heading of headings) {
          const rad = (heading * Math.PI) / 180;
          const lng = origin[0] + (dist * Math.sin(rad)) / cosLat;
          const lat = origin[1] + dist * Math.cos(rad);
          const point = map.project([lng, lat]);
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
          if (point.x < pad || point.y < pad || point.x > rect.width - pad || point.y > rect.height - pad) continue;
          if (!isScreenPointOnWater(point.x, point.y)) continue;
          if (!best || point.x < best.x - 3 || (Math.abs(point.x - best.x) < 3 && dist > best.dist)) {
            best = { x: point.x, y: point.y, radius, dist };
          }
        }
      }
      return best;
    }

    function drawSwellCompass() {
      const rect = mapContainer.getBoundingClientRect();
      compassCtx.clearRect(0, 0, rect.width, rect.height);
      if (hideSwellCompass || mapIsInteracting) return;
      const seed = compassSeedPoint(rect);
      const targetRadius = Math.min(84, Math.max(48, Math.min(rect.width, rect.height) * 0.15));
      const isWater = (x, y) => isScreenPointOnWater(x, y);
      const geo = geoCompassAnchor(rect, targetRadius);
      const anchor = geo || findOceanRoseAnchor({
        width: rect.width,
        height: rect.height,
        isWater,
        radius: targetRadius,
        seedX: seed.x,
        seedY: seed.y,
      });
      const cx = anchor.x;
      const cy = anchor.y;
      window.__diveProRegionRose = {
        x: Math.round(cx),
        y: Math.round(cy),
        r: Math.round(anchor.radius),
        geo: Boolean(geo),
        water: isWater(cx, cy),
      };
      const ringR = anchor.radius * 0.86;
      compassCtx.beginPath();
      compassCtx.arc(cx, cy, ringR, 0, Math.PI * 2);
      compassCtx.fillStyle = "rgba(10, 37, 64, 0.16)";
      compassCtx.fill();
      compassCtx.strokeStyle = "rgba(255, 255, 255, 0.58)";
      compassCtx.lineWidth = 2;
      compassCtx.stroke();
      compassCtx.beginPath();
      compassCtx.arc(cx, cy, 3, 0, Math.PI * 2);
      compassCtx.fillStyle = "#ffffff";
      compassCtx.fill();
      compassCtx.fillStyle = "#f8fbff";
      compassCtx.font = "700 13px Inter, system-ui, sans-serif";
      compassCtx.textAlign = "center";
      compassCtx.textBaseline = "middle";
      const labelR = anchor.radius * 1.02;
      compassCtx.fillText("N", cx, cy - labelR);
      compassCtx.fillText("E", cx + labelR, cy);
      compassCtx.fillText("S", cx, cy + labelR);
      compassCtx.fillText("W", cx - labelR, cy);
      const lngLat = map.unproject([cx, cy]);
      const sample = sampleWave(waveGrid, lngLat.lng, lngLat.lat);
      const scale = ringR / 62;
      const secondary = sample?.secondary;
      const primary = sample?.primary;
      if (secondary && Number.isFinite(secondary.direction)) {
        drawCompassArrow(compassCtx, cx, cy, secondary.direction, "#ee13ba", 50 * scale, 2.6, 10 * scale, 36 * scale);
      }
      if (primary && Number.isFinite(primary.direction)) {
        drawCompassArrow(compassCtx, cx, cy, primary.direction, "#13baee", 52 * scale, 5.6, 13 * scale, 20 * scale);
      }
      clipToOcean(compassCtx, rect);
    }

    function drawWaveField() {
      const rect = mapContainer.getBoundingClientRect();
      waveCtx.clearRect(0, 0, rect.width, rect.height);
      if (!waveGrid || map.__diveProActiveLayer !== "waves" || mapIsInteracting) return;
      const step = rect.width > 720 ? 2 : 3;
      const width = Math.max(1, Math.ceil(rect.width / step));
      const height = Math.max(1, Math.ceil(rect.height / step));
      const image = waveCtx.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const lngLat = map.unproject([x * step + step / 2, y * step + step / 2]);
          const sample = sampleWave(waveGrid, lngLat.lng, lngLat.lat);
          const index = (y * width + x) * 4;
          if (!sample) {
            image.data[index + 3] = 0;
            continue;
          }
          const [r, g, b] = waveColor(sample.heightFt);
          image.data[index] = r;
          image.data[index + 1] = g;
          image.data[index + 2] = b;
          image.data[index + 3] = 198;
        }
      }
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      scratch.getContext("2d").putImageData(image, 0, 0);
      waveCtx.imageSmoothingEnabled = true;
      waveCtx.drawImage(scratch, 0, 0, rect.width, rect.height);
      clipToOcean(waveCtx, rect);
    }

    function waveParticleStep(zoom) {
      return WAVE_PARTICLE_SPEED * Math.max(0.14, Math.min(1, 2 ** ((WAVE_PARTICLE_REFERENCE_ZOOM - zoom) * 0.72)));
    }

    function drawTrainParticles(particles, role) {
      const rect = mapContainer.getBoundingClientRect();
      const zoomStep = waveParticleStep(map.getZoom());
      const isPrimary = role === "primary";
      const streakScale = isPrimary ? 8.8 : 5.6;
      const glowWidth = isPrimary ? 6.4 : 3.5;
      const coreWidth = isPrimary ? 2.45 : 1.45;
      const maxAge = isPrimary ? 165 : 120;
      particles.forEach((particle) => {
        const lngLat = map.unproject([particle.x, particle.y]);
        particle.lon = lngLat.lng;
        particle.lat = lngLat.lat;
        const train = sampleTrainFromGrid(waveGrid, particle.lon, particle.lat, role);
        if (
          !train
          || !isScreenPointOnWater(particle.x, particle.y)
          || particle.x < -40
          || particle.x > rect.width + 40
          || particle.y < -40
          || particle.y > rect.height + 40
          || particle.age > maxAge
        ) {
          Object.assign(particle, randomWaterPoint(role));
          return;
        }
        const period = Number.isFinite(train.period) ? train.period : 8;
        const periodSlow = isPrimary ? clamp(8 / Math.max(6, period), 0.55, 1.05) : clamp(9 / Math.max(5, period), 0.7, 1.25);
        const end = map.project([
          particle.lon + train.u * zoomStep * periodSlow,
          particle.lat + train.v * zoomStep * periodSlow,
        ]);
        if (!isScreenPointOnWater(end.x, end.y)) {
          Object.assign(particle, randomWaterPoint(role));
          return;
        }
        const streakX = particle.x + (end.x - particle.x) * streakScale;
        const streakY = particle.y + (end.y - particle.y) * streakScale;
        const midX = (particle.x + streakX) / 2;
        const midY = (particle.y + streakY) / 2;
        if (!isScreenPointOnWater(streakX, streakY) || !isScreenPointOnWater(midX, midY)) {
          particle.x = end.x;
          particle.y = end.y;
          particle.age += 1;
          return;
        }
        const alpha = isPrimary
          ? clamp(0.4 + train.heightFt / 14, 0.4, 0.78)
          : clamp(0.32 + train.heightFt / 16, 0.32, 0.62);
        const glow = particleCtx.createLinearGradient(particle.x, particle.y, streakX, streakY);
        glow.addColorStop(0, "rgba(226, 242, 255, 0)");
        glow.addColorStop(0.35, isPrimary ? `rgba(125, 216, 247, ${alpha * 0.28})` : `rgba(255, 186, 64, ${alpha * 0.42})`);
        glow.addColorStop(1, isPrimary ? `rgba(255, 255, 255, ${Math.min(0.55, alpha * 0.9)})` : `rgba(255, 236, 170, ${Math.min(0.7, alpha)})`);
        particleCtx.lineCap = "round";
        particleCtx.lineJoin = "round";
        particleCtx.lineWidth = glowWidth;
        particleCtx.strokeStyle = glow;
        particleCtx.beginPath();
        particleCtx.moveTo(particle.x, particle.y);
        particleCtx.lineTo(streakX, streakY);
        particleCtx.stroke();
        const core = particleCtx.createLinearGradient(particle.x, particle.y, streakX, streakY);
        core.addColorStop(0, "rgba(226, 242, 255, 0)");
        core.addColorStop(0.4, isPrimary ? `rgba(226, 242, 255, ${alpha * 0.62})` : `rgba(255, 224, 140, ${alpha * 0.72})`);
        core.addColorStop(1, isPrimary ? `rgba(255, 255, 255, ${Math.min(0.96, alpha + 0.22)})` : `rgba(255, 248, 220, ${Math.min(0.98, alpha + 0.28)})`);
        particleCtx.lineWidth = coreWidth;
        particleCtx.strokeStyle = core;
        particleCtx.beginPath();
        particleCtx.moveTo(particle.x, particle.y);
        particleCtx.lineTo(streakX, streakY);
        particleCtx.stroke();
        particle.x = end.x;
        particle.y = end.y;
        particle.age += 1;
      });
    }

    function drawWaveParticles() {
      const rect = mapContainer.getBoundingClientRect();
      particleCtx.clearRect(0, 0, rect.width, rect.height);
      if (!waveGrid || map.__diveProActiveLayer !== "waves" || mapIsInteracting) return;
      drawTrainParticles(primaryParticles, "primary");
      drawTrainParticles(secondaryParticles, "secondary");
      /* Same ocean clip as the wave-height field / wind: MapTiler Water
         class===ocean, else water-mask GeoJSON. Never paint land. */
      clipToOcean(particleCtx, rect);
    }

    function tickParticles() {
      drawWaveParticles();
      animationId = window.requestAnimationFrame(tickParticles);
    }

    function drawCloudField() {
      const rect = mapContainer.getBoundingClientRect();
      cloudCtx.clearRect(0, 0, rect.width, rect.height);
      if (!cloudGrid || map.__diveProActiveLayer !== "clouds" || mapIsInteracting) return;
      const step = 2;
      const width = Math.max(1, Math.ceil(rect.width / step));
      const height = Math.max(1, Math.ceil(rect.height / step));
      const image = cloudCtx.createImageData(width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const lngLat = map.unproject([x * step + step / 2, y * step + step / 2]);
          const sample = sampleCloudVisual(cloudGrid, lngLat.lng, lngLat.lat);
          const index = (y * width + x) * 4;
          if (!sample) {
            image.data[index + 3] = 0;
            continue;
          }
          const [r, g, b, a] = cloudColor(sample.cover);
          image.data[index] = r;
          image.data[index + 1] = g;
          image.data[index + 2] = b;
          image.data[index + 3] = a;
        }
      }
      blurCloudImage(image, width, height, 8, 3);
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      scratch.getContext("2d").putImageData(image, 0, 0);
      cloudCtx.save();
      cloudCtx.imageSmoothingEnabled = true;
      cloudCtx.imageSmoothingQuality = "high";
      cloudCtx.filter = "blur(42px)";
      cloudCtx.globalAlpha = 0.55;
      cloudCtx.drawImage(scratch, 0, 0, rect.width, rect.height);
      cloudCtx.filter = "blur(18px)";
      cloudCtx.globalAlpha = 0.88;
      cloudCtx.drawImage(scratch, 0, 0, rect.width, rect.height);
      cloudCtx.restore();
      clipToOcean(cloudCtx, rect);
    }

    function redraw() {
      if (mapIsInteracting) {
        const rect = mapContainer.getBoundingClientRect();
        waveCtx.clearRect(0, 0, rect.width, rect.height);
        particleCtx.clearRect(0, 0, rect.width, rect.height);
        cloudCtx.clearRect(0, 0, rect.width, rect.height);
        compassCtx.clearRect(0, 0, rect.width, rect.height);
        return;
      }
      const layer = map.__diveProActiveLayer;
      if (layer === "waves") drawWaveField();
      else {
        const rect = mapContainer.getBoundingClientRect();
        waveCtx.clearRect(0, 0, rect.width, rect.height);
        particleCtx.clearRect(0, 0, rect.width, rect.height);
      }
      if (layer === "clouds") drawCloudField();
      else {
        const rect = mapContainer.getBoundingClientRect();
        cloudCtx.clearRect(0, 0, rect.width, rect.height);
      }
      drawSwellCompass();
    }

    function beginInteraction() {
      mapIsInteracting = true;
      needsMask = true;
      maskData = null;
      const rect = mapContainer.getBoundingClientRect();
      waveCtx.clearRect(0, 0, rect.width, rect.height);
      particleCtx.clearRect(0, 0, rect.width, rect.height);
      cloudCtx.clearRect(0, 0, rect.width, rect.height);
      compassCtx.clearRect(0, 0, rect.width, rect.height);
      window.clearTimeout(settleTimer);
    }

    function endInteraction() {
      mapIsInteracting = false;
      needsMask = true;
      maskData = null;
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(redraw, 80);
    }

    resize();
    seedParticles();
    animationId = window.requestAnimationFrame(tickParticles);
    map.on("resize", resize);
    map.on("movestart", beginInteraction);
    map.on("zoomstart", beginInteraction);
    map.on("dragstart", beginInteraction);
    map.on("moveend", endInteraction);
    map.on("zoomend", endInteraction);
    map.on("idle", endInteraction);
    window.addEventListener("resize", resize);

    return {
      setWaveGrid(next) {
        waveGrid = next;
        map.__diveProSpotWaveGrid = next;
        seedParticles();
        redraw();
      },
      setCloudGrid(next) {
        cloudGrid = next;
        redraw();
      },
      redraw,
    };
  }

  function ensureLayerButtons(frame) {
    const toggle = frame.querySelector(".map-layer-toggle");
    if (!toggle) return;
    const needed = [
      { layer: "wind", label: "Wind" },
      { layer: "waves", label: "Waves" },
      { layer: "clouds", label: "Clouds" },
      { layer: "depth", label: "Depth" },
    ];
    const existing = new Map(
      Array.from(toggle.querySelectorAll("[data-map-layer]")).map((button) => [button.dataset.mapLayer, button]),
    );
    needed.forEach(({ layer, label }, index) => {
      if (existing.has(layer)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mapLayer = layer;
      button.setAttribute("aria-pressed", "false");
      button.textContent = label;
      const depth = existing.get("depth");
      if (depth && (layer === "waves" || layer === "clouds")) toggle.insertBefore(button, depth);
      else if (index === 0) toggle.prepend(button);
      else toggle.appendChild(button);
    });
  }

  function isMobileWindLegend() {
    return window.matchMedia("(max-width: 979px)").matches;
  }

  function setWindLegendOpen(legend, open) {
    if (!legend) return;
    legend.classList.toggle("is-open", open);
    const chip = legend.querySelector(".wind-legend-chip");
    if (chip) {
      chip.setAttribute("aria-expanded", open ? "true" : "false");
      chip.setAttribute("aria-label", open ? "Hide wind speed scale" : "Show wind speed scale");
    }
  }

  function closeAllWindLegends(except) {
    document.querySelectorAll(".spot-wind-legend.is-open").forEach((legend) => {
      if (legend !== except) setWindLegendOpen(legend, false);
    });
  }

  function enhanceWindLegend(legend) {
    if (!legend || legend.dataset.windPopupReady === "1") return;
    legend.dataset.windPopupReady = "1";

    const panel = document.createElement("div");
    panel.className = "wind-legend-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Wind speed scale");
    while (legend.firstChild) panel.appendChild(legend.firstChild);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "wind-legend-close";
    close.setAttribute("aria-label", "Close wind speed scale");
    close.textContent = "×";
    panel.appendChild(close);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "wind-legend-chip";
    chip.setAttribute("aria-expanded", "false");
    chip.setAttribute("aria-label", "Show wind speed scale");
    chip.textContent = "MPH";

    legend.append(chip, panel);

    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isMobileWindLegend()) return;
      setWindLegendOpen(legend, !legend.classList.contains("is-open"));
    });
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setWindLegendOpen(legend, false);
    });
  }

  function bindWindLegendDismiss() {
    if (window.__diveProWindLegendDismissBound) return;
    window.__diveProWindLegendDismissBound = true;
    document.addEventListener("pointerdown", (event) => {
      const open = event.target.closest(".spot-wind-legend");
      closeAllWindLegends(open);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAllWindLegends();
    });
    window.matchMedia("(max-width: 979px)").addEventListener("change", (event) => {
      if (!event.matches) closeAllWindLegends();
    });
    window.addEventListener("divepro:mapLayer", () => closeAllWindLegends());
  }

  function enhanceWindLegends(root) {
    (root || document).querySelectorAll(".spot-wind-legend").forEach(enhanceWindLegend);
    bindWindLegendDismiss();
  }

  function ensureLegends(frame) {
    const graphic = frame.querySelector(".spot-map-graphic") || frame;
    enhanceWindLegends(graphic);
    if (!graphic.querySelector(".wave-legend")) {
      const legend = document.createElement("div");
      legend.className = "ocean-legend wave-legend";
      legend.setAttribute("aria-label", "Wave height legend");
      legend.innerHTML = `
        <span>Waves ft</span>
        <div class="ocean-legend-gradient wave-legend-gradient"></div>
        <div class="ocean-legend-labels"><b>0</b><b>3</b><b>6</b><b>10+</b></div>
      `;
      graphic.appendChild(legend);
    }
    if (!graphic.querySelector(".cloud-legend")) {
      const legend = document.createElement("div");
      legend.className = "ocean-legend cloud-legend";
      legend.setAttribute("aria-label", "Cloud cover legend");
      legend.innerHTML = `
        <span>Clouds</span>
        <div class="ocean-legend-gradient cloud-legend-gradient"></div>
        <div class="ocean-legend-labels"><b>0%</b><b>50%</b><b>100%</b></div>
      `;
      graphic.appendChild(legend);
    }
  }

  function formatWaveProbe(sample) {
    if (!sample) return { title: "Waves", value: "No waves", meta: "", trains: [] };
    const combined = Number.isFinite(sample.heightFt) ? `${Math.round(sample.heightFt)} ft` : "No waves";
    const trains = [];
    const primaryToken = formatTrainToken(sample.primary);
    const secondaryToken = formatTrainToken(sample.secondary);
    if (primaryToken) trains.push({ label: primaryToken, direction: sample.primary?.direction ?? sample.direction });
    if (secondaryToken) trains.push({ label: secondaryToken, direction: sample.secondary?.direction });
    return {
      title: "Waves",
      value: combined,
      meta: "",
      direction: sample.primary?.direction ?? sample.direction,
      trains,
    };
  }

  function formatCloudProbe(sample) {
    if (!sample) return { title: "Clouds", value: "No clouds", meta: "" };
    return {
      title: "Clouds",
      value: `${Math.round(sample.cover)}%`,
      meta: "Cover",
    };
  }

  window.__diveProOceanSample = function oceanSample(map, lngLat) {
    const layer = map?.__diveProActiveLayer;
    if (layer === "waves") return { layer, ...formatWaveProbe(sampleWave(map.__diveProSpotWaveGrid, lngLat.lng, lngLat.lat)) };
    if (layer === "clouds") return { layer, ...formatCloudProbe(sampleCloud(map.__diveProSpotWindGrid, lngLat.lng, lngLat.lat)) };
    return null;
  };

  window.__diveProSampleWaveAt = function sampleWaveAt(lon, lat, map) {
    const target = map || window.__diveProSpotRegionMap;
    return sampleWave(target?.__diveProSpotWaveGrid, lon, lat);
  };

  async function attach(map) {
    if (!map || map.__diveProOceanLayersAttached) return;
    map.__diveProOceanLayersAttached = true;
    const frame = map.getContainer()?.closest(".spot-map-frame");
    if (frame) {
      ensureLayerButtons(frame);
      ensureLegends(frame);
    }

    let waterMask = { features: [] };
    try {
      const response = await fetch(WATER_MASK_PATH, { cache: "no-store" });
      if (response.ok) waterMask = await response.json();
    } catch {
      waterMask = { features: [] };
    }

    const overlay = createOceanOverlay(map, waterMask);
    map.__diveProOceanOverlay = overlay;
    if (map.__diveProSpotWindGrid) overlay?.setCloudGrid(map.__diveProSpotWindGrid);

    window.addEventListener("divepro:mapLayer", () => overlay?.redraw());
    window.addEventListener("divepro:oceanLayerFrame", (event) => {
      const iso = event.detail?.iso;
      if (map.__diveProSpotWindGrid) overlay?.setCloudGrid(map.__diveProSpotWindGrid);
      if (map.__diveProWaveManifest) {
        const frameData = nearestWaveFrame(map.__diveProWaveManifest, iso);
        overlay?.setWaveGrid(frameData?.grid || null);
      }
    });

    try {
      const manifest = await loadWaveManifest();
      map.__diveProWaveManifest = manifest;
      const iso = map.__diveProActiveFrameIso;
      overlay?.setWaveGrid(nearestWaveFrame(manifest, iso)?.grid || manifest.frames[0].grid);
    } catch (error) {
      console.warn("Dive Pro wave overlay unavailable", error);
    }
  }

  function boot() {
    ensureStylesheet();
    enhanceWindLegends(document);
    const start = Date.now();
    const wait = window.setInterval(() => {
      const map = window.__diveProSpotRegionMap;
      if (map?.loaded?.() || map?.isStyleLoaded?.()) {
        window.clearInterval(wait);
        attach(map);
        return;
      }
      if (Date.now() - start > 30000) window.clearInterval(wait);
    }, 200);
    window.addEventListener("divepro:spotMapReady", (event) => attach(event.detail?.map || window.__diveProSpotRegionMap));
  }

  window.__diveProOceanLayersLoaded = true;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}());
