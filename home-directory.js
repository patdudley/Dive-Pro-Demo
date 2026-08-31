(function () {
  const BUBBLE_COPY = {
    "la-jolla": { name: "La Jolla", place: "San Diego, CA" },
    monterey: { name: "Monterey", place: "Monterey, CA" },
    "monterey-mcabee": { name: "McAbee", place: "Monterey, CA" },
    "monterey-lovers": { name: "Lovers Point", place: "Pacific Grove, CA" },
    "monterey-lobos": { name: "Point Lobos", place: "Carmel, CA" },
    "monterey-monastery": { name: "Monastery", place: "Carmel, CA" },
    "catalina-wrigley": { name: "Catalina Wrigley", place: "Catalina Island, CA" },
    "anacapa-ocean": { name: "Anacapa", place: "Channel Islands, CA" },
  };

  const GRADE_STATUS = {
    "A+": "Exceptional",
    A: "Excellent",
    B: "Good",
    C: "Moderate",
    D: "Poor",
    F: "No-dive",
  };

  const FORECAST_PATHS = {
    "la-jolla": "model_outputs/latest_forecast.json",
    monterey: "model_outputs/spots/monterey.json",
  };

  const EMPTY = "—";
  const VIS_EMPTY = "No published vis";

  const spotState = new Map();
  let scrippsPreview = null;
  let sliderIndex = 0;

  function californiaSpots() {
    if (typeof window.californiaSpots === "function") return window.californiaSpots();
    return (window.outdoorSpots || []).filter((spot) => spot.regionGroup === "California");
  }

  function hubSpots() {
    if (typeof window.homeDirectorySpots === "function") return window.homeDirectorySpots();
    return californiaSpots().filter((spot) => !spot.parentSlug);
  }

  function gradeClass(grade) {
    return `grade-${String(grade || "").toLowerCase().replace("+", "-plus")}`;
  }

  function gradeStatus(grade) {
    return GRADE_STATUS[String(grade || "").trim().toUpperCase()] || "";
  }

  function placeLine(spot) {
    const copy = BUBBLE_COPY[spot.slug] || {};
    if (copy.place) return copy.place;
    if (spot.city) return `${spot.city}, CA`;
    return spot.location || "";
  }

  function forecastPathFor(spot) {
    return FORECAST_PATHS[spot.slug] || spot.forecastPath || "";
  }

  function spotPublishesVis(spot) {
    if (typeof window.spotPublishesVisGrades === "function") {
      return window.spotPublishesVisGrades(spot);
    }
    const slug = String(spot?.slug || "");
    if (slug === "catalina-wrigley" || slug === "anacapa-ocean") return false;
    return Boolean(forecastPathFor(spot) || slug === "la-jolla");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function youtubeId(url) {
    const match = String(url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|live\/))([A-Za-z0-9_-]{6,})/);
    return match ? match[1] : "";
  }

  function spotHaystack(spot) {
    const copy = BUBBLE_COPY[spot.slug] || {};
    const state = spotState.get(spot.slug) || {};
    return [copy.name, copy.place, spot.name, spot.pickerLabel, spot.city, spot.location, state.visRange, state.grade]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function cameraStill(spot) {
    if (spot.slug === "la-jolla") return scrippsPreview || spot.image || "";
    return spot.image || "";
  }

  function featurePhoto(spot) {
    const yt = youtubeId(spot.liveEmbedUrl || spot.cameraUrl);
    if (yt) return `https://i.ytimg.com/vi/${yt}/hq720.jpg`;
    return cameraStill(spot);
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function celsiusToF(value) {
    const number = finiteNumber(value);
    return number == null ? null : number * 9 / 5 + 32;
  }

  function metersToFeet(value) {
    const number = finiteNumber(value);
    return number == null ? null : number * 3.28084;
  }

  function pacificTodayKey() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function isoDateKey(value) {
    const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  }

  function nearestHourIndex(times) {
    if (!Array.isArray(times) || !times.length) return -1;
    const now = Date.now();
    let best = 0;
    let bestDelta = Infinity;
    times.forEach((time, index) => {
      const stamp = Date.parse(time);
      if (!Number.isFinite(stamp)) return;
      const delta = Math.abs(stamp - now);
      if (delta < bestDelta) {
        best = index;
        bestDelta = delta;
      }
    });
    return best;
  }

  function todayValues(times, values, convert) {
    const today = pacificTodayKey();
    const out = [];
    (times || []).forEach((time, index) => {
      if (isoDateKey(time) !== today) return;
      const number = convert ? convert(values?.[index]) : finiteNumber(values?.[index]);
      if (number != null) out.push(number);
    });
    return out;
  }

  function rangeLabel(values, unit, digits = 0) {
    const clean = (values || []).filter((value) => Number.isFinite(value));
    if (!clean.length) return "";
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const a = digits ? min.toFixed(digits) : String(Math.round(min));
    const b = digits ? max.toFixed(digits) : String(Math.round(max));
    if (a === b) return `${a}${unit}`;
    return `${a}–${b}${unit}`;
  }

  function singleLabel(value, unit, digits = 0) {
    const number = finiteNumber(value);
    if (number == null) return "";
    const shown = digits ? number.toFixed(digits) : String(Math.round(number));
    return `${shown}${unit}`;
  }

  function emptyState() {
    return { grade: "", visRange: "", water: "", wind: "", swell: "", source: "" };
  }

  function stateFor(slug) {
    return spotState.get(slug) || emptyState();
  }

  function applyState(slug, patch) {
    spotState.set(slug, { ...emptyState(), ...stateFor(slug), ...patch });
  }

  function visFromForecast(forecast) {
    if (!forecast) return { grade: "", visRange: "" };
    const latest = forecast.latest || forecast;
    if (latest.is_unavailable) return { grade: "", visRange: "" };
    const letter = String(latest.grade || "").trim().toUpperCase();
    const range = latest.estimated_visibility_range_ft;
    if (!letter) return { grade: "", visRange: "" };
    return {
      grade: letter,
      visRange: Array.isArray(range) && range.length >= 2 ? `${range[0]}–${range[1]} ft` : "",
    };
  }

  function fallbackFromForecast(forecast) {
    const latest = forecast?.latest || forecast;
    const features = latest?.features || {};
    const vis = visFromForecast(forecast);
    return {
      ...vis,
      water: singleLabel(features.water_temp_estimate_f ?? features.ml_sst_f, "°F"),
      wind: singleLabel(features.wind_speed_max_mph, " mph"),
      swell: singleLabel(features.swell_wave_height_max_ft ?? features.surf_height_max_ft, " ft", 1),
      source: "forecast file",
    };
  }

  async function fetchJson(url) {
    const absolute = /^https?:/i.test(url);
    const href = absolute || String(url).includes("?") ? url : `${url}?t=${Date.now()}`;
    const response = await fetch(href, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function pacificToday() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  }

  async function loadForecast(slug, path) {
    try {
      let forecast = await fetchJson(path);
      const latest = forecast.latest || forecast;
      if (slug === "la-jolla" && latest?.date && latest.date < pacificToday()) {
        try {
          forecast = await fetchJson("https://diveproca.com/model_outputs/latest_forecast.json");
        } catch {
          // Keep the local emit if the published host is unreachable.
        }
      }
      applyState(slug, fallbackFromForecast(forecast));
    } catch {
      if (slug === "la-jolla") {
        try {
          const published = await fetchJson("https://diveproca.com/model_outputs/latest_forecast.json");
          applyState(slug, fallbackFromForecast(published));
          return;
        } catch {
          // Fall through to empty vis.
        }
      }
      applyState(slug, visFromForecast(null));
    }
  }

  async function loadOpenMeteo(spot) {
    const lat = Number(spot.lat);
    const lon = Number(spot.lon);
    const marineLat = Number(spot.marineLat ?? spot.lat);
    const marineLon = Number(spot.marineLon ?? spot.lon);
    if (![lat, lon, marineLat, marineLon].every(Number.isFinite)) return;

    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${marineLat}&longitude=${marineLon}&hourly=sea_surface_temperature,swell_wave_height&forecast_days=1&timezone=America/Los_Angeles`;
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m&wind_speed_unit=mph&forecast_days=1&timezone=America/Los_Angeles`;

    const [marineResult, weatherResult] = await Promise.allSettled([
      fetchJson(marineUrl),
      fetchJson(weatherUrl),
    ]);

    const patch = {};
    if (marineResult.status === "fulfilled") {
      const hourly = marineResult.value.hourly || {};
      const water = todayValues(hourly.time, hourly.sea_surface_temperature, celsiusToF);
      const swell = todayValues(hourly.time, hourly.swell_wave_height, metersToFeet);
      const waterNow = celsiusToF(hourly.sea_surface_temperature?.[nearestHourIndex(hourly.time || [])]);
      const swellNow = metersToFeet(hourly.swell_wave_height?.[nearestHourIndex(hourly.time || [])]);
      patch.water = rangeLabel(water.length ? water : [waterNow], "°F") || "";
      patch.swell = rangeLabel(swell.length ? swell : [swellNow], " ft", 1) || "";
    }
    if (weatherResult.status === "fulfilled") {
      const hourly = weatherResult.value.hourly || {};
      const wind = todayValues(hourly.time, hourly.wind_speed_10m);
      const windNow = finiteNumber(hourly.wind_speed_10m?.[nearestHourIndex(hourly.time || [])]);
      patch.wind = rangeLabel(wind.length ? wind : [windNow], " mph") || "";
    }
    if (Object.keys(patch).length) {
      patch.source = "Open-Meteo";
      applyState(spot.slug, patch);
    }
  }

  async function loadScrippsPreview() {
    try {
      const data = await fetchJson("camera-snapshots/scripps-pier-last-valid.json");
      if (data.image_url) scrippsPreview = data.image_url;
    } catch {
      scrippsPreview = null;
    }
  }

  function metricCell(icon, label, value, emptyText) {
    const shown = value || emptyText || EMPTY;
    const missing = !value;
    return `
      <div class="home-cond-metric${missing ? " is-empty" : ""}">
        <span class="home-cond-icon" aria-hidden="true">${icon}</span>
        <span class="home-cond-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(shown)}</strong>
      </div>
    `;
  }

  function sliderPage(spot) {
    const copy = BUBBLE_COPY[spot.slug] || { name: spot.name, place: spot.city || spot.location || "" };
    const state = stateFor(spot.slug);
    const publishesVis = spotPublishesVis(spot);
    const grade = publishesVis && state.grade
      ? `<span class="home-cond-grade ${gradeClass(state.grade)}">${escapeHtml(state.grade)}</span>`
      : "";
    return `
      <article class="home-cond-page" data-slug="${escapeHtml(spot.slug)}" aria-label="${escapeHtml(copy.name)} conditions">
        <div class="home-cond-spot">
          <div>
            <h3>${escapeHtml(copy.name)}</h3>
          </div>
          ${grade}
        </div>
        <div class="home-cond-metrics">
          ${metricCell(thermometerIcon(), "Water temp", state.water)}
          ${publishesVis ? metricCell(eyeIcon(), "Visibility", state.visRange, VIS_EMPTY) : ""}
          ${metricCell(windIcon(), "Wind", state.wind)}
          ${metricCell(swellIcon(), "Swell", state.swell)}
        </div>
      </article>
    `;
  }

  function thermometerIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14.5V6a2 2 0 1 1 4 0v8.5a3.5 3.5 0 1 1-4 0Z"/><path d="M12 17.5v-7"/></svg>`;
  }

  function eyeIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>`;
  }

  function pinIcon() {
    return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-5.2 6.5-10.2a6.5 6.5 0 1 0-13 0C5.5 15.8 12 21 12 21Z"/><circle cx="12" cy="10.8" r="2.1"/></svg>`;
  }

  function visEyeIcon() {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>`;
  }

  function windIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 13h14a2.5 2.5 0 1 1-2.5 2.5"/><path d="M5 17h6"/></svg>`;
  }

  function swellIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15c2.4-2.6 4.4-2.6 6.8 0 2.4 2.6 4.4 2.6 6.8 0 1.6-1.7 3.1-2.3 4.4-1.8"/><path d="M3 10c2.4-2.6 4.4-2.6 6.8 0 2.4 2.6 4.4 2.6 6.8 0 1.6-1.7 3.1-2.3 4.4-1.8"/></svg>`;
  }

  function renderSlider(spots) {
    const pages = document.getElementById("spotCondPages");
    const dots = document.getElementById("spotCondDots");
    if (!pages || !dots) return;
    pages.innerHTML = spots.map(sliderPage).join("");
    dots.innerHTML = spots.map((spot, index) => {
      const copy = BUBBLE_COPY[spot.slug] || { name: spot.name };
      return `<button type="button" role="tab" data-index="${index}" aria-label="${escapeHtml(copy.name)}" aria-selected="${index === sliderIndex ? "true" : "false"}"></button>`;
    }).join("");
    goToSlide(sliderIndex, false);
  }

  function sliderSpots() {
    return hubSpots();
  }

  function goToSlide(index, smooth = true) {
    const spots = sliderSpots();
    if (!spots.length) return;
    sliderIndex = ((index % spots.length) + spots.length) % spots.length;
    const viewport = document.getElementById("spotCondTrack");
    if (viewport) {
      const width = viewport.clientWidth || 1;
      viewport.scrollTo({ left: sliderIndex * width, behavior: smooth ? "smooth" : "auto" });
    }
    document.querySelectorAll("#spotCondDots [data-index]").forEach((dot) => {
      const active = Number(dot.dataset.index) === sliderIndex;
      dot.setAttribute("aria-selected", active ? "true" : "false");
    });
    const current = spots[sliderIndex];
    if (current) {
      document.getElementById("spotCondTrack")?.setAttribute("aria-label", `${(BUBBLE_COPY[current.slug] || {}).name || current.name} conditions`);
    }
  }

  function syncIndexFromScroll() {
    const viewport = document.getElementById("spotCondTrack");
    const pages = document.getElementById("spotCondPages");
    if (!viewport || !pages?.children.length) return;
    const width = viewport.clientWidth || 1;
    const next = Math.round(viewport.scrollLeft / width);
    if (next !== sliderIndex) goToSlide(next, false);
  }

  function featuredCard(spot) {
    const copy = BUBBLE_COPY[spot.slug] || { name: spot.name, place: spot.city || spot.location || "" };
    const state = stateFor(spot.slug);
    const photo = featurePhoto(spot);
    const place = placeLine(spot);
    const publishesVis = spotPublishesVis(spot);
    const card = document.createElement("article");
    card.className = publishesVis ? "spot-feature" : "spot-feature is-no-vis";
    card.dataset.slug = spot.slug;
    const status = gradeStatus(state.grade);
    const grade = publishesVis && state.grade
      ? `<div class="spot-feature-grade-col">
          <span class="spot-feature-grade-wrap">
            <span class="spot-feature-grade ${gradeClass(state.grade)}">${escapeHtml(state.grade)}</span>
          </span>
          ${status ? `<span class="spot-feature-grade-status">${escapeHtml(status)}</span>` : ""}
        </div>`
      : publishesVis
        ? `<div class="spot-feature-grade-col is-empty">
          <span class="spot-feature-grade-wrap">
            <span class="spot-feature-grade">—</span>
          </span>
        </div>`
        : "";
    const visValue = state.visRange
      ? `<strong class="spot-feature-vis">${escapeHtml(state.visRange)}</strong>`
      : `<strong class="spot-feature-vis is-empty">${VIS_EMPTY}</strong>`;
    const visCol = publishesVis
      ? `<div class="spot-feature-vis-col">
            <span class="spot-feature-vis-icon">${visEyeIcon()}</span>
            <span class="spot-feature-vis-label">Visibility</span>
            ${visValue}
          </div>`
      : "";
    const img = photo
      ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(spot.imageAlt || copy.name)}">`
      : `<div class="spot-feature-fallback">${escapeHtml(copy.name)}</div>`;
    card.innerHTML = `
      <a class="spot-feature-link" href="${escapeHtml(spot.href)}" aria-label="Open ${escapeHtml(copy.name)}">
        <figure class="spot-feature-photo">${img}</figure>
        <div class="spot-feature-body">
          <div class="spot-feature-copy">
            <h3>${escapeHtml(copy.name)}</h3>
            ${place ? `<p class="spot-feature-place">${pinIcon()}<span>${escapeHtml(place)}</span></p>` : ""}
          </div>
          ${visCol}
          ${grade}
        </div>
      </a>
    `;
    card.querySelectorAll("img").forEach((image) => {
      image.addEventListener("error", () => {
        const src = image.getAttribute("src") || "";
        if (src.includes("/hq720.jpg")) {
          image.src = src.replace("/hq720.jpg", "/hqdefault.jpg");
          return;
        }
        image.replaceWith(Object.assign(document.createElement("div"), {
          className: "spot-feature-fallback",
          textContent: copy.name,
        }));
      });
    });
    return card;
  }

  function renderFeatured(spots, query = "") {
    const list = document.getElementById("spotBubbles");
    const empty = document.getElementById("spotSearchEmpty");
    if (!list) return;
    const q = query.trim().toLowerCase();
    const visible = spots.filter((spot) => !q || spotHaystack(spot).includes(q));
    list.replaceChildren(...visible.map(featuredCard));
    if (empty) empty.hidden = visible.length > 0;
  }

  function scrollToCard(slug) {
    const card = document.querySelector(`#spotBubbles [data-slug="${slug}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function jumpToBestMatch(spots, query) {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const matches = spots.filter((spot) => spotHaystack(spot).includes(q));
    const exact = matches.find((spot) => {
      const copy = BUBBLE_COPY[spot.slug] || {};
      return [copy.name, spot.pickerLabel, spot.name, spot.city]
        .some((value) => String(value || "").toLowerCase() === q);
    });
    const target = exact || (matches.length === 1 ? matches[0] : matches[0]);
    if (!target) return;
    const hubs = sliderSpots();
    const index = hubs.findIndex((spot) => spot.slug === target.slug);
    if (index >= 0) goToSlide(index);
    scrollToCard(target.slug);
  }

  function bindSlider() {
    const viewport = document.getElementById("spotCondTrack");
    const prev = document.getElementById("spotCondPrev");
    const next = document.getElementById("spotCondNext");
    const dots = document.getElementById("spotCondDots");
    prev?.addEventListener("click", () => goToSlide(sliderIndex - 1));
    next?.addEventListener("click", () => goToSlide(sliderIndex + 1));
    dots?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-index]");
      if (!button) return;
      goToSlide(Number(button.dataset.index));
    });
    viewport?.addEventListener("scroll", () => {
      window.clearTimeout(viewport._slideSync);
      viewport._slideSync = window.setTimeout(syncIndexFromScroll, 80);
    }, { passive: true });
    viewport?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToSlide(sliderIndex - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToSlide(sliderIndex + 1);
      }
    });
    let touchX = null;
    viewport?.addEventListener("touchstart", (event) => {
      touchX = event.changedTouches[0]?.clientX ?? null;
    }, { passive: true });
    viewport?.addEventListener("touchend", (event) => {
      const endX = event.changedTouches[0]?.clientX;
      if (touchX == null || endX == null) return;
      const delta = endX - touchX;
      if (Math.abs(delta) < 40) return;
      goToSlide(sliderIndex + (delta < 0 ? 1 : -1));
      touchX = null;
    }, { passive: true });
  }

  function visibleDirectorySpots(query = "") {
    const all = californiaSpots();
    const hubs = hubSpots();
    const q = query.trim().toLowerCase();
    if (!q) return hubs;
    return all.filter((spot) => spotHaystack(spot).includes(q));
  }

  function searchableSpots() {
    return californiaSpots().filter((spot) => spot.href);
  }

  function spotDisplayName(spot) {
    return (BUBBLE_COPY[spot.slug] || {}).name || spot.pickerLabel || spot.name || "";
  }

  function suggestFields(spot) {
    const copy = BUBBLE_COPY[spot.slug] || {};
    return [copy.name, spot.name, spot.pickerLabel, spot.pinLabel, spot.city, String(spot.slug || "").replace(/-/g, " ")]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
  }

  function spotMatchesQuery(spot, query) {
    return suggestFields(spot).some((text) => (
      text.split(/[^a-z0-9+]+/).some((token) => token.startsWith(query))
    ));
  }

  function matchSuggestSpots(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchableSpots()
      .filter((spot) => spotMatchesQuery(spot, q))
      .sort((a, b) => {
        const an = spotDisplayName(a).toLowerCase();
        const bn = spotDisplayName(b).toLowerCase();
        const aStart = an.startsWith(q) ? 0 : 1;
        const bStart = bn.startsWith(q) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        const aHub = a.parentSlug ? 1 : 0;
        const bHub = b.parentSlug ? 1 : 0;
        if (aHub !== bHub) return aHub - bHub;
        return an.localeCompare(bn);
      });
  }

  let suggestIndex = -1;

  function suggestOptions() {
    return [...document.querySelectorAll("#spotSearchSuggest [role='option']:not([aria-disabled='true'])")];
  }

  function hideSuggest() {
    const list = document.getElementById("spotSearchSuggest");
    const input = document.getElementById("spotSearch");
    if (list) {
      list.hidden = true;
      list.innerHTML = "";
    }
    input?.setAttribute("aria-expanded", "false");
    input?.removeAttribute("aria-activedescendant");
    suggestIndex = -1;
  }

  function setSuggestIndex(index) {
    const input = document.getElementById("spotSearch");
    const options = suggestOptions();
    if (!options.length) {
      suggestIndex = -1;
      input?.removeAttribute("aria-activedescendant");
      return;
    }
    suggestIndex = ((index % options.length) + options.length) % options.length;
    options.forEach((option, i) => {
      const on = i === suggestIndex;
      option.classList.toggle("is-active", on);
      option.setAttribute("aria-selected", on ? "true" : "false");
    });
    const active = options[suggestIndex];
    if (active) input?.setAttribute("aria-activedescendant", active.id);
  }

  function renderSuggest(query) {
    const list = document.getElementById("spotSearchSuggest");
    const input = document.getElementById("spotSearch");
    if (!list || !input) return;
    const q = query.trim();
    if (!q) {
      hideSuggest();
      return;
    }
    const matches = matchSuggestSpots(q);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!matches.length) {
      list.innerHTML = `<li class="home-search-suggest-empty" role="option" id="spotSearchOpt-none" aria-disabled="true">No matching spots</li>`;
      suggestIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    list.innerHTML = matches.map((spot, index) => {
      const name = spotDisplayName(spot);
      const place = (BUBBLE_COPY[spot.slug] || {}).place || spot.city || "";
      return `
        <li role="option" id="spotSearchOpt-${index}" data-href="${escapeHtml(spot.href)}" data-slug="${escapeHtml(spot.slug)}" aria-selected="false">
          <a class="home-search-suggest-link" href="${escapeHtml(spot.href)}">
            <strong>${escapeHtml(name)}</strong>
            ${place ? `<span>${escapeHtml(place)}</span>` : ""}
          </a>
        </li>`;
    }).join("");
    setSuggestIndex(0);
  }

  function goToSuggest() {
    const options = suggestOptions();
    const target = options[suggestIndex] || options[0];
    const href = target?.dataset.href || target?.querySelector("a")?.getAttribute("href");
    if (href) window.location.assign(href);
  }

  function bindSuggest(form, input) {
    const list = document.getElementById("spotSearchSuggest");
    input?.addEventListener("keydown", (event) => {
      const open = list && !list.hidden;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) renderSuggest(input.value || "");
        else setSuggestIndex(suggestIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (open) setSuggestIndex(suggestIndex - 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        hideSuggest();
      } else if (event.key === "Enter" && open && suggestOptions().length) {
        event.preventDefault();
        goToSuggest();
      }
    });
    document.addEventListener("pointerdown", (event) => {
      if (!form?.contains(event.target)) hideSuggest();
    });
  }

  function renderAll() {
    const input = document.getElementById("spotSearch");
    const query = input?.value || "";
    renderSlider(sliderSpots());
    renderFeatured(visibleDirectorySpots(query), query);
  }

  async function initHomeDirectory() {
    const form = document.getElementById("spotSearchForm");
    const input = document.getElementById("spotSearch");
    hubSpots().forEach((spot) => applyState(spot.slug, emptyState()));
    bindSlider();
    bindSuggest(form, input);
    input?.addEventListener("input", () => {
      const query = input.value || "";
      renderFeatured(visibleDirectorySpots(query), query);
      renderSuggest(query);
      const matches = visibleDirectorySpots(query);
      if (query.trim() && matches.length) {
        const index = sliderSpots().findIndex((spot) => spot.slug === matches[0].slug);
        if (index >= 0) goToSlide(index);
      }
    });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      const list = document.getElementById("spotSearchSuggest");
      if (list && !list.hidden && suggestOptions().length) {
        goToSuggest();
        return;
      }
      jumpToBestMatch(californiaSpots(), input?.value || "");
    });
    renderAll();

    const forecastJobs = californiaSpots()
      .map((spot) => {
        const path = forecastPathFor(spot);
        return path ? loadForecast(spot.slug, path) : null;
      })
      .filter(Boolean);
    const liveJobs = hubSpots().map((spot) => loadOpenMeteo(spot));
    await Promise.allSettled([...forecastJobs, ...liveJobs, loadScrippsPreview()]);
    renderAll();
    if (input?.value?.trim()) renderSuggest(input.value);
  }

  initHomeDirectory();
}());
