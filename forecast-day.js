function forecastDateKey(forecast) {
  return String(forecast?.date || forecast?.features?.date || "");
}

function forecastRows(source) {
  if (Array.isArray(source)) return source;
  if (Array.isArray(source?.ten_day)) return source.ten_day;
  if (Array.isArray(source?.forecasts)) return source.forecasts;
  return [];
}

export function selectForecastForToday(source, publishedLatest, today) {
  const rows = forecastRows(source)
    .filter((forecast) => forecast && forecastDateKey(forecast))
    .sort((a, b) => forecastDateKey(a).localeCompare(forecastDateKey(b)));
  const latest = publishedLatest || source?.latest || (!Array.isArray(source) ? source : null);
  if (latest && forecastDateKey(latest) < today) {
    return rows.find((forecast) => forecastDateKey(forecast) === today) || latest;
  }
  return latest || rows.find((forecast) => forecastDateKey(forecast) === today) || null;
}
