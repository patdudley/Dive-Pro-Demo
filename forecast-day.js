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
  const exact = rows.find((forecast) => forecastDateKey(forecast) === today);
  if (exact) return exact;
  if (forecastDateKey(publishedLatest) === today) return publishedLatest;
  return rows.find((forecast) => forecastDateKey(forecast) > today)
    || publishedLatest
    || source?.latest
    || source
    || null;
}
