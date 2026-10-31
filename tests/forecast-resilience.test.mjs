import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { selectForecastForToday } from '../forecast-day.js';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function helpers(names, context = {}) {
  const scope = vm.createContext({ Date, Intl, console, ...context });
  const code = names.map(name => {
    const match = app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, `Missing helper ${name}`);
    return match[0];
  }).join('\n');
  vm.runInContext(code, scope);
  return scope;
}

const today = { date: '2026-10-31', grade: 'C' };
test('selects today from every supported forecast bundle shape', () => {
  for (const key of ['tenDay', 'ten_day', 'forecast_10day', 'forecasts']) {
    assert.equal(selectForecastForToday({ [key]: [today] }, null, today.date), today);
  }
});
test('a future latest row cannot override today', () => {
  assert.equal(selectForecastForToday([today], { date: '2026-11-01' }, today.date), today);
  assert.equal(selectForecastForToday([], null, today.date), null);
});
test('missing marine readings do not become calm wind or freezing water', () => {
  const h = helpers(['finiteNumber', 'maxFinite']);
  for (const value of [null, undefined, '', false, true, NaN]) assert.equal(h.finiteNumber(value), null);
  assert.equal(h.finiteNumber(0), 0);
  assert.equal(h.maxFinite([null, undefined, '']), null);
  assert.equal(h.maxFinite([null, 3, 5]), 5);
});
test('live swell never changes future forecast conditions', () => {
  const h = helpers(['forecastDateKey', 'finiteNumber', 'enrichForecastSwell'], {
    localTodayInLaJolla: () => today.date,
  });
  const forecast = { date: '2026-11-01', features: { swell_wave_height_max_ft: 6 } };
  const result = h.enrichForecastSwell(forecast, { swell_trains_live: true, swell_wave_height_max_ft: 1 });
  assert.equal(result.features.swell_wave_height_max_ft, 6);
});
test('selecting a future day displays that day\'s temperature, not today\'s', () => {
  const h = helpers(['attachWeatherCard', 'finiteNumber'], {
    localTodayInLaJolla: () => today.date,
    isoDateKey: value => value,
    mergeDefinedFeatures: (a, b) => ({ ...a, ...b }),
  });
  const result = h.attachWeatherCard({ date: '2026-11-01', features: {} }, {
    weather_by_date: { '2026-10-31': { air_temp_max_f: 74 }, '2026-11-01': { air_temp_max_f: 65 } },
  });
  assert.equal(result.features.air_temp_max_f, 65);
});
test('an atomic forecast bundle loads without requesting redundant files', async () => {
  const requested = [];
  const h = helpers(['fetchPublishedLaJolla'], {
    fetchJson: async path => {
      requested.push(path);
      return { latest: today, tenDay: [today] };
    },
  });
  const result = await h.fetchPublishedLaJolla();
  assert.equal(result.latest, today);
  assert.equal(requested.length, 1);
});
test('missing bundle and ten-day file still preserve a valid latest forecast', async () => {
  const h = helpers(['fetchPublishedLaJolla'], {
    fetchJson: async path => {
      if (path.endsWith('/latest_forecast.json')) return today;
      throw new Error('404');
    },
  });
  const result = await h.fetchPublishedLaJolla();
  assert.equal(result.latest, today);
  assert.equal(result.tenDay.length, 0);
});
test('all forecast files missing produces an explicit failure, never a sample grade', async () => {
  const h = helpers(['fetchPublishedLaJolla'], { fetchJson: async () => { throw new Error('offline'); } });
  await assert.rejects(h.fetchPublishedLaJolla(), /unavailable/);
  assert.doesNotMatch(app, /function fallbackForecast/);
});

test('sunrise labels follow the Pacific DST change instead of a fixed UTC offset', () => {
  const h = helpers(['decimalHourFromIso', 'pacificDecimalHour']);
  assert.equal(h.decimalHourFromIso('2026-10-31T14:06:00Z'), 7.1);
  assert.equal(h.decimalHourFromIso('2026-11-01T14:06:00Z'), 6.1);
});

test('wind map timestamps are UTC and absent readings stay absent', () => {
  const source = fs.readFileSync(new URL('../spot-map.js', import.meta.url), 'utf8');
  const scope = vm.createContext({ Date, NOW_FRAME_TOLERANCE_MS: 5400000, WIND_FORECAST_HOURS: 240,
    CA_WIND_BBOX: {}, normalizeWindFrame: frame => frame });
  for (const name of ['uvFromSpeedDir', 'buildCaliforniaWindManifest']) {
    const match = source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, 'm'));
    assert.ok(match);
    vm.runInContext(match[0], scope);
  }
  const times = Array.from({length: 24}, (_, hour) => `2026-11-01T${String(hour).padStart(2, '0')}:00`);
  const manifest = scope.buildCaliforniaWindManifest([33], [-117], [{row:0, col:0}], [{hourly:{time:times,
    wind_speed_10m:times.map(() => null), wind_direction_10m:times.map(() => null), cloud_cover:times.map(() => null)}}], 1);
  assert.ok(manifest.frames.every(frame => frame.valid_utc === frame.path.replace('live-ca-wind:', '').replace('Z', ':00.000Z')));
  assert.equal(manifest.frames[0].grid.u[0][0], null);
  assert.equal(manifest.frames[0].grid.cloud[0][0], null);
});

test('search suggestions match full multiword spot names and partial words', () => {
  const source = fs.readFileSync(new URL('../home-directory.js', import.meta.url), 'utf8');
  const scope = vm.createContext({BUBBLE_COPY:{}});
  for (const name of ['suggestFields', 'spotMatchesQuery']) {
    vm.runInContext(source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, 'm'))[0], scope);
  }
  const spot = {name:'La Jolla', slug:'la-jolla', city:'San Diego'};
  for (const query of ['La Jolla', 'la jo', 'la-jolla', 'San Diego']) assert.ok(scope.spotMatchesQuery(spot, query));
  for (const query of ['Monterey', 'la unknown', '---']) assert.equal(scope.spotMatchesQuery(spot, query), false);
});
