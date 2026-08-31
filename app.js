import { forecastFromFeatures } from "./visibilityModel.js";
import {
  swellSourceBearingToTravelBearing,
  swellTravelBearingToArrowRotateDeg,
  defaultSwellArrowSpec,
  separateSwellArrowPair,
} from "./swell-bearing.js";

window.swellSourceBearingToTravelBearing = swellSourceBearingToTravelBearing;
window.swellTravelBearingToArrowRotateDeg = swellTravelBearingToArrowRotateDeg;

const DISPLAY_HS_TO_CHAR = 0.625; // 1 / 1.6, display-only Hs to characteristic height.
const DISPLAY_WAVE_MODERATE_FT = 2 * DISPLAY_HS_TO_CHAR;
const DISPLAY_WAVE_SHORT_HEAVY_FT = 3 * DISPLAY_HS_TO_CHAR;
const DISPLAY_WAVE_HEAVY_FT = 4 * DISPLAY_HS_TO_CHAR;

const fallback = {
  date: "2026-05-23",
  location: "La Jolla / Scripps Pier",
  features: {
    date: "2026-05-23",
    surf_height_max_ft: 2,
    total_swell_height_mean_ft: 2.5,
    short_period_swell_energy: 8.2,
    wind_speed_max_mph: 8,
    wave_energy_mean_kj: 29,
    mixed_swell_score: 1,
  },
};

const PUBLISHED_LA_JOLLA_ORIGIN = "https://diveprosd.com";

async function fetchJson(path) {
  const absolute = /^https?:/i.test(path);
  const url = absolute || path.includes("?") ? path : `${path}?t=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

function forecastDateKey(forecast) {
  return String(forecast?.date || forecast?.features?.date || "");
}

function isForecastForToday(forecast, today = localTodayInLaJolla()) {
  return forecastDateKey(forecast) === today;
}

function embeddedMontereyForecast() {
  const node = document.getElementById("montereyForecastEmbed");
  if (!node) return null;
  try {
    return JSON.parse(node.textContent);
  } catch {
    return null;
  }
}

async function loadMontereyForecastJson(spot) {
  const path = spot.forecastPath || `model_outputs/spots/${spot.slug}.json`;
  try {
    return await fetchJson(path);
  } catch (error) {
    const embedded = embeddedMontereyForecast();
    if (embedded) return embedded;
    throw error;
  }
}

function californiaSpots() {
  if (typeof window.californiaSpots === "function") return window.californiaSpots();
  return (window.outdoorSpots || []).filter((spot) => spot.regionGroup === "California");
}

function isMontereySpot(spot) {
  if (typeof window.isMontereySpot === "function") return window.isMontereySpot(spot);
  return Boolean(spot && (spot.regionCluster === "monterey" || String(spot.slug || "").startsWith("monterey")));
}

function slugFromPathname(pathname = window.location.pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  let last = (parts.pop() || "").replace(/\.html$/i, "");
  if (!last || last === "index") last = (parts.pop() || "").replace(/\.html$/i, "");
  if (!last || last === "Dive-Pro-Demo") return "";
  return last;
}

function currentPageSlug() {
  const file = slugFromPathname();
  if (file) return file;
  if (document.body.classList.contains("home-directory") || document.body.dataset.page === "home") {
    return "";
  }
  return "la-jolla";
}

function currentSpot() {
  const slug = currentPageSlug();
  if (typeof window.spotFromSlug === "function") return window.spotFromSlug(slug);
  return californiaSpots().find((spot) => spot.slug === slug) || californiaSpots()[0] || {
    slug: "la-jolla",
    name: "Scripps Beach",
    location: "La Jolla / Scripps Pier",
    href: "la-jolla.html",
    hasModelForecast: true,
  };
}

function spotHref(slug) {
  const spot = californiaSpots().find((item) => item.slug === slug);
  return spot?.href || (slug === "la-jolla" ? "la-jolla.html" : `${slug}.html`);
}

function isOnSpotPage(spot) {
  const file = slugFromPathname();
  if (file === spot.slug) return true;
  const query = new URLSearchParams(window.location.search).get("spot");
  if (query === spot.slug) return true;
  if (document.body.classList.contains("home-directory") || document.body.dataset.page === "home") {
    return false;
  }
  return (!file || file === "index") && spot.slug === "la-jolla" && !query;
}

function metersToFeet(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 3.28084 : null;
}

function celsiusToFahrenheit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? (number * 9) / 5 + 32 : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function maxFinite(values) {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value));
  return numbers.length ? Math.max(...numbers) : null;
}

function indexOfMaxFinite(values) {
  return values.reduce((best, value, index) => (
    Number.isFinite(value) && (best < 0 || value > values[best]) ? index : best
  ), -1);
}

function isoDateKey(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function hourKey(iso) {
  const match = String(iso || "").match(/(?:T|\s)(\d{2}):/);
  return match ? `${match[1]}:00` : "";
}

function noaaDateStamp(date = localTodayInLaJolla()) {
  return String(date).replaceAll("-", "");
}

function pagePublishesVisGrades(spot = currentSpot()) {
  if (typeof window.spotPublishesVisGrades === "function") {
    return window.spotPublishesVisGrades(spot);
  }
  const slug = String(spot?.slug || currentPageSlug() || "");
  if (slug === "catalina-wrigley" || slug === "anacapa-ocean") return false;
  if (spot && spot.hasModelForecast === false) return false;
  if (spot && !spot.forecastPath && slug !== "la-jolla" && !isMontereySpot(spot)) return false;
  return Boolean(spot?.hasModelForecast || slug === "la-jolla" || isMontereySpot(spot));
}

function isIslandConditionsSpot(spot = currentSpot()) {
  const slug = String(spot?.slug || currentPageSlug() || "");
  return slug === "anacapa-ocean" || slug === "catalina-wrigley";
}

function hideUnpublishedVisChrome() {
  document.querySelectorAll([
    ".forecast-main",
    ".score-row",
    ".wave-weight",
    ".best-window",
    ".daily-report-card",
    ".ten-day-card",
    "#forecastStrip",
    "#gradeGuideHeroTrigger",
    ".grade-guide-hint",
  ].join(", ")).forEach((el) => el.remove());
  const wrap = document.querySelector(".grade-guide-letter-wrap");
  if (wrap) {
    const grade = wrap.querySelector("#grade");
    if (grade) wrap.replaceWith(grade);
    else wrap.remove();
  }
  document.querySelectorAll(".grade-guide-trigger").forEach((el) => {
    const grade = el.querySelector("#grade");
    if (grade) el.replaceWith(grade);
    else el.remove();
  });
  document.getElementById("gradeGuidePopover")?.remove();
  const panel = document.querySelector(".forecast-panel");
  if (panel) {
    panel.classList.add("is-name-only");
    panel.classList.remove("is-unavailable");
  }
}

function unavailableSpotForecast(spot, features = {}, { conditionsLoaded = false } = {}) {
  return {
    date: localTodayInLaJolla(),
    location: spot.location,
    spot_slug: spot.slug,
    is_unavailable: true,
    grade: null,
    estimated_visibility_range_ft: null,
    numeric_score_0_100: 0,
    best_window: "",
    swell_source: "Open-Meteo / NDBC",
    tide_source: features.tide_source || "",
    report_text: "",
    features,
  };
}

function liveFeaturesPresent(features = {}) {
  return Boolean(
    Number.isFinite(Number(features.swell_wave_height_max_ft))
    || Number.isFinite(Number(features.wind_speed_max_mph))
    || (Array.isArray(features.wind_chart) && features.wind_chart.length)
    || (Array.isArray(features.tide_chart) && features.tide_chart.length)
    || Number.isFinite(Number(features.water_temp_estimate_f)),
  );
}

const MARINE_DISTINCT_HEADING_DEG = 28;
const MARINE_SAME_TRAIN_DEG = 12;
const MARINE_SECONDARY_MIN_FT = 0.3;
const MARINE_NOW_TOLERANCE_MS = 90 * 60 * 1000;

function parseOpenMeteoWallClock(stamp, timeZone = "America/Los_Angeles") {
  const raw = String(stamp || "");
  if (!raw) return NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : NaN;
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) {
    const time = new Date(raw).getTime();
    return Number.isFinite(time) ? time : NaN;
  }
  const asUtc = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(asUtc));
  const num = (type) => Number(parts.find((part) => part.type === type)?.value);
  const shown = Date.UTC(num("year"), num("month") - 1, num("day"), num("hour"), num("minute"));
  return asUtc + (asUtc - shown);
}

function nearestMarineHourIndex(times, now = Date.now()) {
  const stamps = Array.isArray(times) ? times : [];
  let best = -1;
  let bestDelta = Infinity;
  stamps.forEach((stamp, index) => {
    const time = parseOpenMeteoWallClock(stamp);
    if (!Number.isFinite(time)) return;
    const delta = Math.abs(time - now);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  if (best >= 0) return best;
  return Math.max(0, stamps.length - 1);
}

function readMarineTrain(hourly, timeIndex, prefix) {
  const heightFt = metersToFeet(hourly?.[`${prefix}_height`]?.[timeIndex]);
  const direction = finiteNumber(hourly?.[`${prefix}_direction`]?.[timeIndex]);
  const period = finiteNumber(hourly?.[`${prefix}_period`]?.[timeIndex]);
  if (Number.isFinite(heightFt) && Number.isFinite(direction)) {
    return { heightFt, direction, period };
  }
  return null;
}

function marineTrainScore(train) {
  return (Number.isFinite(train?.period) ? train.period : 0) * 8 + (train?.heightFt || 0);
}

/* Same heading-cluster as ocean-layers pickTrains. Open-Meteo swaps
   swell_wave vs secondary_swell labels cell-to-cell; do not trust names. */
function pickMarineTrains(hourly, timeIndex) {
  const swell = readMarineTrain(hourly, timeIndex, "swell_wave");
  const secondarySwell = readMarineTrain(hourly, timeIndex, "secondary_swell_wave");
  const windWave = readMarineTrain(hourly, timeIndex, "wind_wave");
  const combined = readMarineTrain(hourly, timeIndex, "wave");
  const unique = [];
  [swell, secondarySwell].forEach((train) => {
    if (!train) return;
    const twinIndex = unique.findIndex((other) => (
      angularDistanceDeg(other.direction, train.direction) < MARINE_SAME_TRAIN_DEG
    ));
    if (twinIndex < 0) {
      unique.push(train);
      return;
    }
    if (marineTrainScore(train) > marineTrainScore(unique[twinIndex])) unique[twinIndex] = train;
  });
  const windDistinct = Boolean(
    windWave
    && windWave.heightFt >= MARINE_SECONDARY_MIN_FT
    && !isEasterlyComingFrom(windWave.direction)
    && unique.every((other) => (
      angularDistanceDeg(other.direction, windWave.direction) >= MARINE_DISTINCT_HEADING_DEG
    )),
  );
  if (windDistinct) unique.push(windWave);
  unique.sort((left, right) => {
    const periodDelta = (right.period || 0) - (left.period || 0);
    if (Math.abs(periodDelta) >= 1) return periodDelta;
    return (right.heightFt || 0) - (left.heightFt || 0);
  });
  const primary = unique[0] || combined || null;
  const secondary = unique.find((train, index) => (
    index > 0
    && train.heightFt >= MARINE_SECONDARY_MIN_FT
    && primary
    && angularDistanceDeg(primary.direction, train.direction) >= MARINE_DISTINCT_HEADING_DEG
  )) || null;
  return { primary, secondary };
}

function trainFeatureFields(train, role) {
  if (!train || !Number.isFinite(train.direction)) {
    return role === "primary"
      ? {
        swell_wave_height_max_ft: null,
        swell_wave_period_max_s: null,
        swell_wave_direction_deg: null,
        swell_direction_label: "",
      }
      : {
        secondary_swell_height_ft: null,
        secondary_swell_period_s: null,
        secondary_swell_direction_deg: null,
        secondary_swell_direction_label: "",
      };
  }
  const label = directionFromDegrees(train.direction);
  if (role === "primary") {
    return {
      swell_wave_height_max_ft: train.heightFt,
      swell_wave_period_max_s: train.period,
      swell_wave_direction_deg: train.direction,
      swell_direction_label: label,
    };
  }
  return {
    secondary_swell_height_ft: train.heightFt,
    secondary_swell_period_s: train.period,
    secondary_swell_direction_deg: train.direction,
    secondary_swell_direction_label: label,
  };
}

async function fetchOpenMeteoMarine(spot) {
  const lat = Number(spot.marineLat ?? spot.lat);
  const lon = Number(spot.marineLon ?? spot.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,secondary_swell_wave_height,secondary_swell_wave_direction,secondary_swell_wave_period,wind_wave_height,wind_wave_period,wind_wave_direction,sea_surface_temperature&forecast_days=1&timezone=America/Los_Angeles`;
  const marine = await fetchJson(marineUrl);
  const hourly = marine.hourly || {};
  const timeIndex = nearestMarineHourIndex(hourly.time || []);
  const { primary, secondary } = pickMarineTrains(hourly, timeIndex);
  const waveHeights = (hourly.wave_height || []).map(metersToFeet);
  const windWave = readMarineTrain(hourly, timeIndex, "wind_wave");
  const windWaveHeights = (hourly.wind_wave_height || []).map(metersToFeet);
  const waterTemps = (hourly.sea_surface_temperature || []).map(celsiusToFahrenheit);
  const combinedHeight = metersToFeet(hourly.wave_height?.[timeIndex]) ?? maxFinite(waveHeights);

  return {
    surf_height_max_ft: maxFinite(waveHeights),
    wave_height_max_ft: maxFinite(waveHeights),
    ...trainFeatureFields(primary, "primary"),
    ...trainFeatureFields(secondary, "secondary"),
    wind_wave_height_max_ft: windWave?.heightFt ?? maxFinite(windWaveHeights),
    wind_wave_period_max_s: windWave?.period ?? null,
    wind_wave_direction_deg: windWave?.direction ?? null,
    total_swell_height_mean_ft: primary?.heightFt ?? combinedHeight,
    water_temp_estimate_f: maxFinite(waterTemps),
    swell_source: "Open-Meteo",
    swell_trains_live: true,
  };
}

function dailyIndexForDate(daily, dateKey) {
  return (daily?.time || []).findIndex((value) => isoDateKey(value) === dateKey);
}

function dailyNumberOnDate(daily, field, dateKey) {
  const index = dailyIndexForDate(daily, dateKey);
  return index < 0 ? null : finiteNumber(daily?.[field]?.[index]);
}

function hourlyNumbersOnDate(hourly, field, dateKey) {
  return (hourly?.time || []).map((time, index) => (
    isoDateKey(time) === dateKey ? finiteNumber(hourly?.[field]?.[index]) : null
  )).filter((value) => value != null);
}

function weatherCardForDate(daily, hourly, dateKey) {
  const high = dailyNumberOnDate(daily, "temperature_2m_max", dateKey)
    ?? maxFinite(hourlyNumbersOnDate(hourly, "temperature_2m", dateKey));
  const rain = dailyNumberOnDate(daily, "precipitation_sum", dateKey);
  const hourlyRain = hourlyNumbersOnDate(hourly, "precipitation", dateKey);
  const rainFromHours = hourlyRain.length
    ? hourlyRain.reduce((sum, value) => sum + value, 0)
    : null;
  const rainIn = rain ?? rainFromHours;
  const card = {};
  if (high != null) card.air_temp_max_f = high;
  if (rainIn != null) {
    card.rain_24h_in = rainIn;
    card.rain_target_day_forecast_in = rainIn;
  }
  return card;
}

function mergeDefinedFeatures(base, extra) {
  const merged = { ...(base || {}) };
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    if (Array.isArray(value) && !value.length) return;
    if (key === "weather_by_date" || key === "wind_chart_by_date" || key === "tide_chart_by_date") return;
    merged[key] = value;
  });
  return merged;
}

function shiftIsoDateKey(dateKey, days) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days));
  return new Date(utc).toISOString().slice(0, 10);
}

function windChartsFromHourly(hourly = {}) {
  const byDate = {};
  (hourly.time || []).forEach((time, index) => {
    const date = isoDateKey(time);
    const clock = hourKey(time);
    const speed = finiteNumber(hourly.wind_speed_10m?.[index]);
    if (!date || !clock || !Number.isFinite(speed)) return;
    (byDate[date] ||= []).push({
      time: clock,
      speed_mph: speed,
      direction_deg: finiteNumber(hourly.wind_direction_10m?.[index]),
    });
  });
  return byDate;
}

function windFeaturesForDate(windByDate, dateKey) {
  const points = windByDate?.[dateKey] || [];
  if (!points.length) return {};
  return {
    wind_chart: points.map(({ time, speed_mph }) => ({ time, speed_mph })),
    wind_speed_max_mph: maxFinite(points.map((point) => point.speed_mph)),
    wind_direction_deg: points.find((point) => Number.isFinite(point.direction_deg))?.direction_deg ?? null,
  };
}

function tideChartsFromPredictions(predictions) {
  const byDate = {};
  predictions.forEach((row) => {
    const stamp = String(row.t || "").replace(" ", "T");
    const date = isoDateKey(stamp);
    const point = {
      time: hourKey(stamp),
      height_ft: finiteNumber(row.v),
    };
    if (!date || !point.time || !Number.isFinite(point.height_ft)) return;
    (byDate[date] ||= []).push(point);
  });
  return byDate;
}

function attachWeatherCard(forecast, liveWeather) {
  if (!forecast) return forecast;
  const dateKey = isoDateKey(forecast.date || forecast.features?.date) || localTodayInLaJolla();
  const todayKey = localTodayInLaJolla();
  const byDate = liveWeather?.weather_by_date || {};
  const dayCard = byDate[dateKey] || {};
  const todayCard = byDate[todayKey] || {};
  const extras = {};
  if (todayCard.air_temp_max_f != null) extras.air_temp_max_f = todayCard.air_temp_max_f;
  else if (Number.isFinite(Number(liveWeather?.air_temp_max_f))) extras.air_temp_max_f = liveWeather.air_temp_max_f;
  if (dayCard.rain_24h_in != null) {
    extras.rain_24h_in = dayCard.rain_24h_in;
    extras.rain_target_day_forecast_in = dayCard.rain_target_day_forecast_in ?? dayCard.rain_24h_in;
  } else if (dateKey === todayKey && liveWeather?.rain_24h_in != null) {
    extras.rain_24h_in = liveWeather.rain_24h_in;
    extras.rain_target_day_forecast_in = liveWeather.rain_target_day_forecast_in ?? liveWeather.rain_24h_in;
  }
  if (dateKey === todayKey && Number.isFinite(Number(liveWeather?.rain_prior_3day_in))) {
    extras.rain_prior_3day_in = liveWeather.rain_prior_3day_in;
  }
  if (!Object.keys(extras).length) return forecast;
  return {
    ...forecast,
    features: mergeDefinedFeatures(forecast.features, extras),
  };
}

function attachLiveCharts(forecast, live) {
  if (!forecast) return forecast;
  const dateKey = isoDateKey(forecast.date || forecast.features?.date) || localTodayInLaJolla();
  const wind = windFeaturesForDate(live?.wind_chart_by_date, dateKey);
  const tideChart = live?.tide_chart_by_date?.[dateKey]
    || (dateKey === localTodayInLaJolla() && Array.isArray(live?.tide_chart) ? live.tide_chart : null);
  const extras = { ...wind };
  if (Array.isArray(tideChart) && tideChart.length) {
    extras.tide_chart = tideChart;
    if (live?.tide_source) extras.tide_source = live.tide_source;
  }
  if (!Object.keys(extras).length) return forecast;
  return {
    ...forecast,
    features: mergeDefinedFeatures(forecast.features, extras),
  };
}

function decorateForecast(forecast, { live, sunByDate } = {}) {
  return attachLiveCharts(
    attachWeatherCard(attachSunTimes(enrichForecastSwell(forecast, live), sunByDate), live),
    live,
  );
}

async function fetchOpenMeteoWeather(spot) {
  const lat = Number(spot.lat);
  const lon = Number(spot.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // Pacific calendar dates, not UTC. Skip forecast_hours so past_days rows stay intact.
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_direction_10m,precipitation,temperature_2m&daily=temperature_2m_max,precipitation_sum,sunrise,sunset&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&forecast_days=10&past_days=3&timezone=America/Los_Angeles`;
  const weather = await fetchJson(weatherUrl);
  const hourly = weather.hourly || {};
  const daily = weather.daily || {};
  const today = localTodayInLaJolla();
  const dailyKeys = (daily.time || []).map(isoDateKey).filter(Boolean);
  const weatherByDate = {};
  const dateKeys = new Set([...dailyKeys, today]);
  (hourly.time || []).forEach((time) => {
    const key = isoDateKey(time);
    if (key) dateKeys.add(key);
  });
  [...dateKeys].sort().forEach((key) => {
    const card = weatherCardForDate(daily, hourly, key);
    if (Object.keys(card).length) weatherByDate[key] = card;
  });
  const todayCard = weatherByDate[today] || {};
  const priorKeys = dailyKeys.filter((key) => key && key < today).sort().slice(-3);
  const rainPrior = priorKeys.length
    ? priorKeys.reduce((sum, key) => {
        const rain = weatherByDate[key]?.rain_24h_in;
        return sum + (Number.isFinite(rain) ? rain : 0);
      }, 0)
    : null;
  const windByDate = windChartsFromHourly(hourly);
  const todayWind = windFeaturesForDate(windByDate, today);
  const sun = sunTimesFromDaily(daily, today);

  return {
    ...todayWind,
    ...todayCard,
    rain_prior_3day_in: rainPrior,
    wind_chart_by_date: windByDate,
    weather_by_date: weatherByDate,
    ...(sun || {}),
  };
}

function clockLabelFromHour(hour) {
  const raw = ((Number(hour) % 24) + 24) % 24;
  let minutes = Math.round(raw * 60);
  if (minutes === 1440) minutes = 0;
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const display = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? "am" : "pm";
  return `${display}:${String(minute).padStart(2, "0")}${suffix}`;
}

function decimalHourFromIso(iso) {
  const match = String(iso || "").match(/T(\d{1,2}):(\d{2})/);
  if (match) return Number(match[1]) + Number(match[2]) / 60;
  return pacificDecimalHour(new Date(iso));
}

function sunTimesFromDaily(daily, dateKey) {
  const times = daily?.time || [];
  const index = times.findIndex((value) => isoDateKey(value) === dateKey);
  if (index < 0) return null;
  const sunriseHour = decimalHourFromIso(daily.sunrise?.[index]);
  const sunsetHour = decimalHourFromIso(daily.sunset?.[index]);
  if (sunriseHour == null || sunsetHour == null || sunsetHour <= sunriseHour) return null;
  return {
    sunrise_hour: sunriseHour,
    sunset_hour: sunsetHour,
    sunrise_label: clockLabelFromHour(sunriseHour),
    sunset_label: clockLabelFromHour(sunsetHour),
  };
}

async function fetchOpenMeteoSunTimes(spot) {
  const lat = Number(spot.lat);
  const lon = Number(spot.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return {};
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=sunrise,sunset&timezone=America/Los_Angeles&forecast_days=14&past_days=7`;
  const weather = await fetchJson(url);
  const daily = weather.daily || {};
  const byDate = {};
  (daily.time || []).forEach((date) => {
    const key = isoDateKey(date);
    const sun = sunTimesFromDaily(daily, key);
    if (key && sun) byDate[key] = sun;
  });
  return byDate;
}

function attachSunTimes(forecast, sunByDate) {
  if (!forecast) return forecast;
  const key = isoDateKey(forecast.date || forecast.features?.date);
  const sun = sunByDate?.[key];
  if (!sun) return forecast;
  return {
    ...forecast,
    features: {
      ...(forecast.features || {}),
      ...sun,
    },
  };
}

async function fetchNoaaTideChart(station) {
  if (!station?.id) return null;
  const today = localTodayInLaJolla();
  const begin = noaaDateStamp(shiftIsoDateKey(today, -1) || today);
  const end = noaaDateStamp(shiftIsoDateKey(today, 9) || today);
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=DiveProDemo&begin_date=${begin}&end_date=${end}&datum=MLLW&station=${encodeURIComponent(station.id)}&time_zone=lst_ldt&units=english&interval=h&format=json`;
  const data = await fetchJson(url);
  const predictions = Array.isArray(data?.predictions) ? data.predictions : [];
  const byDate = tideChartsFromPredictions(predictions);
  const todayChart = byDate[today] || [];
  if (!Object.keys(byDate).length) return null;
  return {
    tide_chart: todayChart,
    tide_chart_by_date: byDate,
    tide_source: station.label || `NOAA ${station.id}`,
  };
}

async function fetchSpotTideFeatures(spot) {
  const primary = spot.tideStation;
  if (!primary?.id) return null;
  const stations = [primary];
  if (primary.fallbackId) {
    stations.push({
      id: primary.fallbackId,
      label: primary.fallbackLabel || `NOAA ${primary.fallbackId}`,
    });
  }
  for (const station of stations) {
    try {
      const tide = await fetchNoaaTideChart(station);
      if (tide) return tide;
    } catch {
      // Try the next verified station. A missing island gauge must not blank swell/wind.
    }
  }
  return null;
}

async function fetchLiveSpotFeatures(spot) {
  const [marine, weather, tide] = await Promise.all([
    fetchOpenMeteoMarine(spot).catch(() => null),
    fetchOpenMeteoWeather(spot).catch(() => null),
    fetchSpotTideFeatures(spot).catch(() => null),
  ]);
  return {
    ...(marine || {}),
    ...(weather || {}),
    ...(tide || {}),
  };
}

function initSpotPicker(activeSpot) {
  const nameEl = document.getElementById("spotHeading");
  if (nameEl) {
    nameEl.textContent = activeSpot.pickerLabel || activeSpot.name;
  }
  document.querySelectorAll(".spot-heading-kicker, .spot-heading-region").forEach((el) => el.remove());
}

function swellMapFallbackImage(spot) {
  const bounds = swellMapSeedBoundsForSpot(spot);
  const [west, south] = bounds[0];
  const [east, north] = bounds[1];
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${west},${south},${east},${north}&bboxSR=4326&imageSR=3857&size=900,720&format=jpg&f=image`;
}

function updateSpotChrome(spot) {
  document.body.dataset.spot = spot.slug;
  const regionLabel = document.getElementById("regionMapLabel");
  if (regionLabel) {
    regionLabel.textContent = spot.regionLabel || spot.location;
  }
  const swellMap = document.getElementById("swellMap");
  if (swellMap) swellMap.setAttribute("aria-label", `${spot.regionLabel || spot.name} coastline map`);
  const swellPanel = document.querySelector(".swell-map-panel");
  if (swellPanel) swellPanel.style.backgroundImage = `url("${swellMapFallbackImage(spot)}")`;
  const liveLink = document.querySelector(".camera-live-link");
  if (liveLink) {
    if (spot.cameraUrl) {
      liveLink.hidden = false;
      liveLink.href = spot.cameraUrl;
      liveLink.setAttribute("aria-label", `Open the ${spot.cameraLabel || "live camera"} in a new tab`);
      liveLink.innerHTML = `${spot.cameraLabel || "Live cam"} <span aria-hidden="true">&nearr;</span>`;
    } else {
      liveLink.hidden = true;
    }
  }
  if (isMontereySpot(spot)) {
    document.title = `DiveProCA | ${spot.name} dive visibility (beta)`;
  } else {
    document.title = spot.hasModelForecast
      ? "DiveProCA | La Jolla Dive Visibility Forecast"
      : `DiveProCA | ${spot.menuName || spot.name} location preview`;
  }
}

function fallbackForecast() {
  const computed = forecastFromFeatures(fallback.features);
  return {
    ...fallback,
    grade: computed.grade,
    numeric_score_0_100: computed.score,
    estimated_visibility_range_ft: computed.visibilityRange,
    estimated_visibility_mid_ft: computed.visibilityMid,
    confidence: computed.confidence,
    best_window: computed.bestWindow,
    risk_factors: computed.riskFactors,
    positive_factors: computed.positiveFactors,
    explanation: "Score starts at 70, then adjusts for total swell, surf height, short-period energy, wind, mixed swell, and wave energy.",
    is_projected: false,
  };
}

function localTodayInLaJolla(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(date);
}

function isCameraObservationDisplayable(observation, now = new Date()) {
  // Failed attempts are stored separately and can never displace this pointer.
  // Automated updates must carry source-freshness evidence from the live-feed
  // validator. A manual review may approve a capture independently.
  return Boolean(
    observation &&
      observation.capture_ok === true &&
      observation.image_url &&
      observation.observation_date &&
      (
        observation.source_freshness_verified === true ||
        observation.validation_source === "manual_review"
      ),
  );
}

// Why the reference image (not a live frame) is on screen. Set by
// loadCameraObservation before first render; renderCamera turns it into a
// visible label so the fallback is never mistaken for a live capture.
//   "pending"     -> no validated record exists yet
//   "offline"     -> today's latest attempt failed / was unusable
//   "unavailable" -> status feed unreachable or screenshot publishing off
let scrippsCameraFallbackReason = "unavailable";

async function loadCameraObservation() {
  try {
    const config = await fetchJson("camera-config.json");
    if (!config || config.publish_screenshots !== true) {
      scrippsCameraFallbackReason = "unavailable";
      return null;
    }
    const requestToken = Date.now();
    const [lastValid, latestAttempt] = await Promise.all([
      fetchJson(
        `camera-snapshots/scripps-pier-last-valid.json?t=${requestToken}`,
      ).catch(() => null),
      fetchJson(
        `camera-snapshots/scripps-pier-latest-attempt.json?t=${requestToken}`,
      ).catch(() => null),
    ]);
    if (isCameraObservationDisplayable(lastValid)) return lastValid;
    if (
      latestAttempt &&
      latestAttempt.observation_date === localTodayInLaJolla() &&
      latestAttempt.capture_ok !== true
    ) {
      scrippsCameraFallbackReason = "offline";
    } else {
      scrippsCameraFallbackReason = "pending";
    }
    return null;
  } catch {
    scrippsCameraFallbackReason = "unavailable";
    return null;
  }
}

function enrichForecastSwell(forecast, marine) {
  if (!forecast) return forecast;
  const features = { ...(forecast.features || {}) };
  if (!marine) return { ...forecast, features };
  if (marine.swell_trains_live === true) {
    const livePrimary = trainFeatureFields(
      marine.swell_wave_direction_deg != null
        ? {
          heightFt: marine.swell_wave_height_max_ft,
          direction: marine.swell_wave_direction_deg,
          period: marine.swell_wave_period_max_s,
        }
        : null,
      "primary",
    );
    const liveSecondary = trainFeatureFields(
      marine.secondary_swell_direction_deg != null
        ? {
          heightFt: marine.secondary_swell_height_ft,
          direction: marine.secondary_swell_direction_deg,
          period: marine.secondary_swell_period_s,
        }
        : null,
      "secondary",
    );
    return {
      ...forecast,
      features: {
        ...features,
        ...livePrimary,
        ...liveSecondary,
        swell_trains_live: true,
      },
    };
  }
  const modelSecondary = finiteNumber(features.ml_p2_direction_deg)
    ?? finiteNumber(features.secondary_swell_direction_deg);
  const primaryDeg = finiteNumber(features.ml_p1_direction_deg ?? features.swell_wave_direction_deg);
  if (modelSecondary != null && !swellComponentIsClone(primaryDeg, modelSecondary)) {
    return { ...forecast, features };
  }
  const windHeight = meaningfulSwellHeight(marine.wind_wave_height_max_ft);
  const windDeg = finiteNumber(marine.wind_wave_direction_deg);
  if (windHeight == null || windDeg == null || isEasterlyComingFrom(windDeg)) {
    return { ...forecast, features };
  }
  if (swellComponentIsClone(primaryDeg, windDeg)) {
    return { ...forecast, features };
  }
  return {
    ...forecast,
    features: {
      ...features,
      secondary_swell_height_ft: features.secondary_swell_height_ft ?? windHeight,
      secondary_swell_period_s: features.secondary_swell_period_s ?? marine.wind_wave_period_max_s,
      secondary_swell_direction_deg: windDeg,
      secondary_swell_direction_label: directionFromDegrees(windDeg),
      wind_wave_height_max_ft: features.wind_wave_height_max_ft ?? windHeight,
      wind_wave_period_max_s: features.wind_wave_period_max_s ?? marine.wind_wave_period_max_s,
      wind_wave_direction_deg: features.wind_wave_direction_deg ?? windDeg,
    },
  };
}

async function loadForecastData() {
  const spot = currentSpot();
  updateSpotChrome(spot);
  initSpotPicker(spot);

  if (isMontereySpot(spot) && (spot.hasModelForecast || embeddedMontereyForecast())) {
    const [model, features, sunByDate, gradeGuide] = await Promise.all([
      loadMontereyForecastJson(spot),
      fetchLiveSpotFeatures(spot).catch(() => ({})),
      fetchOpenMeteoSunTimes(spot).catch(() => ({})),
      fetchJson("diveprosd_grade_guidance.json").catch(() => []),
    ]);
    const tenDayRaw = Array.isArray(model.ten_day) ? model.ten_day : [];
    const todayKey = localTodayInLaJolla();
    const latestRaw = tenDayRaw.find((row) => forecastDateKey(row) === todayKey)
      || model.latest
      || model;
    const sameDayCompare = model.same_day_compare || latestRaw.same_day_compare || [];
    const latest = decorateForecast({
      ...latestRaw,
      features: mergeDefinedFeatures(latestRaw.features, features),
      is_unavailable: false,
      same_day_compare: sameDayCompare,
    }, { live: features, sunByDate });
    const tenDay = tenDayRaw.length ? tenDayRaw : [latest];
    return {
      latest,
      tenDay: tenDay.map((forecast) => decorateForecast({
        ...forecast,
        same_day_compare: sameDayCompare,
      }, { live: features, sunByDate })),
      gradeGuide: Array.isArray(gradeGuide) ? gradeGuide : [],
      history: [],
      cameraObservation: null,
    };
  }

  if (!spot.hasModelForecast) {
    const [features, sunByDate, noModelGradeGuide] = await Promise.all([
      fetchLiveSpotFeatures(spot).catch(() => ({})) || {},
      fetchOpenMeteoSunTimes(spot).catch(() => ({})),
      fetchJson("diveprosd_grade_guidance.json").catch(() => []),
    ]);
    const latest = decorateForecast(unavailableSpotForecast(spot, mergeDefinedFeatures({}, features), {
      conditionsLoaded: liveFeaturesPresent(features),
    }), { live: features, sunByDate });
    return {
      latest,
      tenDay: [],
      gradeGuide: Array.isArray(noModelGradeGuide) ? noModelGradeGuide : [],
      history: [],
      cameraObservation: null,
    };
  }

  const cameraObservation = await loadCameraObservation();
  if (window.staticSpotReport) {
    return {
      latest: window.staticSpotReport,
      tenDay: [],
      gradeGuide: [],
      history: [],
      cameraObservation,
    };
  }

  try {
    const [published, gradeGuide, live] = await Promise.all([
      fetchPublishedLaJolla(),
      fetchJson("diveprosd_grade_guidance.json").catch(() => []),
      fetchLiveSpotFeatures(spot).catch(() => ({})),
    ]);
    const latest = published.latest;
    const tenDay = published.tenDay;
    let history = published.history || [];
    if (!history.length) {
      try {
        history = await fetchJson("forecast_history.json");
      } catch {
        history = [];
      }
    }
    const sunByDate = await fetchOpenMeteoSunTimes(spot).catch(() => ({}));
    const days = Array.isArray(tenDay) && tenDay.length ? tenDay : [latest];
    return {
      latest: decorateForecast(latest, { live, sunByDate }),
      tenDay: days.map((forecast) => decorateForecast(forecast, { live, sunByDate })),
      gradeGuide: Array.isArray(gradeGuide) ? gradeGuide : [],
      history: Array.isArray(history) ? history : [],
      cameraObservation,
    };
  } catch {
    const latest = fallbackForecast();
    return { latest, tenDay: [latest], gradeGuide: [], history: [], cameraObservation };
  }
}

async function fetchPublishedLaJolla() {
  const today = localTodayInLaJolla();
  const localLatest = await fetchJson("model_outputs/latest_forecast.json").catch(() => null);
  const localTen = await fetchJson("model_outputs/forecast_10day.json").catch(() => null);
  const localHistory = await fetchJson("forecast_history.json").catch(() => []);
  const localFresh = isForecastForToday(localLatest, today)
    && Array.isArray(localTen)
    && localTen.some((row) => forecastDateKey(row) >= today);
  if (localFresh) {
    return { latest: localLatest, tenDay: localTen, history: localHistory, source: "local" };
  }
  try {
    const [latest, tenDay, history] = await Promise.all([
      fetchJson(`${PUBLISHED_LA_JOLLA_ORIGIN}/model_outputs/latest_forecast.json`),
      fetchJson(`${PUBLISHED_LA_JOLLA_ORIGIN}/model_outputs/forecast_10day.json`),
      fetchJson(`${PUBLISHED_LA_JOLLA_ORIGIN}/forecast_history.json`).catch(() => localHistory),
    ]);
    return {
      latest: latest || localLatest,
      tenDay: Array.isArray(tenDay) && tenDay.length ? tenDay : localTen,
      history: Array.isArray(history) && history.length ? history : localHistory,
      source: "diveprosd.com",
    };
  } catch {
    if (!localLatest) throw new Error("La Jolla forecast unavailable");
    return { latest: localLatest, tenDay: localTen, history: localHistory, source: "local-stale" };
  }
}

function feet(range) {
  return `${range[0]}-${range[1]} ft`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setDailyReport(text) {
  if (!pagePublishesVisGrades()) return;
  const el = document.getElementById("dailyReport");
  if (!el) return;
  const parts = String(text || "")
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    el.textContent = "Daily dive report unavailable.";
    return;
  }
  if (el.tagName === "P") {
    const parent = el.parentElement;
    if (parent) {
      parent.querySelectorAll("[data-daily-report-para]").forEach((node) => node.remove());
    }
    el.textContent = parts[0];
    parts.slice(1).forEach((part) => {
      const paragraph = document.createElement("p");
      paragraph.dataset.dailyReportPara = "1";
      paragraph.textContent = part;
      parent?.appendChild(paragraph);
    });
    return;
  }
  el.replaceChildren(...parts.map((part) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = part;
    return paragraph;
  }));
}

function shortDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function dayLabel(date) {
  if (!date) return "Projected";
  if (date === localTodayInLaJolla()) return "Today";
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function currentForecastWindow(forecasts, today = localTodayInLaJolla()) {
  const valid = (forecasts || []).filter((forecast) => forecast && forecastDateKey(forecast));
  const upcoming = valid.filter((forecast) => forecastDateKey(forecast) >= today);
  if (upcoming.length) return upcoming.slice(0, 10);
  return valid.slice(-1);
}

function initialForecastForToday(forecasts, publishedLatest, today = localTodayInLaJolla()) {
  const fromWindow = (forecasts || []).find((forecast) => isForecastForToday(forecast, today))
    || (forecasts || []).find((forecast) => forecastDateKey(forecast) > today);
  if (fromWindow) return fromWindow;
  if (isForecastForToday(publishedLatest, today)) return publishedLatest;
  return (forecasts && forecasts[0]) || publishedLatest;
}

function list(id, values) {
  document.getElementById(id).replaceChildren(...values.map((value) => {
    const li = document.createElement("li");
    li.textContent = value;
    return li;
  }));
}

/* Meteorological coming-from (SW swell = from the southwest), not travel. */
function directionFromDegrees(degrees) {
  if (degrees === undefined || degrees === null || degrees === "") return "";
  const labels = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return labels[Math.round(Number(degrees) / 22.5) % 16] || "";
}

function isEasterlyComingFrom(degrees) {
  const heading = Number(degrees);
  return Number.isFinite(heading) && angularDistanceDeg(heading, 90) < 50;
}

function featureRows(features) {
  const enriched = {
    ...features,
    secondary_swell_direction_label: features?.secondary_swell_direction_label
      || directionFromDegrees(features?.secondary_swell_direction_deg ?? features?.wind_direction_deg),
  };
  const waterTempKey = enriched?.buoy_water_temp_f != null ? "buoy_water_temp_f" : "water_temp_estimate_f";
  const waterTempLabel = enriched?.buoy_water_temp_f != null ? "Water temp (buoy)" : "Water temp (est.)";
  const wanted = [
    [waterTempLabel, [waterTempKey], "°F"],
    ["Today's high", ["air_temp_max_f"], "°F"],
    ["Rain forecast", ["rain_24h_in", "rain_target_day_forecast_in"], "in"],
    ["72-hour rain", ["rain_prior_3day_in", "ml_rain_3day_in"], "in"],
  ];
  return wanted.map(([label, keys, unit]) => {
    const raw = keys.map((key) => enriched?.[key]).find((value) => value !== undefined && value !== null && value !== "");
    const value = raw === undefined || raw === null || raw === ""
      ? "n/a"
      : typeof raw === "number"
        ? `${raw.toFixed(keys.some((key) => key.includes("energy")) ? 0 : 1)} ${unit}`.trim()
        : `${raw}${unit ? ` ${unit}` : ""}`;
    return `<div><span>${label}</span><strong>${value}</strong></div>`;
  }).join("");
}

const cdfwRulesUrl = "https://wildlife.ca.gov/Fishing/Ocean/Regulations/Fishing-Map/Southern";

const fishTargets = [
  { name: "Kelp bass", habitat: "Kelp edge / boulders", prize: 62, abundance: 88, note: "reliable reef target", photo: 6, sizeRule: "14 in total length minimum; 5/day.", takeNote: "Listed as kelp bass in CDFW regulations. Open-area and MPA rules still apply." },
  { name: "California sheephead", habitat: "Reef / boulders", prize: 70, abundance: 80, note: "solid table fish", photo: 3, sizeRule: "12 in total length minimum; 2/day.", takeNote: "Divers are generally open year-round, but confirm current CDFW rules before take." },
  { name: "White seabass", habitat: "Kelp edge / open water", prize: 96, abundance: 24, note: "top SD trophy", photo: 1, sizeRule: "28 in total length minimum; 3/day, but 1/day Mar 15-Jun 15 south of Pt. Conception.", takeNote: "La Jolla is south of Pt. Conception. MPAs still apply." },
  { name: "California halibut", habitat: "Sand channels", prize: 88, abundance: 35, note: "prime table fish", photo: 2, sizeRule: "22 in total length minimum; 5/day south of Pt. Sur.", takeNote: "Measure total length before retaining." },
  { name: "Yellowtail", habitat: "Outer kelp / blue water", prize: 92, abundance: 28, note: "pelagic trophy", photo: 0, sizeRule: "24 in fork length minimum; 10/day.", takeNote: "Confirm current CDFW bag language before taking." },
  { name: "California barracuda", habitat: "Mid-water / kelp edge", prize: 55, abundance: 52, note: "spring run target", photo: 5, sizeRule: "28 in fork length minimum; 10/day.", takeNote: "Pelagic run timing changes fast." },
  { name: "Opaleye", habitat: "Shallow reef", prize: 38, abundance: 78, note: "ubiquitous, decent eating", photo: 10, sizeRule: "Verify current general finfish rules.", takeNote: "Confirm identification and local MPA boundaries." },
  { name: "Blacksmith", habitat: "Mid-water over reef", prize: 12, abundance: 95, note: "#1 most-abundant fish", photo: 7, sizeRule: "Not a normal table target.", takeNote: "Useful visibility and reef-life indicator." },
  { name: "Barred surfperch", habitat: "Sand / surf transition", prize: 32, abundance: 62, note: "shore-dive beginner fish", photo: 11, sizeRule: "Surfperch rules depend on species and area.", takeNote: "Confirm identification and current limits." },
  { name: "Garibaldi", habitat: "Reef", prize: 0, abundance: 85, note: "PROHIBITED, no take", photo: 8, sizeRule: "Do not take.", takeNote: "Garibaldi are protected statewide." },
  { name: "Halfmoon", habitat: "Kelp canopy / mid-water", prize: 35, abundance: 60, note: "light table value", photo: 4, sizeRule: "Verify current general finfish rules.", takeNote: "Confirm identification and MPA boundaries." },
  { name: "Sargo / black perch", habitat: "Reef ledges / sand edge", prize: 30, abundance: 65, note: "common surfperch family", photo: 9, sizeRule: "Species-specific rules may apply.", takeNote: "Confirm identification before retaining." },
];

const fishWikiTitles = {
  "Kelp bass": "Kelp_bass",
  "California sheephead": "Semicossyphus_pulcher",
  "White seabass": "White_seabass",
  "California halibut": "California_halibut",
  "Yellowtail": "California_yellowtail",
  "California barracuda": "California_barracuda",
  "Opaleye": "Opaleye",
  "Blacksmith": "Blacksmith_(fish)",
  "Barred surfperch": "Barred_surfperch",
  "Garibaldi": "Garibaldi_(fish)",
  "Halfmoon": "Halfmoon_(fish)",
  "Sargo / black perch": "Sargo_(fish)",
  "Yellowtail snapper": "Yellowtail_snapper",
  "Hogfish": "Hogfish",
  "Mutton snapper": "Mutton_snapper",
  "Gray snapper": "Mangrove_snapper",
  "Black grouper": "Black_grouper",
  "Red grouper": "Red_grouper",
  "Bluestriped grunt": "Bluestriped_grunt",
  "Blue tang": "Blue_tang",
  "Stoplight parrotfish": "Stoplight_parrotfish",
  "Great barracuda": "Great_barracuda",
  "African pompano": "African_pompano",
  "Lionfish": "Pterois",
  "Sheepshead": "Sheepshead_(fish)",
  "Mangrove snapper": "Mangrove_snapper",
  "Snook": "Common_snook",
  "Tarpon": "Atlantic_tarpon",
  "Crevalle jack": "Crevalle_jack",
  "Lookdown": "Lookdown_(fish)",
  "Porkfish": "Porkfish",
  "Gray triggerfish": "Grey_triggerfish",
  "Spanish / cero mackerel": "Spanish_mackerel",
  "Cobia": "Cobia",
  "Sergeant major": "Sergeant_major_(fish)",
  "Southern stingray": "Southern_stingray",
  "Yellow stingray": "Yellow_stingray",
  "Bar jack": "Bar_jack",
  "Sand diver": "Synodus_intermedius",
  "Peacock flounder": "Peacock_flounder",
  "Goatfish": "Mullidae",
  "Yellowhead jawfish": "Yellowhead_jawfish",
  "Spotted eagle ray": "Spotted_eagle_ray",
  "Nassau grouper": "Nassau_grouper",
  "Spotted scorpionfish": "Scorpaena_plumieri",
  "Caribbean reef squid": "Caribbean_reef_squid",
  "Bluehead wrasse": "Bluehead_wrasse",
  "French grunt": "French_grunt",
  "Foureye butterflyfish": "Foureye_butterflyfish",
  "Queen / French angelfish": "Queen_angelfish",
  "Caribbean reef shark": "Caribbean_reef_shark",
  "Senorita": "Oxyjulis_californica",
  "Black perch": "Black_perch",
  "Giant sea bass": "Giant_sea_bass",
  "Bat ray": "Bat_ray",
  "Horn shark": "Horn_shark",
  "Giant kelpfish": "Giant_kelpfish",
  "Bat ray / leopard shark": "Bat_ray",
  "Yellowtail parrotfish": "Yellowtail_parrotfish",
  "Stoplight / rainbow parrotfish": "Stoplight_parrotfish",
  "French / queen angelfish": "French_angelfish",
  "Lemon shark": "Lemon_shark",
  "Atlantic spadefish": "Atlantic_spadefish",
  "West Indian manatee": "West_Indian_manatee",
  "Florida pompano": "Florida_pompano",
  "Permit": "Permit_(fish)",
  "King / Spanish mackerel": "King_mackerel",
};

const fishImageCache = new Map();

function fishWikiTitle(name) {
  return fishWikiTitles[name] || String(name || "").split("/")[0].trim().replaceAll(" ", "_");
}

async function loadFishPhoto(image, fish) {
  if (!image || image.dataset.loaded === "true") return;
  const frame = image.closest(".fish-photo");
  const label = frame?.querySelector("span");
  const title = fishWikiTitle(fish.name);
  image.dataset.loaded = "true";
  if (label) label.textContent = "Loading photo...";

  try {
    let source = fishImageCache.get(title);
    if (source === undefined) {
      const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (!response.ok) throw new Error("image unavailable");
      const data = await response.json();
      source = data.thumbnail?.source || data.originalimage?.source || "";
      fishImageCache.set(title, source);
    }

    if (!source) throw new Error("image unavailable");
    image.src = source;
    image.alt = `${fish.name} photo`;
    image.hidden = false;
    if (label) label.hidden = true;
  } catch {
    image.hidden = true;
    if (label) label.textContent = "Photo unavailable";
  }
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function fishRankings(data) {
  const targets = Array.isArray(data.fish_targets) && data.fish_targets.length ? data.fish_targets : fishTargets;
  return targets.map((fish, index) => ({
    ...fish,
    prize: clampScore(fish.prize ?? 0),
    abundance: clampScore(fish.abundance ?? 0),
    photo: Number.isFinite(Number(fish.photo)) ? Number(fish.photo) : index % 12,
  }));
}

function renderFishRadar(data) {
  const grid = document.getElementById("fishGrid");
  if (!grid) return;
  const fishCard = grid.closest(".fish-card");
  const sectionLabel = fishCard?.querySelector(".section-heading span");
  const footnote = fishCard?.querySelector(":scope > p");
  const prizeLabel = data.fish_prize_label || "Prize";
  const ruleLabel = data.fish_rule_label || "Spearfishing size guidance";
  const rulesUrl = data.fish_rules_url || (data.fish_targets ? "" : cdfwRulesUrl);
  const rulesLinkText = data.fish_rules_link_text || "Check current regulations";

  if (sectionLabel && data.fish_context) sectionLabel.textContent = data.fish_context;
  if (footnote) {
    footnote.textContent = data.fish_legal_label
      ? "Tap a species for local guidance. Confirm current rules, seasons, closures, and local protected areas before taking fish."
      : "Tap a species for take-size guidance. Confirm current rules, seasons, closures, and local MPAs before taking fish.";
  }

  if (fishCard) {
    let note = fishCard.querySelector(".fish-site-note");
    if (data.fish_legal_label) {
      if (!note) {
        note = document.createElement("div");
        note.className = "fish-site-note";
        fishCard.insertBefore(note, grid);
      }
      note.textContent = data.fish_legal_label;
    } else if (note) {
      note.remove();
    }
  }

  grid.replaceChildren(...fishRankings(data).map((fish, index) => {
    const card = document.createElement("details");
    card.className = `fish-row${index < 3 ? " is-prime" : ""}`;
    const link = rulesUrl
      ? `<a href="${rulesUrl}" target="_blank" rel="noopener">${rulesLinkText}</a>`
      : "";
    card.innerHTML = `
      <summary>
        <div class="fish-rank">${index + 1}</div>
        <div class="fish-title">
          <strong>${fish.name}</strong>
          <span>${fish.habitat} · ${fish.note}</span>
        </div>
        <div class="fish-summary-scores">
          <span>${prizeLabel} ${fish.prize}</span>
          <span>Abundance ${fish.abundance}</span>
        </div>
        <span class="expand-label">View</span>
      </summary>
      <div class="fish-details">
        <div class="fish-photo">
          <img alt="${fish.name} photo" loading="lazy" hidden>
          <span>Tap to load fish photo</span>
        </div>
        <div class="fish-meters" aria-hidden="true">
          <div class="fish-meter"><span>${prizeLabel}</span><i style="width:${fish.prize}%"></i></div>
          <div class="fish-meter abundance"><span>Abundance</span><i style="width:${fish.abundance}%"></i></div>
        </div>
        <div class="fish-rule">
          <span>${ruleLabel}</span>
          <strong>${fish.sizeRule || "Confirm current local rules before take."}</strong>
          <p>${fish.takeNote || "Regulations change. Use this as prototype guidance, not final legal advice."}</p>
          ${link}
        </div>
      </div>
    `;
    card.addEventListener("toggle", () => {
      if (card.open) loadFishPhoto(card.querySelector(".fish-photo img"), fish);
    });
    return card;
  }));
}

function defaultReport(data) {
  const range = data.estimated_visibility_range_ft || [0, 6];
  return `The model expects ${feet(range)} visibility based on the available wave, wind, tide, and rain inputs.`;
}

let scrippsCameraObservation = null;

function cameraObservationDisplay(data) {
  if (currentSpot().slug !== "la-jolla") return data;
  const observation = scrippsCameraObservation;
  const grade = String(observation?.grade || "").trim().toUpperCase();
  const range = observation?.visibility_range_ft;
  const hasReviewedObservation = Boolean(
    observation
      && observation.status === "manual_observation"
      && data?.date === observation.observation_date
      && ["A+", "A", "B", "C", "D", "F"].includes(grade)
      && Array.isArray(range)
      && range.length === 2
      && range.every((value) => Number.isFinite(Number(value))),
  );
  if (!hasReviewedObservation) return data;

  const score = Number(observation.numeric_score_0_100);
  return {
    ...data,
    grade,
    estimated_visibility_range_ft: range.map(Number),
    numeric_score_0_100: Number.isFinite(score) ? score : data.numeric_score_0_100,
    is_camera_observation: true,
    camera_observation_slot: observation.slot,
  };
}

function cameraSlotLabel(slot) {
  const hour = Number(String(slot || "").split(":")[0]);
  if (Number.isNaN(hour)) return "today";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function cameraObservationDayLabel(observationDate) {
  const today = localTodayInLaJolla();
  if (observationDate === today) return "Today";
  const observation = new Date(`${observationDate}T12:00:00Z`);
  const current = new Date(`${today}T12:00:00Z`);
  const ageDays = Math.round((current - observation) / 86400000);
  if (ageDays === 1) return "Yesterday";
  return observation.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function renderCamera(data) {
  const frame = document.getElementById("cameraFrame");
  const image = document.getElementById("cameraImage");
  if (!frame || !image) return;

  const iframe = frame.querySelector("iframe");
  if (iframe) iframe.remove();
  const playButton = frame.querySelector(".camera-play-button");
  if (playButton) playButton.remove();
  frame.classList.remove("is-playing");

  const badge = document.getElementById("cameraObservedBadge");
  const unavailableMessage = document.getElementById("cameraUnavailableMessage");
  const spot = currentSpot();

  if (!spot.hasModelForecast && spot.liveEmbedUrl && spot.liveEmbedInPage !== false) {
    frame.classList.remove("is-camera-unavailable");
    image.hidden = true;
    image.removeAttribute("src");
    image.alt = "";
    if (unavailableMessage) unavailableMessage.hidden = true;
    if (badge) {
      badge.textContent = "Live cam · not a vis grade";
      badge.classList.remove("is-reference");
      badge.hidden = false;
    }
    const embed = document.createElement("iframe");
    embed.src = spot.liveEmbedUrl;
    embed.title = spot.cameraLabel || `${spot.name} live camera`;
    embed.allow = "autoplay; encrypted-media; picture-in-picture";
    embed.setAttribute("allowfullscreen", "");
    embed.referrerPolicy = "strict-origin-when-cross-origin";
    frame.appendChild(embed);
    frame.hidden = false;
    return;
  }

  if (!spot.hasModelForecast && spot.image) {
    const hero = frame.closest(".hero-camera");
    const textLink = document.getElementById("spotLiveCamText");
    const showStill = () => {
      frame.classList.remove("is-camera-unavailable");
      frame.hidden = false;
      image.hidden = false;
      if (unavailableMessage) unavailableMessage.hidden = true;
      if (hero) hero.classList.remove("is-camera-free");
      if (textLink) textLink.hidden = true;
    };
    const hideBrokenHero = () => {
      image.hidden = true;
      image.removeAttribute("src");
      image.alt = "";
      frame.classList.remove("is-camera-unavailable");
      frame.hidden = true;
      if (unavailableMessage) unavailableMessage.hidden = true;
      if (badge) badge.hidden = true;
      if (hero) hero.classList.add("is-camera-free");
      if (textLink) textLink.hidden = false;
    };
    image.onerror = hideBrokenHero;
    image.onload = showStill;
    showStill();
    image.src = spot.image;
    image.alt = spot.imageAlt || `${spot.name} live camera`;
    if (badge) {
      badge.textContent = spot.imageLabel || "Live camera";
      badge.classList.remove("is-reference");
      badge.hidden = false;
    }
    return;
  }

  if (isMontereySpot(spot)) {
    const hero = frame.closest(".hero-camera");
    const textLink = document.getElementById("spotLiveCamText");
    if (spot.image) {
      const showStill = () => {
        frame.classList.remove("is-camera-unavailable");
        frame.hidden = false;
        image.hidden = false;
        if (unavailableMessage) unavailableMessage.hidden = true;
        if (hero) hero.classList.remove("is-camera-free");
        if (textLink) textLink.hidden = true;
      };
      const hideBrokenHero = () => {
        image.hidden = true;
        image.removeAttribute("src");
        image.alt = "";
        frame.classList.remove("is-camera-unavailable");
        frame.hidden = true;
        if (unavailableMessage) unavailableMessage.hidden = true;
        if (badge) badge.hidden = true;
        if (hero) hero.classList.add("is-camera-free");
        if (textLink) textLink.hidden = false;
      };
      image.onerror = hideBrokenHero;
      image.onload = showStill;
      showStill();
      image.src = spot.image;
      image.alt = spot.imageAlt || `${spot.name} live camera`;
      if (badge) {
        badge.textContent = spot.imageLabel || "Live camera";
        badge.classList.remove("is-reference");
        badge.hidden = false;
      }
      return;
    }
    image.hidden = true;
    image.removeAttribute("src");
    image.alt = "";
    frame.hidden = true;
    if (unavailableMessage) unavailableMessage.hidden = true;
    if (badge) badge.hidden = true;
    if (hero) hero.classList.add("is-camera-free");
    if (textLink) textLink.hidden = true;
    return;
  }

  const observation = scrippsCameraObservation;
  const showObservation = Boolean(observation);
  if (showObservation) {
    frame.classList.remove("is-camera-unavailable");
    image.hidden = false;
    if (unavailableMessage) unavailableMessage.hidden = true;
    const slotLabel = cameraSlotLabel(observation.slot);
    const dayLabel = cameraObservationDayLabel(observation.observation_date);
    const isToday = observation.observation_date === localTodayInLaJolla();
    const imageUrl = String(observation.image_url || "");
    image.src = imageUrl.startsWith("/") && !imageUrl.startsWith("//")
      ? imageUrl.slice(1)
      : imageUrl;
    image.alt = `Scripps Pier underwater camera, captured ${dayLabel.toLowerCase()} at ${slotLabel}`;
    if (badge) {
      badge.textContent = isToday
        ? `${dayLabel} ${slotLabel}`
        : `${dayLabel} ${slotLabel} \u00b7 last available`;
      badge.classList.remove("is-reference");
      badge.hidden = false;
    }
  } else {
    frame.classList.add("is-camera-unavailable");
    image.hidden = true;
    image.removeAttribute("src");
    image.alt = "";
    if (unavailableMessage) unavailableMessage.hidden = false;
    if (badge) {
      const fallbackLabels = {
        pending: "Awaiting a verified camera image",
        offline: "Camera unavailable",
        unavailable: "No verified camera image",
      };
      badge.textContent =
        fallbackLabels[scrippsCameraFallbackReason] || fallbackLabels.unavailable;
      badge.classList.add("is-reference");
      badge.hidden = false;
    }
  }
  frame.hidden = false;
}

function hourLabel(time) {
  const hour = Number(String(time || "0").split(":")[0]);
  if (Number.isNaN(hour)) return time || "";
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function chartTicks(min, max, count = 5) {
  const span = Math.max(1, max - min);
  const rawStep = span / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(min / niceStep) * niceStep;
  const end = Math.ceil(max / niceStep) * niceStep;
  const ticks = [];
  for (let value = start; value <= end + niceStep / 2; value += niceStep) {
    ticks.push(Number(value.toFixed(2)));
  }
  return ticks;
}

function xFromIndex(index, total, left, width) {
  return left + (index / Math.max(1, total - 1)) * width;
}

function xFromChartHour(hour, points, left, width) {
  const hours = points.map((point) => chartHour(point.time)).filter((value) => value != null);
  if (hours.length < 2) return left;
  const first = hours[0];
  const last = hours[hours.length - 1];
  const clamped = Math.min(last, Math.max(first, hour));
  return left + ((clamped - first) / Math.max(0.1, last - first)) * width;
}

function pacificDecimalHour(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour + minute / 60;
}

function chartSunHours(data) {
  const features = data?.features || {};
  const fromDataSunrise = finiteNumber(features.sunrise_hour);
  const fromDataSunset = finiteNumber(features.sunset_hour);
  if (fromDataSunrise != null && fromDataSunset != null && fromDataSunset > fromDataSunrise) {
    return {
      sunrise: fromDataSunrise,
      sunset: fromDataSunset,
      sunriseLabel: features.sunrise_label || clockLabelFromHour(fromDataSunrise),
      sunsetLabel: features.sunset_label || clockLabelFromHour(fromDataSunset),
    };
  }
  const fallback = { sunrise: 6, sunset: 20, sunriseLabel: "6:00am", sunsetLabel: "8:00pm" };
  const spot = currentSpot();
  const dateKey = String(data?.date || features.date || "").slice(0, 10);
  const lat = Number(spot?.lat);
  const lon = Number(spot?.lon);
  if (!window.SunCalc || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return fallback;
  }
  try {
    const times = window.SunCalc.getTimes(new Date(`${dateKey}T12:00:00Z`), lat, lon);
    const sunrise = pacificDecimalHour(times?.sunrise);
    const sunset = pacificDecimalHour(times?.sunset);
    if (sunrise == null || sunset == null || sunset <= sunrise) return fallback;
    return {
      sunrise,
      sunset,
      sunriseLabel: clockLabelFromHour(sunrise),
      sunsetLabel: clockLabelFromHour(sunset),
    };
  } catch {
    return fallback;
  }
}

function tideNightWindows(data, points) {
  const hours = points.map((point) => chartHour(point.time)).filter((value) => value != null);
  if (hours.length < 2) return [];
  const first = hours[0];
  const last = hours[hours.length - 1];
  const { sunrise, sunset } = chartSunHours(data);
  const windows = [];
  if (sunrise > first) windows.push({ startHour: first, endHour: Math.min(sunrise, last) });
  if (sunset < last) windows.push({ startHour: Math.max(sunset, first), endHour: last });
  return windows;
}

function tideNightShadeMarkup(data, points, left, top, width, height) {
  return tideNightWindows(data, points).map((band) => {
    const x1 = xFromChartHour(band.startHour, points, left, width);
    const x2 = xFromChartHour(band.endHour, points, left, width);
    const bandWidth = Math.max(0, x2 - x1);
    if (bandWidth < 1) return "";
    return `<rect class="tide-night" x="${x1.toFixed(2)}" y="${top}" width="${bandWidth.toFixed(2)}" height="${height}"></rect>`;
  }).join("");
}

function tideSunLabelMarkup(data, points, left, top, width, height) {
  const hours = points.map((point) => chartHour(point.time)).filter((value) => value != null);
  if (hours.length < 2) return "";
  const first = hours[0];
  const last = hours[hours.length - 1];
  const sun = chartSunHours(data);
  const y = top + height - 14;
  return [
    { hour: sun.sunrise, label: sun.sunriseLabel, kind: "sunrise", anchor: "end", nudge: -5 },
    { hour: sun.sunset, label: sun.sunsetLabel, kind: "sunset", anchor: "start", nudge: 5 },
  ].filter((item) => item.hour > first && item.hour < last && item.label).map((item) => {
    const x = xFromChartHour(item.hour, points, left, width) + item.nudge;
    return `<text class="tide-sun-label" data-sun="${item.kind}" x="${x.toFixed(2)}" y="${y}" text-anchor="${item.anchor}">${item.label}</text>`;
  }).join("");
}

function yFromValue(value, min, max, top, height) {
  return top + (1 - ((value - min) / Math.max(0.1, max - min))) * height;
}

function chartXLabelAnchor(index, total) {
  if (index <= 0) return "start";
  if (index >= total - 1) return "end";
  return "middle";
}

const CHART_VIEW_WIDTH = 800;
const CHART_VIEW_HEIGHT = 110;
const CHART_PLOT_LEFT = 70;
const CHART_PLOT_RIGHT = 12;
const CHART_PLOT_WIDTH = CHART_VIEW_WIDTH - CHART_PLOT_LEFT - CHART_PLOT_RIGHT;
const CHART_PLOT_TOP = 12;
const CHART_PLOT_HEIGHT = 78;
const CHART_X_LABEL_Y = 102;
const CHART_Y_LABEL_X = CHART_PLOT_LEFT - 8;

function chartHour(time) {
  const hour = Number(String(time || "0").split(":")[0]);
  return Number.isFinite(hour) ? hour : null;
}

function chartXTicks(points) {
  const preferred = new Set([0, 3, 6, 9, 12, 15, 18, 21, 23]);
  const ticks = points
    .map((point, index) => ({ point, index, hour: chartHour(point.time) }))
    .filter((tick) => tick.hour != null && preferred.has(tick.hour));
  if (ticks.length >= 4) return ticks;
  return points
    .map((point, index) => ({ point, index }))
    .filter(({ index }) => index % 3 === 0 || index === points.length - 1);
}

function smoothLinePath(coords) {
  if (!coords.length) return "";
  if (coords.length === 1) return `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return path;
}

function chartYLabelY(tick, min, max, top, height) {
  return yFromValue(tick, min, max, top, height);
}

function showChartYLabel(tick, min, max, top, height) {
  const y = yFromValue(tick, min, max, top, height);
  const bottom = top + height;
  return !(Math.abs(tick) < 0.05 && Math.abs(y - bottom) <= 2);
}

function formatChartTick(tick) {
  return Math.abs(tick - Math.round(tick)) < 0.05 ? String(Math.round(tick)) : tick.toFixed(1);
}

function formatChartYLabel(tick, unit) {
  const value = formatChartTick(tick);
  return unit ? `${value} ${unit}` : value;
}

function areaFillPath(coords, baselineY) {
  if (!coords.length) return "";
  const last = coords[coords.length - 1];
  const first = coords[0];
  return `${smoothLinePath(coords)} L ${last.x.toFixed(2)} ${baselineY.toFixed(2)} L ${first.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

function setWindSpeedUnitVisible(visible) {
  const chart = document.getElementById("windChart");
  const heading = chart?.closest("article, section")?.querySelector(".section-heading");
  if (!heading) return;
  const unit = [...heading.querySelectorAll("span")].find((el) => /^\s*mph\s*$/i.test(el.textContent || ""));
  if (unit) unit.hidden = !visible;
}

function renderTideChart(data) {
  const chart = document.getElementById("tideChart");
  if (!chart) return;
  const points = data.features?.tide_chart || [];
  if (!points.length) {
    chart.textContent = "Tide data unavailable.";
    return;
  }
  const values = points.map((point) => point.height_ft);
  const yTicks = chartTicks(Math.min(...values), Math.max(...values), 4);
  const min = yTicks[0];
  const max = yTicks[yTicks.length - 1];
  const left = CHART_PLOT_LEFT;
  const top = CHART_PLOT_TOP;
  const width = CHART_PLOT_WIDTH;
  const height = CHART_PLOT_HEIGHT;
  const baseline = top + height;
  const coords = points.map((point, index) => ({
    x: xFromIndex(index, points.length, left, width),
    y: yFromValue(point.height_ft, min, max, top, height),
  }));
  const xTicks = chartXTicks(points);
  chart.innerHTML = `
    <svg viewBox="0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}" preserveAspectRatio="xMidYMid meet" overflow="visible" role="img" aria-label="Hourly tide height chart">
      ${tideNightShadeMarkup(data, points, left, top, width, height)}
      ${yTicks.map((tick) => {
        const y = yFromValue(tick, min, max, top, height);
        const zero = Math.abs(tick) < 0.05 ? " is-zero" : "";
        return `<line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline${zero}"></line>`;
      }).join("")}
      <path class="tide-fill" d="${areaFillPath(coords, baseline)}"></path>
      <path class="tide-line" d="${smoothLinePath(coords)}"></path>
      ${yTicks.map((tick) => {
        if (!showChartYLabel(tick, min, max, top, height)) return "";
        const y = chartYLabelY(tick, min, max, top, height);
        return `<text x="${CHART_Y_LABEL_X}" y="${y}" class="chart-y-label" text-anchor="end" dominant-baseline="middle">${formatChartYLabel(tick, "ft")}</text>`;
      }).join("")}
      ${xTicks.map(({ point, index }) => {
        const x = xFromIndex(index, points.length, left, width);
        return `<text x="${x}" y="${CHART_X_LABEL_Y}" class="chart-x-label" text-anchor="${chartXLabelAnchor(index, points.length)}">${hourLabel(point.time)}</text>`;
      }).join("")}
      ${tideSunLabelMarkup(data, points, left, top, width, height)}
    </svg>
  `;
}

function renderWindChart(data) {
  const chart = document.getElementById("windChart");
  if (!chart) return;
  const points = data.features?.wind_chart || [];
  if (!points.length) {
    setWindSpeedUnitVisible(false);
    chart.textContent = "Wind data unavailable.";
    return;
  }
  setWindSpeedUnitVisible(true);
  const values = points.map((point) => point.speed_mph || 0);
  const yTicks = chartTicks(0, Math.max(...values), 4);
  const min = 0;
  const max = yTicks[yTicks.length - 1];
  const left = CHART_PLOT_LEFT;
  const top = CHART_PLOT_TOP;
  const width = CHART_PLOT_WIDTH;
  const height = CHART_PLOT_HEIGHT;
  const gap = 4;
  const barWidth = points.length > 1
    ? (width - gap * (points.length - 1)) / points.length
    : width;
  const xTicks = chartXTicks(points);
  chart.innerHTML = `
    <svg viewBox="0 0 ${CHART_VIEW_WIDTH} ${CHART_VIEW_HEIGHT}" preserveAspectRatio="xMidYMid meet" overflow="visible" role="img" aria-label="Hourly wind speed in miles per hour">
      ${tideNightShadeMarkup(data, points, left, top, width, height)}
      ${yTicks.map((tick) => {
        const y = yFromValue(tick, min, max, top, height);
        return `<line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>`;
      }).join("")}
      ${points.map((point, index) => {
        const speed = point.speed_mph || 0;
        const x = left + index * (barWidth + (points.length > 1 ? gap : 0));
        const y = yFromValue(speed, min, max, top, height);
        const fill = windGradeColor(speed);
        return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(3, top + height - y).toFixed(2)}" rx="2" class="wind-bar ${windGradeClass(speed)}" fill="${fill}" style="fill: ${fill}"><title>${hourLabel(point.time)}: ${speed.toFixed(1)} mph</title></rect>`;
      }).join("")}
      ${yTicks.map((tick) => {
        if (!showChartYLabel(tick, min, max, top, height)) return "";
        const y = chartYLabelY(tick, min, max, top, height);
        return `<text x="${CHART_Y_LABEL_X}" y="${y}" class="chart-y-label" data-wind-ytick="${formatChartTick(tick)}" text-anchor="end" dominant-baseline="middle">${formatChartTick(tick)}</text>`;
      }).join("")}
      ${xTicks.map(({ point, index }) => {
        const x = xFromIndex(index, points.length, left, width);
        return `<text x="${x}" y="${CHART_X_LABEL_Y}" class="chart-x-label" text-anchor="${chartXLabelAnchor(index, points.length)}">${hourLabel(point.time)}</text>`;
      }).join("")}
    </svg>
  `;
}

function windGradeClass(speed) {
  if (speed <= 1) return "wind-grade-a-plus";
  if (speed <= 4) return "wind-grade-a";
  if (speed <= 6) return "wind-grade-b";
  if (speed <= 8) return "wind-grade-c";
  if (speed <= 10) return "wind-grade-d";
  return "wind-grade-f";
}

function windGradeColor(speed) {
  if (speed <= 1) return "#0075df";
  if (speed <= 4) return "#13baee";
  if (speed <= 6) return "#5e8ee8";
  if (speed <= 8) return "#a64bd8";
  if (speed <= 10) return "#d82fca";
  return "#ee13ba";
}

function displayWaveHeight(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * DISPLAY_HS_TO_CHAR : NaN;
}

function formatWaveFeet(value) {
  const number = displayWaveHeight(value);
  return Number.isFinite(number) ? `${number.toFixed(1)} ft` : "n/a";
}

function formatPeriod(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}s` : "n/a";
}

function formatDirection(label, degrees) {
  const direction = label || directionFromDegrees(degrees);
  const number = Number(degrees);
  if (direction && Number.isFinite(number)) return `${direction} ${Math.round(number)}°`;
  return direction || "n/a";
}

function waveHeightValue(forecast) {
  const features = forecast?.features || {};
  return displayWaveHeight(
    features.surf_height_max_ft
    ?? features.wave_height_max_ft
    ?? features.swell_wave_height_max_ft
    ?? 0
  );
}

function hideSwellSourceLabel() {
  const el = document.getElementById("swellSource");
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}

function swellDirectionColor(index) {
  return index === 0 ? "#13baee" : "#ee13ba";
}

function meaningfulSwellHeight(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0.25 ? number : null;
}

function swellComponentIsClone(primaryDeg, otherDeg) {
  if (primaryDeg == null || otherDeg == null) return false;
  return angularDistanceDeg(primaryDeg, otherDeg) < MARINE_SAME_TRAIN_DEG;
}

function swellRows(features) {
  const live = features.swell_trains_live === true;
  const primaryHeight = finiteNumber(
    live
      ? features.swell_wave_height_max_ft
      : (features.ml_p1_height_ft ?? features.primary_swell_height_max_ft ?? features.swell_wave_height_max_ft),
  );
  const primaryPeriod = finiteNumber(
    live
      ? features.swell_wave_period_max_s
      : (features.ml_p1_period_s ?? features.primary_swell_period_max_s ?? features.swell_wave_period_max_s),
  );
  const primaryDeg = finiteNumber(
    live
      ? features.swell_wave_direction_deg
      : (features.ml_p1_direction_deg ?? features.swell_wave_direction_deg),
  );
  const rows = [];
  rows.push({
    label: "Primary",
    height: primaryHeight,
    period: primaryPeriod,
    directionLabel: features.swell_direction_label || directionFromDegrees(primaryDeg),
    directionDeg: primaryDeg,
    color: swellDirectionColor(0),
  });

  const secondaryHeight = finiteNumber(
    live ? features.secondary_swell_height_ft : (features.ml_p2_height_ft ?? features.secondary_swell_height_ft),
  );
  const secondaryPeriod = finiteNumber(
    live ? features.secondary_swell_period_s : (features.ml_p2_period_s ?? features.secondary_swell_period_s),
  );
  const secondaryDeg = finiteNumber(
    live ? features.secondary_swell_direction_deg : (features.ml_p2_direction_deg ?? features.secondary_swell_direction_deg),
  );
  const secondaryIsClone = swellComponentIsClone(primaryDeg, secondaryDeg);
  if (secondaryDeg != null && !secondaryIsClone && (secondaryHeight == null || secondaryHeight >= MARINE_SECONDARY_MIN_FT)) {
    rows.push({
      label: "Secondary",
      height: secondaryHeight,
      period: secondaryPeriod,
      directionLabel: features.secondary_swell_direction_label || directionFromDegrees(secondaryDeg),
      directionDeg: secondaryDeg,
      color: swellDirectionColor(1),
    });
    return rows;
  }

  if (live) return rows;

  const windWaveHeight = meaningfulSwellHeight(features.wind_wave_height_max_ft);
  const windWaveDeg = finiteNumber(features.wind_wave_direction_deg);
  const windIsClone = swellComponentIsClone(primaryDeg, windWaveDeg);
  if (windWaveHeight != null && windWaveDeg != null && !windIsClone && !isEasterlyComingFrom(windWaveDeg)) {
    rows.push({
      label: "Secondary",
      height: windWaveHeight,
      period: features.wind_wave_period_max_s,
      directionLabel: directionFromDegrees(windWaveDeg),
      directionDeg: windWaveDeg,
      color: swellDirectionColor(1),
    });
  }
  return rows;
}

// Seed bounds from spots-config (also used by region maps — do not mutate).
function swellMapSeedBoundsForSpot(spot = currentSpot()) {
  if (Array.isArray(spot?.swellBounds) && spot.swellBounds.length === 2) return spot.swellBounds;
  return [
    [-117.345, 32.702],
    [-117.205, 32.908],
  ];
}

// Swell-card only. Fit the seed coastal span, then ease out a hair and pin
// land to a modest far-edge strip (not the 0.9-level Channel Islands frame).
const SWELL_CARD_ZOOM_OUT = 0.2;
const SWELL_CARD_LAND_EDGE = 0.72;

function swellMapLandSideForSpot(spot = currentSpot()) {
  const slug = String(spot?.slug || "");
  if (slug === "anacapa-ocean") return "northeast";
  if (slug === "catalina-wrigley") return "east";
  if (slug === "monterey-lobos" || slug === "monterey-monastery") return "east";
  if (slug === "monterey" || slug === "monterey-mcabee" || slug === "monterey-lovers") return "east";
  const dLon = Number(spot?.marineLon) - Number(spot?.lon);
  const dLat = Number(spot?.marineLat) - Number(spot?.lat);
  if (Number.isFinite(dLon) && Number.isFinite(dLat) && (Math.abs(dLon) > 0.002 || Math.abs(dLat) > 0.002)) {
    if (Math.abs(dLon) >= Math.abs(dLat)) return dLon < 0 ? "east" : "west";
    return dLat < 0 ? "north" : "south";
  }
  return "east";
}

function swellMapCoastAnchor(spot = currentSpot()) {
  const lon = Number(spot?.lon);
  const lat = Number(spot?.lat);
  if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon, lat];
  const bounds = swellMapSeedBoundsForSpot(spot);
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
}

function swellMapSeedFitZoom(spot = currentSpot()) {
  const bounds = swellMapSeedBoundsForSpot(spot);
  const south = bounds[0][1];
  const north = bounds[1][1];
  const lat = (south + north) / 2;
  const latKm = Math.abs(north - south) * 111.32;
  const mPerPx = (latKm * 1000) / 304;
  const mPerPxZ0 = 40075016.686 * Math.cos((lat * Math.PI) / 180) / 512;
  const zoom = Math.log2(mPerPxZ0 / Math.max(mPerPx, 1e-6));
  return Number.isFinite(zoom) ? zoom : 10.8;
}

function swellMapZoomForSpot(spot = currentSpot()) {
  return Math.max(7.2, swellMapSeedFitZoom(spot) - SWELL_CARD_ZOOM_OUT);
}

function swellMapLandScreenTarget(land, width, height) {
  const edge = SWELL_CARD_LAND_EDGE;
  const inset = 1 - edge;
  switch (land) {
    case "west": return [width * inset, height * 0.5];
    case "north": return [width * 0.5, height * inset];
    case "south": return [width * 0.5, height * edge];
    case "southwest": return [width * inset, height * edge];
    case "southeast": return [width * edge, height * edge];
    case "northeast": return [width * edge, height * inset];
    case "northwest": return [width * inset, height * inset];
    default: return [width * edge, height * 0.5];
  }
}

function swellMapBoundsForSpot(spot = currentSpot()) {
  const zoom = swellMapZoomForSpot(spot);
  const [lon, lat] = swellMapCoastAnchor(spot);
  const land = swellMapLandSideForSpot(spot);
  const widthPx = 900;
  const heightPx = 720;
  const world = 512 * 2 ** zoom;
  const lngSpan = (widthPx * 360) / world;
  const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / world;
  const latSpan = (heightPx * mPerPx) / 111320;
  const target = swellMapLandScreenTarget(land, widthPx, heightPx);
  const west = lon - (target[0] / widthPx) * lngSpan;
  const east = west + lngSpan;
  const north = lat + (target[1] / heightPx) * latSpan;
  const south = north - latSpan;
  return [
    [west, south],
    [east, north],
  ];
}

function swellMapCenterForSpot(spot = currentSpot()) {
  const bounds = swellMapBoundsForSpot(spot);
  return [
    (bounds[0][0] + bounds[1][0]) / 2,
    (bounds[0][1] + bounds[1][1]) / 2,
  ];
}

function swellMapOldCamera(spot = currentSpot()) {
  const bounds = swellMapSeedBoundsForSpot(spot);
  return {
    center: [
      (bounds[0][0] + bounds[1][0]) / 2,
      (bounds[0][1] + bounds[1][1]) / 2,
    ],
    zoom: swellMapSeedFitZoom(spot),
  };
}

let swellMapInstance = null;

function fitSwellCoast() {
  if (!swellMapInstance) return;
  try {
    swellMapInstance.resize();
  } catch {
    return;
  }
  const container = swellMapInstance.getContainer();
  const width = container?.clientWidth || 0;
  const height = container?.clientHeight || 0;
  const spot = currentSpot();
  const anchor = swellMapCoastAnchor(spot);
  const landSide = swellMapLandSideForSpot(spot);
  try {
    if (width >= 40 && height >= 40 && typeof swellMapInstance.fitBounds === "function") {
      swellMapInstance.fitBounds(swellMapSeedBoundsForSpot(spot), {
        padding: 8,
        duration: 0,
        essential: true,
      });
      const fittedZoom = Number(swellMapInstance.getZoom?.() ?? swellMapSeedFitZoom(spot));
      const zoom = Math.max(8, fittedZoom - SWELL_CARD_ZOOM_OUT);
      swellMapInstance.jumpTo({
        center: swellMapInstance.getCenter(),
        zoom,
        bearing: 0,
        pitch: 0,
      });
      if (typeof swellMapInstance.project === "function") {
        const projected = swellMapInstance.project(anchor);
        const target = swellMapLandScreenTarget(landSide, width, height);
        swellMapInstance.panBy([projected.x - target[0], projected.y - target[1]], { duration: 0 });
      }
    } else {
      const zoom = swellMapZoomForSpot(spot);
      swellMapInstance.jumpTo({
        center: swellMapCenterForSpot(spot),
        zoom,
        bearing: 0,
        pitch: 0,
      });
    }
    const after = swellMapInstance.getCenter?.() || {};
    window.__diveProSwellCameraDebug = {
      slug: spot?.slug,
      landSide,
      old: swellMapOldCamera(spot),
      new: {
        center: [Number(Number(after.lng).toFixed(4)), Number(Number(after.lat).toFixed(4))],
        zoom: Number(Number(swellMapInstance.getZoom?.() ?? zoom).toFixed(2)),
      },
    };
  } catch {
    window.__diveProSwellCameraDebug = { slug: spot?.slug, landSide, zoom };
  }
  placeSwellRoseOnChart();
  swellMapInstance.once("idle", placeSwellRoseOnChart);
}

function swellSatelliteStyle() {
  return {
    version: 8,
    sources: {
      "esri-world-imagery": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: "esri-world-imagery",
        type: "raster",
        source: "esri-world-imagery",
      },
    ],
  };
}

function initSwellMap() {
  const container = document.getElementById("swellMap");
  const maplibre = window.maplibregl || globalThis.maplibregl;
  if (!container) return;
  if (swellMapInstance) {
    fitSwellCoast();
    return;
  }
  if (!maplibre) return;
  try {
    swellMapInstance = new maplibre.Map({
      container,
      style: swellSatelliteStyle(),
      center: swellMapCenterForSpot(),
      zoom: swellMapZoomForSpot(),
      attributionControl: false,
      interactive: false,
      fadeDuration: 0,
      minZoom: 8,
      maxZoom: 16,
    });
    swellMapInstance.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
    swellMapInstance.on("load", () => {
      container.classList.add("is-ready");
      scheduleSwellMapResize();
      placeSwellRoseOnChart();
      swellMapInstance.once("idle", scheduleSwellMapResize);
      [250, 800, 1800].forEach((ms) => window.setTimeout(placeSwellRoseOnChart, ms));
    });
    swellMapInstance.on("error", () => {});
    bindSwellMapResizeHooks();
  } catch {
    swellMapInstance = null;
  }
}

let swellMapResizeTimer = 0;
let swellMapResizeHooksBound = false;

function swellMapHostSize() {
  const panel = document.querySelector(".swell-card .swell-map-panel")
    || document.querySelector(".swell-map-panel");
  const container = document.getElementById("swellMap");
  const host = panel || container;
  if (!host) return { width: 0, height: 0, host: null };
  return {
    width: host.clientWidth || Math.round(host.getBoundingClientRect().width),
    height: host.clientHeight || Math.round(host.getBoundingClientRect().height),
    host,
  };
}

function scheduleSwellMapResize() {
  window.clearTimeout(swellMapResizeTimer);
  swellMapResizeTimer = window.setTimeout(() => {
    requestAnimationFrame(() => {
      if (!swellMapInstance) return;
      const { width, height } = swellMapHostSize();
      if (width < 8 || height < 8) return;
      try {
        swellMapInstance.resize();
      } catch {
        /* MapLibre can throw if the WebGL context is not ready. */
      }
      fitSwellCoast();
    });
  }, 32);
}

function bindSwellMapResizeHooks() {
  if (swellMapResizeHooksBound) return;
  swellMapResizeHooksBound = true;
  window.addEventListener("resize", scheduleSwellMapResize);
  window.addEventListener("orientationchange", scheduleSwellMapResize);
  window.addEventListener("load", scheduleSwellMapResize);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleSwellMapResize();
  });
  if (document.fonts?.ready) {
    document.fonts.ready.then(scheduleSwellMapResize).catch(() => {});
  }
  try {
    window.matchMedia("(min-width: 900px)").addEventListener("change", scheduleSwellMapResize);
  } catch {
    /* matchMedia change events are unavailable in older WebViews. */
  }
  const card = document.querySelector(".swell-card");
  const stage = document.querySelector(".swell-stage");
  const panel = document.querySelector(".swell-map-panel");
  const mapEl = document.getElementById("swellMap");
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(scheduleSwellMapResize);
    [card, stage, panel, mapEl].forEach((el) => {
      if (el) observer.observe(el);
    });
  }
  if (typeof IntersectionObserver === "function" && card) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio > 0)) {
        scheduleSwellMapResize();
      }
    }, { threshold: [0, 0.01, 0.15] });
    io.observe(card);
  }
  [0, 120, 360, 900, 1800].forEach((ms) => window.setTimeout(scheduleSwellMapResize, ms));
}

let swellRosePlaceTimer = 0;

function swellRoseStage() {
  return document.querySelector(".swell-card .swell-stage")
    || document.querySelector(".swell-stage");
}

function swellRoseOverlay() {
  return document.querySelector(".swell-card .swell-compass-overlay")
    || document.querySelector(".swell-compass-overlay")
    || document.querySelector(".swell-card .swell-rose-wrap")
    || document.querySelector(".swell-rose-wrap");
}

function placeSwellRoseOnChart() {
  const stage = swellRoseStage();
  const wrap = swellRoseOverlay();
  const rose = document.getElementById("swellRose");
  if (!stage || !wrap || !rose) return;
  stage.classList.add("swell-visualization");
  wrap.classList.add("swell-compass-overlay");
  if (wrap.parentElement !== stage) stage.appendChild(wrap);
  if (rose.parentElement !== wrap) wrap.appendChild(rose);

  ["left", "top", "right", "bottom", "width", "height", "maxWidth", "transform"].forEach((prop) => {
    rose.style[prop] = "";
    wrap.style[prop] = "";
  });
  rose.classList.remove("is-chart-centered");
  wrap.classList.add("is-chart-centered");

  try {
    const stageRect = stage.getBoundingClientRect();
    const roseRect = rose.getBoundingClientRect();
    const stats = document.querySelector(".swell-card .wave-components");
    const statsRect = stats?.getBoundingClientRect();
    const vizCx = stageRect.left + stageRect.width / 2;
    const vizCy = stageRect.top + stageRect.height / 2;
    window.__diveProSwellRoseDebug = {
      slug: currentSpot()?.slug,
      containingBlock: "swell-stage",
      includesStatsPanel: Boolean(
        statsRect
        && statsRect.left >= stageRect.left - 2
        && statsRect.right <= stageRect.right + 2
      ),
      stage: {
        left: Math.round(stageRect.left),
        width: Math.round(stageRect.width),
        cx: Math.round(vizCx),
        cy: Math.round(vizCy),
      },
      rose: {
        left: Math.round(roseRect.left),
        width: Math.round(roseRect.width),
        cx: Math.round(roseRect.left + roseRect.width / 2),
        cy: Math.round(roseRect.top + roseRect.height / 2),
        diameter: Math.round(Math.min(roseRect.width, roseRect.height)),
      },
      dx: Math.round((roseRect.left + roseRect.width / 2) - vizCx),
      dy: Math.round((roseRect.top + roseRect.height / 2) - vizCy),
    };
  } catch {
    window.__diveProSwellRoseDebug = { containingBlock: "swell-stage" };
  }
}

function angularDistanceDeg(a, b) {
  const delta = Math.abs(((a - b + 540) % 360) - 180);
  return delta;
}

function swellRoseSeparationScale() {
  // Offsets live in the 235-unit viewBox. Keep the same SVG layout on mobile so
  // CSS head boxes still clear after the rose shrinks to ~145px.
  return 1;
}

function swellArrowMarkup({
  sourceBearing,
  color,
  length,
  strokeWidth,
  offsetPx,
  headSize,
  hubGap,
  worldX,
  worldY,
}) {
  const cx = 117.5;
  const cy = 117.5;
  const travelBearing = swellSourceBearingToTravelBearing(sourceBearing);
  const rotateDeg = swellTravelBearingToArrowRotateDeg(travelBearing);
  // Local shaft points east (+X). rotate(travel+270) aims the head at travel.
  // Tail stays on the coming-from side; head sits fully on the travel side of
  // the hub so a south swell does not read as "pointing at S".
  const headBaseR = Number.isFinite(hubGap) ? hubGap : 14;
  const destR = headBaseR + headSize;
  const y = cy + Number(offsetPx || 0);
  const tailX = cx - length;
  const tipX = cx + destR;
  const baseX = tipX - headSize;
  const headHalf = headSize * 0.62;
  const fmt = (value) => value.toFixed(1);
  const halo = strokeWidth + 2.1;
  const wx = Number(worldX || 0);
  const wy = Number(worldY || 0);
  const shift = (wx || wy) ? `translate(${fmt(wx)} ${fmt(wy)}) ` : "";
  return `
    <g class="swell-arrow" data-source="${fmt(Number(sourceBearing))}" data-travel="${fmt(travelBearing)}" data-rotate="${fmt(rotateDeg)}" transform="${shift}rotate(${fmt(rotateDeg)} ${fmt(cx)} ${fmt(cy)})">
      <line x1="${fmt(tailX)}" y1="${fmt(y)}" x2="${fmt(baseX)}" y2="${fmt(y)}" stroke="#04101f" stroke-width="${halo}" stroke-linecap="round"></line>
      <line x1="${fmt(tailX)}" y1="${fmt(y)}" x2="${fmt(baseX)}" y2="${fmt(y)}" stroke="#ffffff" stroke-width="${strokeWidth + 1.4}" stroke-linecap="round"></line>
      <line x1="${fmt(tailX)}" y1="${fmt(y)}" x2="${fmt(baseX)}" y2="${fmt(y)}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"></line>
      <polygon points="${fmt(tipX)},${fmt(y)} ${fmt(baseX)},${fmt(y - headHalf)} ${fmt(baseX)},${fmt(y + headHalf)}" fill="${color}" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"></polygon>
    </g>
  `;
}

function renderSwellCompassRose(rows) {
  const rose = document.getElementById("swellRose");
  if (!rose) return;
  const directed = rows.filter((row) => Number.isFinite(Number(row.directionDeg)));
  const primary = directed.find((row) => String(row.label).toLowerCase() === "primary") || directed[0];
  const secondary = directed.find((row) => String(row.label).toLowerCase() === "secondary")
    || (directed.length > 1 ? directed[1] : null);
  const primarySpec = primary
    ? { ...defaultSwellArrowSpec("primary"), sourceBearing: Number(primary.directionDeg) }
    : null;
  const secondarySpec = secondary
    ? { ...defaultSwellArrowSpec("secondary"), sourceBearing: Number(secondary.directionDeg) }
    : null;
  const sep = primarySpec && secondarySpec
    ? separateSwellArrowPair(primarySpec, secondarySpec, { scale: swellRoseSeparationScale() })
    : null;
  const arrows = [];
  if (secondarySpec) {
    arrows.push(swellArrowMarkup({
      ...secondarySpec,
      offsetPx: sep?.secondaryOffsetPx || 0,
      worldX: sep?.secondaryWorldX || 0,
      worldY: sep?.secondaryWorldY || 0,
    }));
  }
  if (primarySpec) {
    arrows.push(swellArrowMarkup({
      ...primarySpec,
      offsetPx: sep?.primaryOffsetPx || 0,
      worldX: sep?.primaryWorldX || 0,
      worldY: sep?.primaryWorldY || 0,
    }));
  }
  rose.innerHTML = `
    <svg viewBox="0 0 235 235" role="img" aria-label="Swell compass rose with primary and secondary arrows">
      <circle cx="117.5" cy="117.5" r="88" class="swell-rose-ring"></circle>
      <text x="117.5" y="18" text-anchor="middle">N</text>
      <text x="222" y="122" text-anchor="middle">E</text>
      <text x="117.5" y="226" text-anchor="middle">S</text>
      <text x="14" y="122" text-anchor="middle">W</text>
      ${arrows.join("")}
    </svg>
  `;
  try {
    window.__diveProSwellArrowSep = sep
      ? {
          slug: currentSpot()?.slug,
          perpPx: sep.perpPx,
          bisectorPx: sep.bisectorPx,
          minHeadCenter: sep.minHeadCenter,
          outlineGap: sep.outlineGap,
          headCenterDist: sep.headCenterDist,
          usedHeadVsShaft: sep.usedHeadVsShaft,
          collision: {
            headHead: sep.collision.headHead,
            headShaft: sep.collision.headShaft,
            shaftHead: sep.collision.shaftHead,
            headBBox: sep.collision.headBBox,
          },
        }
      : { slug: currentSpot()?.slug, single: true };
  } catch {
    window.__diveProSwellArrowSep = { ok: true };
  }
  window.clearTimeout(swellRosePlaceTimer);
  swellRosePlaceTimer = window.setTimeout(placeSwellRoseOnChart, 60);
}

let swellCardForecast = null;
let swellGridSyncTimer = 0;

function swellSamplePoint(spot = currentSpot()) {
  const lat = Number(spot?.marineLat ?? spot?.lat);
  const lon = Number(spot?.marineLon ?? spot?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function waveGridSwellSample(spot) {
  if (typeof window.__diveProSampleWaveAt !== "function") return null;
  const point = swellSamplePoint(spot);
  if (!point) return null;
  return window.__diveProSampleWaveAt(point.lon, point.lat);
}

function overlaySwellFromWaveGrid(data) {
  const features = data.features || (data.features = {});
  if (features.swell_trains_live === true && finiteNumber(features.swell_wave_direction_deg) != null) {
    return true;
  }
  const sample = waveGridSwellSample(currentSpot());
  if (!sample?.primary || !Number.isFinite(sample.primary.direction)) return false;
  let secondary = sample.secondary && Number.isFinite(sample.secondary.direction)
    ? sample.secondary
    : null;
  if (secondary && angularDistanceDeg(sample.primary.direction, secondary.direction) < MARINE_DISTINCT_HEADING_DEG) {
    secondary = null;
  }
  Object.assign(
    features,
    trainFeatureFields(sample.primary, "primary"),
    trainFeatureFields(secondary, "secondary"),
    { swell_trains_live: true },
  );
  return true;
}

function syncSwellCardToWaveGrid(data) {
  if (!data || data.__swellGridSynced) return;
  const apply = () => {
    if (swellCardForecast !== data || data.__swellGridSynced) return true;
    if (!overlaySwellFromWaveGrid(data)) return false;
    data.__swellGridSynced = true;
    renderWaveComponents(data, { fromGrid: true });
    return true;
  };
  if (apply()) return;
  window.addEventListener("divepro:oceanLayerFrame", apply, { once: true });
  window.addEventListener("divepro:spotMapReady", apply, { once: true });
  window.clearInterval(swellGridSyncTimer);
  let tries = 0;
  swellGridSyncTimer = window.setInterval(() => {
    tries += 1;
    if (apply() || tries > 50) window.clearInterval(swellGridSyncTimer);
  }, 400);
}

function renderWaveComponents(data, { fromGrid = false } = {}) {
  const container = document.getElementById("waveComponents");
  if (!container) return;
  swellCardForecast = data;
  const features = data.features || {};
  const rows = swellRows(features);
  hideSwellSourceLabel();
  container.innerHTML = `
    <div class="swell-overlay-list" role="list" aria-label="Swell components">
      ${rows.map((row) => `
        <div class="swell-overlay-row" role="listitem">
          <span>${row.label}</span>
          <strong>${formatWaveFeet(row.height)}</strong>
          <em>${row.period != null ? formatPeriod(row.period) : ""}</em>
          <b class="swell-dir" style="color:${row.color}">${row.directionDeg != null || row.directionLabel ? formatDirection(row.directionLabel, row.directionDeg) : ""}</b>
        </div>
      `).join("")}
    </div>
  `;
  renderSwellCompassRose(rows);
  initSwellMap();
  placeSwellRoseOnChart();
  try {
    const point = swellSamplePoint();
    window.__diveProSwellCardDebug = {
      slug: currentSpot()?.slug,
      samplePoint: point,
      fromGrid,
      rows: rows.map((row) => ({
        label: row.label,
        heightFt: Number.isFinite(row.height) ? Number(row.height.toFixed(3)) : null,
        displayFt: Number.isFinite(row.height) ? Number(displayWaveHeight(row.height).toFixed(2)) : null,
        period: row.period,
        comingFrom: row.directionDeg,
        goingTo: Number.isFinite(row.directionDeg) ? swellSourceBearingToTravelBearing(row.directionDeg) : null,
        arrowRotate: Number.isFinite(row.directionDeg)
          ? swellTravelBearingToArrowRotateDeg(swellSourceBearingToTravelBearing(row.directionDeg))
          : null,
        labelText: row.directionLabel,
      })),
    };
  } catch {
    window.__diveProSwellCardDebug = { fromGrid };
  }
  if (!fromGrid) syncSwellCardToWaveGrid(data);
  if (isIslandConditionsSpot()) renderIslandBriefing(data);
}

function formatUserTime(value) {
  const match = String(value || "").match(/(?:T|\s|^)(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

const REPORT_TEXT_VERSION = "v2-explanatory-three-paragraph";

function narrativeNumber(features, ...keys) {
  for (const key of keys) {
    const number = Number(features[key]);
    if (features[key] !== null && features[key] !== "" && Number.isFinite(number)) return number;
  }
  return null;
}

function joinNarrativeItems(items) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function narrativeDrivers(features) {
  const negative = [];
  const positive = [];
  const surf = narrativeNumber(features, "surf_height_max_ft", "wave_height_max_ft");
  const swellEnergy = narrativeNumber(features, "swell_power_proxy_max", "wave_energy_max_kj");
  const shortEnergy = narrativeNumber(features, "short_period_swell_energy");
  const wind = narrativeNumber(features, "wind_speed_max_mph");
  const rain = narrativeNumber(features, "rain_target_day_forecast_in", "rain_24h_in");
  const priorRain = narrativeNumber(features, "rain_prior_3day_in", "ml_rain_3day_in");
  const waveTrend = narrativeNumber(features, "ml_wave_trend");

  if (swellEnergy !== null) {
    if (swellEnergy >= 70) negative.push("swell energy");
    else if (swellEnergy <= 40) positive.push("lower swell energy");
  }
  if (surf !== null) {
    if (surf >= 3) negative.push("surface movement");
    else if (surf <= 2.25) positive.push("limited surface movement");
  }
  if (shortEnergy !== null && shortEnergy >= 18) negative.push("short-period wind-wave churn");
  if (wind !== null) {
    if (wind >= 8) negative.push("wind-driven mixing");
    else if (wind <= 6) positive.push("lighter winds");
  }
  if ((rain !== null && rain >= 0.1) || (priorRain !== null && priorRain >= 0.1)) {
    negative.push("rain-related nearshore mixing");
  } else if (rain !== null && priorRain !== null && rain < 0.05 && priorRain < 0.05) {
    positive.push("dry recent conditions");
  }
  if (waveTrend !== null) {
    if (waveTrend >= 0.2) negative.push("a building wave trend");
    else if (waveTrend <= -0.2) positive.push("an easing wave trend");
  }

  return {
    negative: negative.slice(0, 3),
    positive: positive.slice(0, 3),
  };
}

function buildLajollaNarrative(data) {
  const features = data.features || {};
  const visibility = data.estimated_visibility_range_ft || [0, 4];
  const low = Number.isFinite(Number(visibility[0])) ? Number(visibility[0]) : 0;
  const high = Number.isFinite(Number(visibility[1])) ? Number(visibility[1]) : 4;
  const grade = String(data.grade || "F").toUpperCase();
  const { negative, positive } = narrativeDrivers(features);
  const negativeCopy = joinNarrativeItems(negative);
  const positiveCopy = joinNarrativeItems(positive);
  const opening = `The model expects ${low}-${high} ft of visibility, resulting in a ${grade} grade.`;
  let driverCopy;

  if (grade === "A" || grade === "A+") {
    const support = positiveCopy || "relatively settled conditions in the available inputs";
    driverCopy = `Conditions are very favorable overall, supported by ${support}.`;
    if (negativeCopy) driverCopy += ` The remaining ${negativeCopy} are not strong enough to displace the high-clarity result.`;
  } else if (grade === "B") {
    const support = positiveCopy || "a generally manageable disturbance profile";
    driverCopy = `Conditions are favorable overall, with ${support} supporting useful clarity.`;
    driverCopy += negativeCopy
      ? ` Some ${negativeCopy} keep the forecast below exceptional A-grade conditions.`
      : " Residual uncertainty keeps the forecast below exceptional A-grade conditions.";
  } else if (grade === "C") {
    const constraints = negativeCopy || "a mixed set of swell, surface and wind signals";
    driverCopy = `Conditions are moderately favorable overall, but the algorithm is seeing enough ${constraints} to prevent a clearer B-grade forecast.`;
  } else if (grade === "D") {
    const constraints = negativeCopy || "multiple unsettled physical signals";
    driverCopy = `Conditions are marginal, with ${constraints} creating significant pressure on visibility.`;
  } else {
    const constraints = negativeCopy || "strongly unsettled physical signals";
    driverCopy = `Conditions are poor, and ${constraints} point to very limited underwater clarity.`;
  }

  const tidePhase = String(features.tide_phase || "unknown").trim().toLowerCase();
  const nextTide = features.tide_next_event && typeof features.tide_next_event === "object"
    ? features.tide_next_event
    : null;
  const nextTime = nextTide ? formatUserTime(nextTide.time) : "";
  const nextType = String(nextTide?.type || "").toUpperCase();
  const eventName = nextType === "H" ? "high tide" : nextType === "L" ? "low tide" : "tide change";
  const eventCopy = nextTime ? ` at ${nextTime}` : "";
  let tideParagraph;

  if (tidePhase === "rising") {
    tideParagraph = `The rising tide is a favorable signal. As water moves toward the next ${eventName}${eventCopy}, cleaner offshore water may move into La Jolla and support improving visibility.`;
  } else if (tidePhase === "falling") {
    tideParagraph = `The falling tide is an additional negative signal. As water moves toward the next ${eventName}${eventCopy}, visibility may gradually decline because the outgoing tide is less likely to bring cleaner offshore water into La Jolla.`;
  } else if (["slack", "near slack", "near-slack"].includes(tidePhase)) {
    tideParagraph = `The tide is near slack and is a more neutral visibility signal. The next ${eventName}${eventCopy} may change water movement, but the current tide offers limited directional support either way.`;
  } else {
    tideParagraph = `The next ${eventName}${eventCopy} could still change nearshore water movement, so local clarity may vary.`;
  }

  let practicalParagraph;
  if (grade === "A" || grade === "A+") {
    practicalParagraph = "Overall, conditions look very favorable for productive diving, though clarity can still vary around sandy bottoms and surge-prone sections of exposed reef.";
  } else if (grade === "B") {
    practicalParagraph = "Overall, the forecast is favorable for diving. Sheltered coves and deeper water may hold the clearest conditions, while exposed coastline and sandy entries could be less consistent.";
  } else if (grade === "C") {
    practicalParagraph = "Overall, the forecast remains diveable, but clarity may vary by location and could be worse around shallow reefs, sandy bottoms and areas exposed to surge.";
  } else if (grade === "D") {
    practicalParagraph = "Overall, visibility looks marginal. Divers should confirm local conditions before committing and favor sheltered coves or deeper water over shallow, sandy, or surge-exposed areas.";
  } else {
    practicalParagraph = "Overall, conditions look poor and are unlikely to support productive diving. Consider postponing or verifying a substantially clearer sheltered site before entering the water.";
  }

  return [`${opening} ${driverCopy}`, tideParagraph, practicalParagraph].join("\n\n");
}

let islandBriefingForecast = null;

function islandGeographyClause(spot = currentSpot()) {
  const slug = String(spot?.slug || "");
  if (slug === "anacapa-ocean") {
    return "Anacapa is a boat-access Channel Islands dive, open to the exposed Pacific.";
  }
  if (slug === "catalina-wrigley") {
    return "Catalina Wrigley is a boat-access reserve on Catalina Island, facing open Pacific water.";
  }
  return "";
}

function islandComingFrom(label, degrees) {
  const formatted = formatDirection(label, degrees);
  return formatted && formatted !== "n/a" ? `coming from ${formatted}` : "";
}

function islandSwellTrainClause(row) {
  if (!row) return "";
  const height = displayWaveHeight(row.height);
  if (!Number.isFinite(height)) return "";
  const bits = [`${height.toFixed(1)} ft`];
  const period = finiteNumber(row.period);
  if (period != null) bits.push(`at ${Math.round(period)} seconds`);
  const coming = islandComingFrom(row.directionLabel, row.directionDeg);
  if (coming) bits.push(coming);
  return `${row.label.toLowerCase()} ${bits.join(" ")}`;
}

function islandSwellParagraph(features, spot) {
  const geo = islandGeographyClause(spot);
  const rows = swellRows(features || {});
  const trains = rows.map(islandSwellTrainClause).filter(Boolean);
  let swell = "";
  if (trains.length === 1) {
    swell = `Today's live Open-Meteo marine sample shows a ${trains[0]}. That is the same point the swell card uses.`;
  } else if (trains.length >= 2) {
    swell = `Today's live Open-Meteo marine sample shows a ${trains[0]}, with a ${trains[1]}. That is the same point the swell card uses.`;
  }
  return [geo, swell].filter(Boolean).join(" ");
}

function islandWindParagraph(features) {
  const chart = Array.isArray(features?.wind_chart) ? features.wind_chart : [];
  const peakFromChart = maxFinite(chart.map((point) => point?.speed_mph));
  const peak = peakFromChart ?? finiteNumber(features?.wind_speed_max_mph);
  if (peak == null) return "";
  const dir = directionFromDegrees(features?.wind_direction_deg);
  const speed = `${peak.toFixed(1)} mph`;
  const from = dir ? ` from the ${dir}` : "";
  return `Wind on today's America/Los_Angeles Open-Meteo series for this spot peaks near ${speed}${from}. That is the same hourly series drawn on the wind chart below.`;
}

function islandWeatherParagraph(features) {
  const high = finiteNumber(features?.air_temp_max_f);
  const rain = finiteNumber(features?.rain_target_day_forecast_in ?? features?.rain_24h_in);
  const bits = [];
  if (high != null) bits.push(`a high of ${high.toFixed(1)} °F`);
  if (rain != null) bits.push(`${rain.toFixed(1)} in of rain`);
  if (!bits.length) return "";
  return `The weather card's Open-Meteo daily for today has ${joinNarrativeItems(bits)}.`;
}

function buildIslandBriefingParagraphs(data, spot = currentSpot()) {
  const features = data?.features || {};
  return [
    { key: "swell", text: islandSwellParagraph(features, spot) },
    { key: "wind", text: islandWindParagraph(features) },
    { key: "weather", text: islandWeatherParagraph(features) },
  ].filter((part) => part.text);
}

function renderIslandBriefing(data) {
  if (!isIslandConditionsSpot()) return;
  if (data) islandBriefingForecast = data;
  const source = data || islandBriefingForecast;
  const panel = document.querySelector(".forecast-panel");
  if (!panel) return;

  let host = document.getElementById("islandHeroBriefing");
  if (!host) {
    host = document.createElement("div");
    host.id = "islandHeroBriefing";
    host.className = "island-hero-briefing";
    panel.appendChild(host);
  }
  host.classList.add("island-hero-briefing");
  panel.querySelectorAll(".island-hero-copy").forEach((node) => {
    if (!host.contains(node)) node.remove();
  });

  const parts = source
    ? buildIslandBriefingParagraphs(source)
    : [{ key: "swell", text: islandGeographyClause() }];
  host.dataset.count = String(parts.length);
  host.replaceChildren(...parts.map((part) => {
    const paragraph = document.createElement("p");
    paragraph.dataset.islandBrief = part.key;
    paragraph.textContent = part.text;
    return paragraph;
  }));

  try {
    const features = source?.features || {};
    const rows = swellRows(features);
    window.__diveProIslandBriefing = {
      slug: currentSpot()?.slug,
      pacificDate: localTodayInLaJolla(),
      paragraphs: parts.map((part) => part.text),
      bind: {
        swell: rows.map((row) => ({
          label: row.label,
          displayFt: Number.isFinite(row.height) ? Number(displayWaveHeight(row.height).toFixed(1)) : null,
          period: finiteNumber(row.period) != null ? Math.round(row.period) : null,
          comingFrom: formatDirection(row.directionLabel, row.directionDeg),
        })),
        windMph: finiteNumber(features.wind_speed_max_mph),
        windDir: directionFromDegrees(features.wind_direction_deg) || null,
        highF: finiteNumber(features.air_temp_max_f),
        rainIn: finiteNumber(features.rain_target_day_forecast_in ?? features.rain_24h_in),
      },
    };
  } catch {
    window.__diveProIslandBriefing = { slug: currentSpot()?.slug };
  }
}

function reportText(data) {

  const features = data.features || {};
  const range = feet(data.estimated_visibility_range_ft || [0, 6]);
  const grade = String(data.grade || "C").replace("+", "");
  const swell = Number(features.swell_wave_height_max_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? 0);
  const wind = Number(features.wind_speed_max_mph ?? 0);
  const rain = Number(features.rain_target_day_forecast_in ?? features.rain_24h_in ?? 0);
  const priorRain = Number(features.rain_prior_3day_in ?? features.ml_rain_3day_in ?? 0);
  const tidePhase = features.tide_phase;
  const nextTide = features.tide_next_event;
  const direction = features.swell_direction_label
    || directionFromDegrees(features.swell_wave_direction_deg)
    || "SW";
  const swellCopy = Number.isFinite(swell) && swell > 0
    ? `${swell.toFixed(1)} ft @ ${Math.round(period)}s ${direction} swell`
    : "light rolling swell";
  const windCopy = Number.isFinite(wind) && wind > 0
    ? `${Math.round(wind)} mph peak wind`
    : "light wind";
  const rainParts = [];
  if (Number.isFinite(rain) && rain >= 0.05) rainParts.push(`${rain.toFixed(1)} in forecast rain`);
  if (Number.isFinite(priorRain) && priorRain >= 0.05) rainParts.push(`${priorRain.toFixed(1)} in recent 72-hour rain`);
  const rainCopy = rainParts.length ? `, and ${rainParts.join(" plus ")}` : "";
  const tideCopy = nextTide
    ? `The tide signal is ${tidePhase || "mixed"}, with the next ${nextTide.type === "H" ? "high" : "low"} near ${Number(nextTide.height_ft).toFixed(1)} ft at ${formatUserTime(nextTide.time) || "an unavailable time"}.`
    : tidePhase
      ? `The tide signal is ${tidePhase}.`
      : "";
  const waveCopy = waveWeight(data);

  if (data.is_camera_observation) {
    const slotLabel = cameraSlotLabel(data.camera_observation_slot);
    return `Today's ${slotLabel} Scripps Pier camera observation indicates ${range} visibility with a grade ${data.grade}. Weather context remains forecast-driven: ${swellCopy}, ${waveCopy.toLowerCase()}, and ${windCopy}${rainCopy}. ${tideCopy}`.trim();
  }

  if (data.is_unavailable) return data.report_text || "Forecast data unavailable.";
  if (data.is_beta || data.model_source === "monterey_beta_hgb" || isMontereySpot(currentSpot())) {
    return buildMontereyNarrative(data);
  }
  if (data.report_text_version === REPORT_TEXT_VERSION && data.report_text) return data.report_text;
  return buildLajollaNarrative(data);
}

function buildMontereyNarrative(data) {
  if (data.report_text && String(data.report_text).includes("\n\n")) {
    return data.report_text;
  }
  const features = data.features || {};
  const visibility = data.estimated_visibility_range_ft || [0, 4];
  const low = Number.isFinite(Number(visibility[0])) ? Number(visibility[0]) : 0;
  const high = Number.isFinite(Number(visibility[1])) ? Number(visibility[1]) : 4;
  const grade = String(data.grade || "C").toUpperCase();
  const name = data.spot_name || currentSpot()?.name || "this Monterey site";
  const location = data.location || currentSpot()?.location || "Monterey";
  const swell = Number(features.swell_wave_height_max_ft ?? features.surf_height_max_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? 0);
  const wind = Number(features.wind_speed_max_mph ?? 0);
  const conditions = [];
  if (Number.isFinite(swell) && swell > 0) {
    conditions.push(Number.isFinite(period) && period > 0
      ? `about ${swell.toFixed(1)} ft of swell at ${Math.round(period)} seconds`
      : `about ${swell.toFixed(1)} ft of swell`);
  }
  if (Number.isFinite(wind) && wind > 0) {
    conditions.push(`wind topping out near ${Math.round(wind)} mph`);
  }
  const support = conditions.length ? conditions.join(" and ") : "the available weather inputs";
  const opening = `The Monterey beta model expects ${low}-${high} ft of visibility at ${name}, a ${grade} grade.`;
  let driver;
  if (grade === "A" || grade === "A+") {
    driver = `Conditions look very favorable at ${location}, with ${support} supporting the clearer water.`;
  } else if (grade === "B") {
    driver = `Conditions look favorable at ${location}, with ${support} supporting useful clarity. Residual uncertainty and the usual harbor-to-Carmel spread keep this below an A.`;
  } else if (grade === "C") {
    driver = `Conditions look moderately favorable at ${location}, but ${support} are enough to keep this from a clearer B-grade day.`;
  } else if (grade === "D") {
    driver = `Conditions look marginal at ${location}, with ${support} putting real pressure on visibility.`;
  } else {
    driver = `Conditions look poor at ${location}, and ${support} point to very limited underwater clarity.`;
  }
  const siteCopy = data.site_bucket === "lobos"
    ? "The number on this card is a Point Lobos blend. Do not judge the day from the cove — people come here for the water past the entrance."
    : data.site_bucket === "carmel_shore"
      ? "Harbor vis does not decide Carmel. Sit and watch sets before gearing up. Calling the dive here is normal."
      : "Vis is often layered: a dirty or green top 15-30 ft, then it opens — or it does not. After rain, the San Carlos storm drain — not swell — is the usual Breakwater killer.";
  const practical = (grade === "A" || grade === "A+")
    ? `Overall this looks like a high-clarity day at ${name}, but treat the number as a site-bucket estimate — harbor, Point Lobos, and Carmel often disagree on the same afternoon.`
    : grade === "B"
      ? `Overall the forecast is favorable for diving at ${name}. Expect the usual layering and site-to-site spread, and check the other Monterey cards before you choose a parking lot.`
      : grade === "C"
        ? `Overall the day is diveable at ${name}, but clarity may vary by entry and depth. Confirm the water in front of you before you commit.`
        : grade === "D"
          ? `Overall visibility looks marginal at ${name}. Confirm local conditions and be ready to call the dive or drive to a different coastline.`
          : `Overall conditions look poor at ${name} and are unlikely to support a productive dive. Consider another day or a different coastline.`;
  const beta = "This Monterey forecast is a development model only and is not validated for public accuracy claims. It does not use the La Jolla weights.";
  return [`${opening} ${driver}`, siteCopy, `${practical} ${beta}`].join("\n\n");
}

function renderMontereyCompare(data) {
  const card = document.getElementById("montereyCompare");
  const rows = document.getElementById("montereyCompareRows");
  if (!card || !rows) return;
  const spots = Array.isArray(data.same_day_compare) ? data.same_day_compare : [];
  const current = currentSpot();
  if (!isMontereySpot(current) || spots.length < 2) {
    card.hidden = true;
    rows.replaceChildren();
    return;
  }
  card.hidden = false;
  rows.replaceChildren(...spots.map((site) => {
    const range = site.estimated_visibility_range_ft;
    const link = document.createElement("a");
    link.href = site.href || `${site.slug}.html`;
    link.className = `monterey-compare-chip${site.slug === current.slug ? " is-current" : ""}`;
    link.setAttribute("aria-label", `${site.name} ${site.grade} ${range?.[0]}-${range?.[1]} ft`);
    link.innerHTML = `
      <b>${site.name}</b>
      <span class="monterey-compare-grade">${site.grade || "—"}</span>
      <span>${Array.isArray(range) ? `${range[0]}-${range[1]} ft` : "—"}</span>
    `;
    return link;
  }));
  placeMontereyCompare();
}

function waveWeight(data) {
  const features = data.features || {};
  const swell = Number(features.swell_wave_height_max_ft ?? features.swell_wave_height_ft ?? features.total_swell_height_mean_ft ?? 0);
  const period = Number(features.swell_wave_period_max_s ?? features.swell_wave_period_sec ?? features.swell_period_sec ?? 0);
  if (!Number.isFinite(swell) || swell <= 0) return "Light";
  const range = waveRange(swell);
  if (swell >= 4 || (swell >= 3 && period <= 10)) return `${range} · Heavy`;
  if (swell >= 2) return `${range} · Moderate`;
  return `${range} · Light`;
}

function waveRange(feet) {
  const low = Math.max(0, Math.floor(feet));
  const high = Math.max(low + 1, Math.ceil(feet));
  return `${low}-${high} ft`;
}

function gradeClass(grade) {
  return `grade-${String(grade || "C").toLowerCase().replace("+", "-plus")}`;
}

function formatOneDecimal(value, fallback = "n/a") {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : fallback;
}

function renderWaveSwell(data) {
  const features = data.features || {};
  const surf = formatOneDecimal(features.surf_height_max_ft ?? features.wave_height_max_ft ?? features.total_swell_height_mean_ft, "0.0");
  const primarySwell = formatOneDecimal(features.swell_wave_height_max_ft ?? features.primary_swell_height_max_ft, "0.0");
  const primaryPeriod = Math.round(Number(features.swell_wave_period_max_s ?? features.primary_swell_period_max_s ?? 0));
  const primaryDirection = features.swell_direction_label || directionFromDegrees(features.swell_wave_direction_deg) || "SW";
  const primaryDegrees = Number(features.swell_wave_direction_deg ?? features.primary_swell_direction_deg);
  const secondarySwell = formatOneDecimal(features.secondary_swell_height_ft ?? features.wind_wave_height_max_ft, "0.0");
  const secondaryPeriod = Math.round(Number(features.secondary_swell_period_s ?? features.wind_wave_period_max_s ?? 0));
  const secondaryDirection = features.secondary_swell_direction_label || directionFromDegrees(features.secondary_swell_direction_deg) || "WNW";
  const secondaryDegrees = Number(features.secondary_swell_direction_deg);

  setText("surfHeight", waveRange(Number(surf)));
  setText("primarySwell", `${primarySwell} ft`);
  setText("primaryPeriod", `${primaryPeriod || "n/a"}s`);
  setText("primaryDirection", `${primaryDirection}${Number.isFinite(primaryDegrees) ? ` ${Math.round(primaryDegrees)}°` : ""}`);
  setText("secondarySwell", `${secondarySwell} ft`);
  setText("secondaryPeriod", `${secondaryPeriod || "n/a"}s`);
  setText("secondaryDirection", `${secondaryDirection}${Number.isFinite(secondaryDegrees) ? ` ${Math.round(secondaryDegrees)}°` : ""}`);

  renderSwellChart(data);
}

function renderSwellChart(data) {
  const chart = document.getElementById("swellChart");
  if (!chart) return;
  const features = data.features || {};
  const base = Number(features.surf_height_max_ft ?? features.wave_height_max_ft ?? features.total_swell_height_mean_ft ?? 2.5);
  const points = Array.from({ length: 9 }, (_, index) => ({
    time: ["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm", "11pm"][index],
    value: Math.max(0.4, base + (index - 3) * 0.12 + Math.sin(index / 2) * 0.18),
  }));
  const max = Math.max(5, Math.ceil(Math.max(...points.map((point) => point.value))));
  const left = 72;
  const top = 24;
  const width = 856;
  const height = 150;
  const coords = points.map((point, index) => {
    const x = xFromIndex(index, points.length, left, width);
    const y = yFromValue(point.value, 0, max, top, height);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const area = `${left},${top + height} ${coords} ${left + width},${top + height}`;
  chart.innerHTML = `
    <svg viewBox="0 0 1000 230" role="img" aria-label="Hourly wave height and swell chart">
      ${[0, Math.round(max / 2), max].map((tick) => {
        const y = yFromValue(tick, 0, max, top, height);
        return `
          <line x1="${left}" x2="${left + width}" y1="${y}" y2="${y}" class="chart-gridline"></line>
          <text x="${left - 10}" y="${y + 4}" class="chart-y-label" text-anchor="end">${tick} ft</text>
        `;
      }).join("")}
      ${points.map((point, index) => {
        const x = xFromIndex(index, points.length, left, width);
        return `
          <line x1="${x}" x2="${x}" y1="${top}" y2="${top + height}" class="chart-x-grid ${index % 2 ? "is-soft" : ""}"></line>
          <text x="${x}" y="206" class="chart-x-label" text-anchor="middle">${point.time}</text>
        `;
      }).join("")}
      <polygon points="${area}" class="swell-area"></polygon>
      <polyline points="${coords}" class="swell-line"></polyline>
      ${points.map((point, index) => {
        const x = xFromIndex(index, points.length, left, width);
        const y = yFromValue(point.value, 0, max, top, height);
        return `<circle cx="${x}" cy="${y}" r="4" class="swell-point"></circle>`;
      }).join("")}
      <line x1="${left + width}" x2="${left + width}" y1="${top}" y2="${top + height}" class="swell-now"></line>
    </svg>
  `;
}

function renderWeather(data) {
  document.querySelectorAll(".weather-grid > div").forEach((tile) => {
    const label = tile.querySelector("span")?.textContent?.toLowerCase() || "";
    const value = tile.querySelector("strong")?.textContent?.toLowerCase() || "";
    if (
      label.includes("chlorophyll")
      || label.includes("chla")
      || value.includes("no satellite data")
    ) {
      tile.remove();
    }
  });
  const features = data.features || {};
  setText("waterTemp", `${formatOneDecimal(features.water_temp_estimate_f ?? features.ml_sst_f, "n/a")} F`);
  setText("rainForecast", `${formatOneDecimal(features.rain_target_day_forecast_in ?? features.rain_24h_in, "0.0")} in`);
  setText("rain72", `${formatOneDecimal(features.rain_prior_3day_in ?? features.ml_rain_3day_in, "0.0")} in`);
}

function render(data) {
  data = cameraObservationDisplay(data);
  if (!pagePublishesVisGrades()) {
    hideUnpublishedVisChrome();
    const features = data.features || {};
    const hasConditions = liveFeaturesPresent(features);
    const featureEl = document.getElementById("featureRows");
    if (featureEl) {
      featureEl.innerHTML = hasConditions
        ? featureRows(features)
        : "<div><span>Conditions</span><strong>Unavailable</strong></div>";
    }
    renderCamera(data);
    renderWaveComponents(data);
    renderTideChart(data);
    renderWindChart(data);
    renderWaveSwell(data);
    renderWeather(data);
    renderIslandBriefing(data);
    return;
  }
  const unavailable = Boolean(data.is_unavailable);
  const range = data.estimated_visibility_range_ft;
  const score = data.numeric_score_0_100 ?? 0;
  const hasRange = Array.isArray(range) && range.length >= 2;
  const features = data.features || {};
  const swellHeight = Number(
    features.swell_wave_height_max_ft
    ?? features.surf_height_max_ft
    ?? features.wave_height_max_ft,
  );
  const hasWave = Number.isFinite(swellHeight) && swellHeight > 0;
  const hasConditions = liveFeaturesPresent(features);
  setText("grade", unavailable ? "—" : (data.grade || "C"));
  setText("visibility", unavailable || !hasRange ? "Unavailable" : feet(range));
  setText("bestWindow", unavailable ? "Unavailable" : (data.best_window || "Early morning"));
  setText("waveWeight", hasWave ? waveWeight(data) : "Unavailable");
  setText(
    "forecastSource",
    unavailable
      ? "Vis grade unavailable · La Jolla-trained model"
      : data.is_camera_observation
        ? `Observed at ${cameraSlotLabel(data.camera_observation_slot)} · forecast context from model`
        : data.is_projected
          ? `Projected from ${shortDate(data.projected_from || data.date)}`
          : "Model prediction from parsed conditions",
  );
  bindGradeGuideTriggers();
  setDailyReport(reportText(data));
  renderMontereyCompare(data);
  const panel = document.querySelector(".forecast-panel");
  const grade = document.getElementById("grade");
  if (panel) panel.className = `forecast-panel ${unavailable ? "is-unavailable" : gradeClass(data.grade)}`;
  if (grade) grade.className = unavailable ? "is-unavailable" : gradeClass(data.grade);
  const scoreFill = document.getElementById("scoreFill");
  if (scoreFill) scoreFill.style.width = `${unavailable ? 0 : score}%`;
  const featureEl = document.getElementById("featureRows");
  if (featureEl) {
    featureEl.innerHTML = hasConditions || !unavailable
      ? featureRows(features)
      : "<div><span>Conditions</span><strong>Unavailable</strong></div>";
  }
  renderCamera(data);
  renderWaveComponents(data);
  renderTideChart(data);
  renderWindChart(data);
  renderWaveSwell(data);
  renderWeather(data);
}

function renderForecastStrip(forecasts, activeDate) {
  if (!pagePublishesVisGrades()) {
    hideUnpublishedVisChrome();
    return;
  }
  const strip = document.getElementById("forecastStrip");
  if (!strip) return;

  const card = strip.closest(".ten-day-card");
  if (card) card.hidden = false;
  if (!forecasts.length) {
    strip.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "forecast-strip-empty";
    empty.textContent = isMontereySpot(currentSpot())
      ? "10-day Monterey forecast is loading or unavailable."
      : "10-day forecast is loading or unavailable.";
    strip.appendChild(empty);
    return;
  }
  function selectForecast(forecast, source = "forecast_day_select") {
    render(forecast);
    renderForecastStrip(forecasts, forecast.date);
    if (source !== "wind_map_timeline") {
      window.dispatchEvent(new CustomEvent("divepro:forecastDateSelected", {
        detail: {
          date: forecast.date,
          source,
        },
      }));
    }
    window.diveproTrack(source, {
      forecast_date: forecast.date,
      grade: forecast.grade,
    });
  }

  window.__diveProSelectForecastDate = (dateOrDetail, source = "wind_map_day_select") => {
    const detail = typeof dateOrDetail === "object" && dateOrDetail !== null ? dateOrDetail : { date: dateOrDetail };
    const forecast = forecasts.find((item) => item.date === detail.date) || forecasts[detail.dayIndex];
    if (!forecast) return false;
    selectForecast(forecast, detail.source || source);
    return true;
  };

  strip.replaceChildren(...forecasts.map((forecast) => {
    const displayedForecast = cameraObservationDisplay(forecast);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `forecast-day ${gradeClass(displayedForecast.grade)}${forecast.date === activeDate ? " is-active" : ""}`;
    button.setAttribute("aria-pressed", forecast.date === activeDate ? "true" : "false");
    button.innerHTML = `
      <span>${dayLabel(forecast.date)}</span>
      <strong>${displayedForecast.grade}</strong>
      <em>${feet(displayedForecast.estimated_visibility_range_ft || [0, 6])}</em>
      <small>${forecast.is_projected ? "Projected" : shortDate(forecast.date)}</small>
    `;
    button.addEventListener("click", () => {
      selectForecast(forecast);
    });
    return button;
  }));
}

const PUBLISHED_GRADE_GUIDE = [
  { grade: "A+", visibility_range_ft: [35, 40] },
  { grade: "A", visibility_range_ft: [25, 35] },
  { grade: "B", visibility_range_ft: [15, 24] },
  { grade: "C", visibility_range_ft: [10, 14] },
  { grade: "D", visibility_range_ft: [5, 9] },
  { grade: "F", visibility_range_ft: [0, 4] },
];

const gradeGuideUi = {
  open: false,
  pinned: false,
  trigger: null,
  hideTimer: 0,
};

function isDisclaimerChipText(text) {
  const value = String(text || "").toLowerCase();
  return value.includes("not validated") || value.includes("beta model");
}

function decorateGradeGuideTrigger(button) {
  button.setAttribute("aria-controls", "gradeGuidePopover");
  button.setAttribute("aria-haspopup", "dialog");
  if (!button.hasAttribute("aria-expanded")) button.setAttribute("aria-expanded", "false");
}

function removeLegacyGradeGuideSection() {
  document.querySelectorAll(".grade-guide-card").forEach((el) => el.remove());
  const leftover = document.getElementById("gradeGuide");
  leftover?.closest("section")?.remove();
  leftover?.remove();
}

function ensureGradeGuidePopover() {
  let pop = document.getElementById("gradeGuidePopover");
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = "gradeGuidePopover";
  pop.className = "grade-guide-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-labelledby", "gradeGuidePopoverTitle");
  pop.hidden = true;
  document.body.appendChild(pop);
  return pop;
}

function fillGradeGuidePopover(gradeGuide) {
  const pop = ensureGradeGuidePopover();
  const rows = Array.isArray(gradeGuide) && gradeGuide.length ? gradeGuide : PUBLISHED_GRADE_GUIDE;
  const title = document.createElement("p");
  title.className = "grade-guide-popover-title";
  title.id = "gradeGuidePopoverTitle";
  title.textContent = "Grade Guide";
  const table = document.createElement("div");
  table.className = "grade-guide-popover-table";
  table.setAttribute("role", "table");
  rows.forEach((item) => {
    const range = item.visibility_range_ft || [];
    const row = document.createElement("div");
    row.className = `grade-guide-popover-row ${gradeClass(item.grade)}`;
    row.setAttribute("role", "row");
    const grade = document.createElement("strong");
    grade.setAttribute("role", "cell");
    grade.textContent = item.grade;
    const feetCell = document.createElement("span");
    feetCell.setAttribute("role", "cell");
    feetCell.textContent = `${range[0]}-${range[1]} ft`;
    row.append(grade, feetCell);
    table.appendChild(row);
  });
  pop.replaceChildren(title, table);
}

function ensureLetterGradeTrigger() {
  const grade = document.getElementById("grade");
  if (!grade) return null;
  const existing = grade.closest(".grade-guide-trigger");
  if (existing) {
    const hint = existing.querySelector(".grade-guide-hint");
    if (hint) hint.hidden = false;
    decorateGradeGuideTrigger(existing);
    return existing;
  }
  const wrap = document.createElement("div");
  wrap.className = "grade-guide-letter-wrap";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "grade-guide-trigger grade-guide-trigger--letter";
  button.setAttribute("aria-label", "Grade guide");
  decorateGradeGuideTrigger(button);
  const hint = document.createElement("span");
  hint.className = "grade-guide-hint";
  hint.textContent = "Grade guide";
  grade.replaceWith(wrap);
  button.append(grade, hint);
  wrap.appendChild(button);
  return button;
}

function bindGradeGuideTriggers() {
  if (!pagePublishesVisGrades()) {
    hideUnpublishedVisChrome();
    return;
  }
  const source = document.getElementById("forecastSource");
  if (source && isDisclaimerChipText(source.textContent)) {
    source.textContent = "Model prediction from parsed conditions";
  }
  document.getElementById("gradeGuideHeroTrigger")?.remove();
  ensureLetterGradeTrigger();
}

function positionGradeGuidePopover(trigger, pop) {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 16);
  pop.style.width = `${width}px`;
  pop.style.visibility = "hidden";
  pop.hidden = false;
  const height = pop.offsetHeight;
  let left = rect.left + (rect.width / 2) - (width / 2);
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 8 && rect.top - 8 - height > 8) {
    top = rect.top - 8 - height;
  }
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.visibility = "";
}

function setGradeGuideExpanded(trigger) {
  document.querySelectorAll(".grade-guide-trigger").forEach((el) => {
    el.setAttribute("aria-expanded", el === trigger ? "true" : "false");
  });
}

function openGradeGuide(trigger, pinned) {
  const pop = ensureGradeGuidePopover();
  gradeGuideUi.open = true;
  if (pinned) gradeGuideUi.pinned = true;
  gradeGuideUi.trigger = trigger;
  positionGradeGuidePopover(trigger, pop);
  setGradeGuideExpanded(trigger);
}

function closeGradeGuide() {
  const pop = document.getElementById("gradeGuidePopover");
  gradeGuideUi.open = false;
  gradeGuideUi.pinned = false;
  gradeGuideUi.trigger = null;
  if (pop) pop.hidden = true;
  document.querySelectorAll(".grade-guide-trigger").forEach((el) => {
    el.setAttribute("aria-expanded", "false");
  });
}

function initGradeGuideEvents() {
  if (document.documentElement.dataset.gradeGuideEvents === "1") return;
  document.documentElement.dataset.gradeGuideEvents = "1";

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".grade-guide-trigger");
    if (trigger) {
      event.preventDefault();
      if (gradeGuideUi.open && gradeGuideUi.pinned && gradeGuideUi.trigger === trigger) {
        closeGradeGuide();
      } else {
        openGradeGuide(trigger, true);
      }
      return;
    }
    if (!event.target.closest("#gradeGuidePopover")) closeGradeGuide();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && gradeGuideUi.open) closeGradeGuide();
  });

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    if (event.target.closest("#gradeGuidePopover")) {
      window.clearTimeout(gradeGuideUi.hideTimer);
      return;
    }
    const trigger = event.target.closest(".grade-guide-trigger");
    if (!trigger) return;
    window.clearTimeout(gradeGuideUi.hideTimer);
    if (!gradeGuideUi.pinned) openGradeGuide(trigger, false);
  });

  document.addEventListener("pointerout", (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const from = event.target.closest(".grade-guide-trigger, #gradeGuidePopover");
    const to = event.relatedTarget && event.relatedTarget.closest
      ? event.relatedTarget.closest(".grade-guide-trigger, #gradeGuidePopover")
      : null;
    if (from && !to && !gradeGuideUi.pinned) {
      gradeGuideUi.hideTimer = window.setTimeout(() => {
        if (!gradeGuideUi.pinned) closeGradeGuide();
      }, 160);
    }
  });

  window.addEventListener("resize", () => {
    if (gradeGuideUi.open && gradeGuideUi.trigger) {
      positionGradeGuidePopover(gradeGuideUi.trigger, ensureGradeGuidePopover());
    }
  });
  window.addEventListener("scroll", () => {
    if (gradeGuideUi.open && gradeGuideUi.trigger) {
      positionGradeGuidePopover(gradeGuideUi.trigger, ensureGradeGuidePopover());
    }
  }, true);
}

function renderGradeGuide(gradeGuide) {
  if (!pagePublishesVisGrades()) {
    hideUnpublishedVisChrome();
    return;
  }
  removeLegacyGradeGuideSection();
  fillGradeGuidePopover(gradeGuide);
  bindGradeGuideTriggers();
  initGradeGuideEvents();
}

function renderCommunityReport(data) {
  const section = document.getElementById("communitySection");
  const report = data?.community_report;
  if (!section) return;
  if (!report || !report.visibility_ft || report.error) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const confidence = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
  setText("communityConfidence", confidence[report.confidence_label] || "");
  setText("communityVis", `Reported visibility: ${report.visibility_ft[0]}–${report.visibility_ft[1]} ft`);
  setText("communityExcerpt", report.source_excerpt || "");
}

function todayPacific() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function renderStaleNotice(latest) {
  const banner = document.getElementById("staleBanner");
  if (!banner) return;
  const isStale = !latest.is_unavailable && latest.date && latest.date < todayPacific();
  if (!isStale) {
    banner.hidden = true;
    return;
  }
  banner.textContent = `Last updated ${shortDate(latest.date)} — conditions may have changed since this forecast was issued.`;
  banner.hidden = false;
}

function normalizeForecastHistory(history) {
  const rawEntries = Array.isArray(history)
    ? history
    : Array.isArray(history?.reports)
      ? history.reports
      : Array.isArray(history?.entries)
        ? history.entries
        : Array.isArray(history?.history)
          ? history.history
          : [];

  return rawEntries
    .filter((entry) => entry && entry.date)
    .map((entry) => ({
      ...entry,
      generated_at: entry.generated_at || entry.archived_at || entry.date,
      report_text: entry.report_text || entry.daily_report || entry.summary || "",
    }))
    .sort((a, b) => String(b.generated_at || b.date).localeCompare(String(a.generated_at || a.date)));
}

function renderForecastHistory(history, currentDate) {
  const list = document.getElementById("forecastHistory");
  const button = document.getElementById("historyToggle");
  if (!list) return;

  const savedEntries = normalizeForecastHistory(history);
  const pastEntries = savedEntries.filter((entry) => entry.date !== currentDate);
  const entries = pastEntries.length ? pastEntries : savedEntries;

  if (!entries.length) {
    list.innerHTML = `<p class="history-empty">Past reports will show here after the next forecast archive run.</p>`;
    if (button) button.hidden = true;
    return;
  }

  const visibleCount = 4;
  list.replaceChildren(...entries.map((entry, index) => {
    const article = document.createElement("article");
    article.className = `history-item${index >= visibleCount ? " is-hidden" : ""}`;
    const range = entry.estimated_visibility_range_ft || entry.visibility || [0, 0];
    article.innerHTML = `
      <div>
        <span>${shortDate(entry.date)}</span>
        <strong>${entry.grade || "C"} · ${feet(range)}</strong>
      </div>
      <p>${entry.report_text || "Forecast archived."}</p>
    `;
    return article;
  }));

  if (!button) return;
  button.hidden = entries.length <= visibleCount;
  button.textContent = `See ${entries.length - visibleCount} More`;
  button.onclick = () => {
    const hidden = [...list.querySelectorAll(".history-item.is-hidden")];
    const isExpanded = hidden.length === 0;
    list.querySelectorAll(".history-item").forEach((item, index) => {
      item.classList.toggle("is-hidden", isExpanded && index >= visibleCount);
    });
    button.textContent = isExpanded ? `See ${entries.length - visibleCount} More` : "Show Less";
  };
}

function removeRetiredMarineOutlookUi() {
  ["marineOutlook", "forecastDayDetail", "forecastDayHint", "forecastDayChips", "marineOutlookStyles"].forEach((id) => {
    document.getElementById(id)?.remove();
  });
}

const CANONICAL_LOCATION_SECTION_SELECTORS = [
  ".hero-camera, .forecast-panel",
  ".daily-report-card, #dailyReport, .report-copy",
  ".wave-card, .swell-card, #waveComponents",
  ".weather-card, #featureRows",
  "#tideChart",
  ".static-wind-card, #windChart",
  ".region-map-card, .spot-map-card, #spotRegionMap",
  ".ten-day-card, #forecastStrip",
];

function mainShellEl() {
  return document.querySelector("main.shell");
}

function locationSectionRoot(selector) {
  const main = mainShellEl();
  if (!main) return null;
  const hit = main.querySelector(selector);
  if (!hit) return null;
  let node = hit;
  while (node.parentElement && node.parentElement !== main) node = node.parentElement;
  return node.parentElement === main ? node : null;
}

function placeMontereyCompare() {
  const card = document.getElementById("montereyCompare")
    || document.querySelector("aside.monterey-compare");
  if (!card) return card;

  const reportCopy = document.querySelector(".daily-report-card .report-copy, .hero-content .report-copy, article.report-copy");
  const reportCard = document.querySelector(".hero-content .daily-report-card, .daily-report-card");
  const dailyReport = document.getElementById("dailyReport");
  const heroContent = document.querySelector(".hero-content");
  if (!reportCopy && !reportCard && !dailyReport) return card;

  let column = reportCard?.closest(".hero-report-column")
    || reportCopy?.closest(".hero-report-column")
    || document.querySelector(".hero-content > .hero-report-column");
  const columnHost = reportCard || reportCopy?.closest(".daily-report-card") || reportCopy;
  if (!column && columnHost) {
    column = document.createElement("div");
    column.className = "hero-report-column";
    columnHost.replaceWith(column);
    column.appendChild(columnHost);
  } else if (!column && heroContent) {
    column = document.createElement("div");
    column.className = "hero-report-column";
    heroContent.appendChild(column);
  }

  const anchor = reportCopy || dailyReport || reportCard;
  if (!anchor || anchor === card) {
    if (column && card.parentElement !== column) column.appendChild(card);
    return card;
  }

  if (card.parentElement !== anchor.parentElement || card.previousElementSibling !== anchor) {
    anchor.after(card);
  }
  return card;
}

function applyCanonicalLocationSectionOrder() {
  const main = mainShellEl();
  if (!main || !main.querySelector(".hero-camera, .forecast-panel")) return;
  placeMontereyCompare();
  const pinned = [];
  const seen = new Set();
  for (const selector of CANONICAL_LOCATION_SECTION_SELECTORS) {
    const el = locationSectionRoot(selector);
    if (!el || seen.has(el)) continue;
    seen.add(el);
    pinned.push(el);
  }
  if (pinned.length < 2) return;
  const children = [...main.children];
  const banners = children.filter((el) => el.matches(".stale-banner, #staleBanner, .beta-banner, .monterey-beta-banner"));
  const extras = children.filter((el) => !seen.has(el) && !banners.includes(el));
  const firstPinnedIndex = children.indexOf(pinned[0]);
  const leading = extras.filter((el) => children.indexOf(el) < firstPinnedIndex);
  const trailing = extras.filter((el) => !leading.includes(el));
  const next = [...banners, ...leading, ...pinned, ...trailing];
  if (next.length === children.length && next.every((el, i) => el === children[i])) return;
  main.append(...next);
}

removeRetiredMarineOutlookUi();
applyCanonicalLocationSectionOrder();
if (!pagePublishesVisGrades()) hideUnpublishedVisChrome();

try {
  updateSpotChrome(currentSpot());
} catch {
  // Chrome can still populate after forecast load.
}
try {
  initSwellMap();
} catch {
  swellMapInstance = null;
}
if (!swellMapInstance) {
  window.addEventListener("load", () => {
    try { initSwellMap(); } catch { swellMapInstance = null; }
  }, { once: true });
  window.setTimeout(() => {
    try { initSwellMap(); } catch { swellMapInstance = null; }
  }, 120);
}

loadForecastData().then(({ latest, tenDay, gradeGuide, history, cameraObservation }) => {
  scrippsCameraObservation = cameraObservation || null;
  const visibleForecasts = currentForecastWindow(tenDay);
  const initialForecast = initialForecastForToday(visibleForecasts, latest);
  if (!pagePublishesVisGrades()) hideUnpublishedVisChrome();
  render(initialForecast);
  renderStaleNotice(initialForecast);
  renderCommunityReport(initialForecast);
  if (pagePublishesVisGrades()) {
    renderForecastStrip(visibleForecasts, initialForecast.date);
    renderGradeGuide(gradeGuide);
    renderForecastHistory(history, initialForecast.date);
  }
  applyCanonicalLocationSectionOrder();
  if (!initialForecast.is_unavailable) {
    window.diveproTrack("forecast_loaded", {
      forecast_date: initialForecast.date,
      grade: initialForecast.grade,
      visibility_range: feet(initialForecast.estimated_visibility_range_ft),
      surf_range: waveHeightValue(initialForecast),
    });
  }
  window.addEventListener("divepro:selectForecastDate", (event) => {
    if (!event.detail || typeof window.__diveProSelectForecastDate !== "function") return;
    window.__diveProSelectForecastDate(event.detail, event.detail.source || "wind_map_day_select");
  });
});
