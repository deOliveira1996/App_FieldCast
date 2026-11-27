package org.fieldcast.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Periodic Android WorkManager Worker (~90 min, NetworkType.CONNECTED) that checks
 * Open-Meteo Forecast & Marine endpoints directly over HttpURLConnection (10s timeout)
 * using persisted coordinates and alert rules, honoring recurrence ledgers and mandatory
 * DHN / Marinha do Brasil tide disclaimers even when the app is completely closed.
 */
public class FieldCastBackgroundCheckWorker extends Worker {

    private static final int HTTP_TIMEOUT_MS = 10_000;
    private static final long LEDGER_RETENTION_MS = 24L * 60L * 60L * 1000L;
    private static final String DHN_TIDE_DISCLAIMER_PT =
        "Aviso: cota oceânica MSL (~8 km) é estimativa hidrodinâmica e NÃO substitui as tábuas de marés oficiais da DHN / Marinha do Brasil.";

    public FieldCastBackgroundCheckWorker(
        @NonNull Context context,
        @NonNull WorkerParameters workerParams
    ) {
        super(context, workerParams);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        String configRaw = FieldCastNotificationsPlugin.readStringPref(
            context,
            FieldCastNotificationsPlugin.KEY_MONITOR_CONFIG_JSON,
            ""
        );
        if (configRaw.trim().isEmpty()) {
            return Result.success();
        }

        if (!FieldCastNotificationsPlugin.canPostNotifications(context)) {
            return Result.success();
        }

        try {
            JSONObject config = new JSONObject(configRaw);
            if (!config.optBoolean("enabled", false)) {
                return Result.success();
            }

            double latitude = config.optDouble("latitude", Double.NaN);
            double longitude = config.optDouble("longitude", Double.NaN);
            if (Double.isNaN(latitude) || Double.isNaN(longitude)) {
                return Result.success();
            }

            String locationName = config.optString("locationName", "Área Principal");
            String configuredTimezone = config.optString("timezone", "UTC");
            boolean extremeAuto = config.optBoolean("extremeEventsAutoEnabled", true);
            int extremeMinPerDay = Math.max(1, Math.min(12, config.optInt("extremeMinPerDay", 2)));
            int urgentIntervalMinutes = Math.max(
                15,
                Math.min(360, config.optInt("urgentIntervalMinutes", 180))
            );
            String rulesRaw = config.optString("rulesJson", "[]");
            JSONArray rules = parseJsonArraySafely(rulesRaw);

            JSONObject forecastJson = fetchForecastJson(latitude, longitude);
            if (forecastJson == null) {
                return getRunAttemptCount() < 2 ? Result.retry() : Result.success();
            }

            String resolvedTimezone = forecastJson.optString("timezone", configuredTimezone);
            if (resolvedTimezone == null || resolvedTimezone.trim().isEmpty()) {
                resolvedTimezone = "UTC";
            }

            JSONObject marineJson = fetchMarineJsonSafely(latitude, longitude);
            JSONObject ledger = loadCleanedLedger(context, System.currentTimeMillis());
            boolean ledgerChanged = false;

            if (extremeAuto) {
                boolean emittedExtreme = evaluateExtremeWeather(
                    context,
                    forecastJson,
                    locationName,
                    resolvedTimezone,
                    extremeMinPerDay,
                    urgentIntervalMinutes,
                    ledger
                );
                if (emittedExtreme) {
                    ledgerChanged = true;
                }
            }

            if (rules.length() > 0) {
                boolean emittedCustom = evaluateCustomRules(
                    context,
                    forecastJson,
                    marineJson,
                    rules,
                    locationName,
                    resolvedTimezone,
                    ledger
                );
                if (emittedCustom) {
                    ledgerChanged = true;
                }
            }

            if (ledgerChanged) {
                FieldCastNotificationsPlugin.saveStringPref(
                    context,
                    FieldCastNotificationsPlugin.KEY_LEDGER_JSON,
                    ledger.toString()
                );
            }

            return Result.success();
        } catch (JSONException | RuntimeException ex) {
            return Result.success();
        }
    }

    @Nullable
    private JSONObject fetchForecastJson(double latitude, double longitude) {
        String url = String.format(
            Locale.US,
            "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f" +
            "&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,cloud_cover_low,cloud_cover_mid,cloud_cover_high,cape,weather_code" +
            "&forecast_days=2&timeformat=unixtime&timezone=auto",
            latitude,
            longitude
        );
        return executeHttpGetJson(url);
    }

    @Nullable
    private JSONObject fetchMarineJsonSafely(double latitude, double longitude) {
        String url = String.format(
            Locale.US,
            "https://marine-api.open-meteo.com/v1/marine?latitude=%.4f&longitude=%.4f" +
            "&hourly=wave_height,sea_level_height_msl&forecast_days=2&timeformat=unixtime&timezone=auto",
            latitude,
            longitude
        );
        return executeHttpGetJson(url);
    }

    @Nullable
    private JSONObject executeHttpGetJson(@NonNull String endpointUrl) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpointUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(HTTP_TIMEOUT_MS);
            connection.setReadTimeout(HTTP_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "FieldCast-Android/4.3.0");

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                return null;
            }

            InputStream stream = connection.getInputStream();
            StringBuilder sb = new StringBuilder();
            try (
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(stream, StandardCharsets.UTF_8)
                )
            ) {
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
            }
            return new JSONObject(sb.toString());
        } catch (IOException | JSONException | RuntimeException ex) {
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private boolean evaluateExtremeWeather(
        @NonNull Context context,
        @NonNull JSONObject forecastJson,
        @NonNull String locationName,
        @NonNull String timezoneId,
        int extremeMinPerDay,
        int urgentIntervalMinutes,
        @NonNull JSONObject ledger
    ) {
        JSONObject hourly = forecastJson.optJSONObject("hourly");
        if (hourly == null) {
            return false;
        }

        JSONArray times = hourly.optJSONArray("time");
        if (times == null || times.length() == 0) {
            return false;
        }

        JSONArray gusts = hourly.optJSONArray("wind_gusts_10m");
        JSONArray precips = hourly.optJSONArray("precipitation");
        JSONArray capes = hourly.optJSONArray("cape");
        JSONArray weatherCodes = hourly.optJSONArray("weather_code");

        long nowMs = System.currentTimeMillis();
        long nowUnix = nowMs / 1000L;
        long horizonUnix = nowUnix + 24L * 3600L;

        double maxGust = -1;
        double maxPrecip = -1;
        double maxCape = -1;
        int severeStormCode = -1;
        long peakTs = nowUnix;

        for (int i = 0; i < times.length(); i++) {
            long ts = times.optLong(i, 0L);
            if (ts < nowUnix - 1800L || ts > horizonUnix) {
                continue;
            }
            Double g = readOptionalDouble(gusts, i);
            Double p = readOptionalDouble(precips, i);
            Double c = readOptionalDouble(capes, i);
            Double wc = readOptionalDouble(weatherCodes, i);

            if (g != null && g > maxGust) {
                maxGust = g;
                peakTs = ts;
            }
            if (p != null && p > maxPrecip) {
                maxPrecip = p;
                peakTs = ts;
            }
            if (c != null && c > maxCape) {
                maxCape = c;
                peakTs = ts;
            }
            if (wc != null && wc >= 95 && severeStormCode < 0) {
                severeStormCode = wc.intValue();
                peakTs = ts;
            }
        }

        List<String> triggers = new ArrayList<>();
        String categoryKey = null;
        if (maxCape >= 1500.0 || severeStormCode >= 95) {
            triggers.add(
                maxCape >= 1500.0
                    ? String.format(Locale.US, "CAPE %.0f J/kg", maxCape)
                    : "Tempestade elétrica severa (WMO " + severeStormCode + ")"
            );
            categoryKey = "storm";
        }
        if (maxGust >= 60.0) {
            triggers.add(String.format(Locale.US, "Rajadas %.0f km/h", maxGust));
            if (categoryKey == null) categoryKey = "gust";
        }
        if (maxPrecip >= 20.0) {
            triggers.add(String.format(Locale.US, "Chuva intensa %.1f mm/h", maxPrecip));
            if (categoryKey == null) categoryKey = "rain";
        }

        if (triggers.isEmpty() || categoryKey == null) {
            return false;
        }

        TimeZone tz = TimeZone.getTimeZone(timezoneId);
        String dayStamp = formatLocalYmd(nowMs, tz);
        String ledgerPrefix = "bg_ext:" + categoryKey + ":" + dayStamp;
        int sentToday = countLedgerMatches(ledger, ledgerPrefix);
        long lastSentMs = findLatestLedgerTimestamp(ledger, ledgerPrefix);
        long minIntervalMs = urgentIntervalMinutes * 60_000L;

        if (sentToday >= extremeMinPerDay || (lastSentMs > 0L && nowMs - lastSentMs < minIntervalMs)) {
            return false;
        }

        String hourLabel = formatLocalHour(peakTs * 1000L, tz);
        String title = "Alerta Extremo — " + locationName + " (" + hourLabel + ")";
        String body =
            "Condição severa prevista nas próximas 24h: " +
            joinStrings(triggers, " • ") +
            ". Revise abrigos e operações expostas. Fonte: Open-Meteo NWP.";

        String tag = ledgerPrefix + ":r" + sentToday;
        int notificationId = hashTagToId(tag);
        boolean posted = FieldCastNotificationsPlugin.postOperationalNotification(
            context,
            notificationId,
            title,
            body,
            locationName + " • Open-Meteo",
            true
        );
        if (posted) {
            try {
                ledger.put(tag, nowMs);
            } catch (JSONException ignored) {
                // Ignore
            }
            return true;
        }
        return false;
    }

    private boolean evaluateCustomRules(
        @NonNull Context context,
        @NonNull JSONObject forecastJson,
        @Nullable JSONObject marineJson,
        @NonNull JSONArray rules,
        @NonNull String locationName,
        @NonNull String timezoneId,
        @NonNull JSONObject ledger
    ) {
        JSONObject hourly = forecastJson.optJSONObject("hourly");
        if (hourly == null) {
            return false;
        }
        JSONArray times = hourly.optJSONArray("time");
        if (times == null || times.length() == 0) {
            return false;
        }

        JSONArray temps = hourly.optJSONArray("temperature_2m");
        JSONArray precipProbs = hourly.optJSONArray("precipitation_probability");
        JSONArray winds = hourly.optJSONArray("wind_speed_10m");
        JSONArray gusts = hourly.optJSONArray("wind_gusts_10m");
        JSONArray cloudLow = hourly.optJSONArray("cloud_cover_low");
        JSONArray cloudMid = hourly.optJSONArray("cloud_cover_mid");
        JSONArray cloudHigh = hourly.optJSONArray("cloud_cover_high");

        JSONObject marineHourly = marineJson != null ? marineJson.optJSONObject("hourly") : null;
        JSONArray waves = marineHourly != null ? marineHourly.optJSONArray("wave_height") : null;
        JSONArray tides = marineHourly != null
            ? marineHourly.optJSONArray("sea_level_height_msl")
            : null;

        TimeZone tz = TimeZone.getTimeZone(timezoneId);
        long nowMs = System.currentTimeMillis();
        long nowUnix = nowMs / 1000L;
        long horizonUnix = nowUnix + 24L * 3600L;
        int currentMinuteOfDay = getLocalMinuteOfDay(nowMs, tz);
        String dayStamp = formatLocalYmd(nowMs, tz);
        boolean anyDispatched = false;

        for (int r = 0; r < rules.length(); r++) {
            JSONObject rule = rules.optJSONObject(r);
            if (rule == null || !rule.optBoolean("enabled", true)) {
                continue;
            }

            String ruleId = rule.optString("id", "rule-" + r);
            String ruleName = rule.optString("name", "Alerta Personalizado");
            JSONObject conditions = rule.optJSONObject("conditions");
            JSONObject timeWindow = rule.optJSONObject("timeWindow");
            JSONObject recurrence = rule.optJSONObject("recurrence");
            if (conditions == null) {
                continue;
            }

            String startHHMM = timeWindow != null ? timeWindow.optString("startHHMM", "00:00") : "00:00";
            String endHHMM = timeWindow != null ? timeWindow.optString("endHHMM", "23:59") : "23:59";
            String notifyFrom = timeWindow != null && !timeWindow.isNull("notifyFromHHMM")
                ? timeWindow.optString("notifyFromHHMM", "")
                : "";

            String mode = recurrence != null ? recurrence.optString("mode", "once") : "once";
            int maxPerWindow = "once".equals(mode)
                ? 1
                : Math.max(1, Math.min(24, recurrence != null ? recurrence.optInt("maxTriggersPerWindow", 1) : 1));
            int intervalHours = "interval_hours".equals(mode)
                ? Math.max(1, Math.min(24, recurrence != null ? recurrence.optInt("intervalHours", 2) : 2))
                : 0;

            String ruleDayPrefix = "bg_rule:" + ruleId + ":" + dayStamp;
            int alreadySent = countLedgerMatches(ledger, ruleDayPrefix);
            if (alreadySent >= maxPerWindow) {
                continue;
            }

            long lastSentMs = findLatestLedgerTimestamp(ledger, ruleDayPrefix);
            if (intervalHours > 0 && lastSentMs > 0L && nowMs - lastSentMs < intervalHours * 3600_000L) {
                continue;
            }

            for (int i = 0; i < times.length(); i++) {
                long ts = times.optLong(i, 0L);
                if (ts < nowUnix - 1800L || ts > horizonUnix) {
                    continue;
                }

                int hourMinuteOfDay = getLocalMinuteOfDay(ts * 1000L, tz);
                if (!isWithinWindow(hourMinuteOfDay, startHHMM, endHHMM, notifyFrom, currentMinuteOfDay)) {
                    continue;
                }

                List<String> breaches = new ArrayList<>();
                boolean usedTide = false;

                Double temp = readOptionalDouble(temps, i);
                Double prob = readOptionalDouble(precipProbs, i);
                Double wind = readOptionalDouble(winds, i);
                Double gust = readOptionalDouble(gusts, i);
                Double wave = readOptionalDouble(waves, i);
                Double tide = readOptionalDouble(tides, i);
                Double meanCloud = computeMeanCloud(
                    readOptionalDouble(cloudLow, i),
                    readOptionalDouble(cloudMid, i),
                    readOptionalDouble(cloudHigh, i)
                );

                Double minTemp = readOptionalConfigNumber(conditions, "minTempC");
                if (minTemp != null && temp != null && temp < minTemp) {
                    breaches.add(String.format(Locale.US, "Temp %.1f °C < %.1f °C", temp, minTemp));
                }
                Double maxTemp = readOptionalConfigNumber(conditions, "maxTempC");
                if (maxTemp != null && temp != null && temp > maxTemp) {
                    breaches.add(String.format(Locale.US, "Temp %.1f °C > %.1f °C", temp, maxTemp));
                }
                Double minProb = readOptionalConfigNumber(conditions, "minPrecipProbPct");
                if (minProb != null && prob != null && prob >= minProb) {
                    breaches.add(String.format(Locale.US, "Chuva %.0f%% >= %.0f%%", prob, minProb));
                }
                Double maxWind = readOptionalConfigNumber(conditions, "maxWindKmh");
                if (maxWind != null && wind != null && wind >= maxWind) {
                    breaches.add(String.format(Locale.US, "Vento %.1f km/h >= %.1f km/h", wind, maxWind));
                }
                Double maxGust = readOptionalConfigNumber(conditions, "maxGustKmh");
                if (maxGust != null && gust != null && gust >= maxGust) {
                    breaches.add(String.format(Locale.US, "Rajada %.1f km/h >= %.1f km/h", gust, maxGust));
                }
                Double maxCloud = readOptionalConfigNumber(conditions, "maxCloudCoverPct");
                if (maxCloud != null && meanCloud != null && meanCloud >= maxCloud) {
                    breaches.add(String.format(Locale.US, "Nuvens %.0f%% >= %.0f%%", meanCloud, maxCloud));
                }
                Double maxWave = readOptionalConfigNumber(conditions, "maxWaveM");
                if (maxWave != null && wave != null && wave >= maxWave) {
                    breaches.add(String.format(Locale.US, "Onda %.2f m >= %.2f m", wave, maxWave));
                }
                // Continental-safe MSL tide evaluation (null marine data never throws or triggers)
                Double minTide = readOptionalConfigNumber(conditions, "minTideMslM");
                if (minTide != null && tide != null && tide <= minTide) {
                    breaches.add(String.format(Locale.US, "Maré MSL %.2f m <= %.2f m", tide, minTide));
                    usedTide = true;
                }
                Double maxTide = readOptionalConfigNumber(conditions, "maxTideMslM");
                if (maxTide != null && tide != null && tide >= maxTide) {
                    breaches.add(String.format(Locale.US, "Maré MSL %.2f m >= %.2f m", tide, maxTide));
                    usedTide = true;
                }

                if (breaches.isEmpty()) {
                    continue;
                }

                String hourLabel = formatLocalHour(ts * 1000L, tz);
                String customTitle = rule.optString("customTitle", "").trim();
                String title = customTitle.isEmpty()
                    ? ("Alerta: " + ruleName + " (" + hourLabel + ")")
                    : customTitle.replace("{hour}", hourLabel).replace("{ruleName}", ruleName);

                String customMessage = rule.optString("customMessage", "").trim();
                String details = joinStrings(breaches, " • ");
                String body = customMessage.isEmpty()
                    ? ("Janela " + startHHMM + "–" + endHHMM + " às " + hourLabel + ": " + details + ".")
                    : customMessage
                        .replace("{hour}", hourLabel)
                        .replace("{window}", startHHMM + "–" + endHHMM)
                        .replace("{details}", details)
                        .replace("{tide}", tide != null ? String.format(Locale.US, "%.2f", tide) : "—");

                if (usedTide && !body.toUpperCase(Locale.US).contains("DHN")) {
                    body = body + " " + DHN_TIDE_DISCLAIMER_PT;
                }

                String tag = ruleDayPrefix + ":h" + ts;
                if (ledger.has(tag)) {
                    continue;
                }

                boolean posted = FieldCastNotificationsPlugin.postOperationalNotification(
                    context,
                    hashTagToId(tag),
                    title,
                    body,
                    locationName + " • FieldCast",
                    false
                );
                if (posted) {
                    try {
                        ledger.put(tag, nowMs);
                    } catch (JSONException ignored) {
                        // Ignore
                    }
                    anyDispatched = true;
                    break;
                }
            }
        }

        return anyDispatched;
    }

    private static JSONArray parseJsonArraySafely(@Nullable String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONArray();
        }
        try {
            return new JSONArray(raw);
        } catch (JSONException ex) {
            return new JSONArray();
        }
    }

    private static JSONObject loadCleanedLedger(@NonNull Context context, long nowMs) {
        String raw = FieldCastNotificationsPlugin.readStringPref(
            context,
            FieldCastNotificationsPlugin.KEY_LEDGER_JSON,
            "{}"
        );
        JSONObject cleaned = new JSONObject();
        long cutoffMs = nowMs - LEDGER_RETENTION_MS;
        try {
            JSONObject parsed = new JSONObject(raw);
            Iterator<String> keys = parsed.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                long ts = parsed.optLong(k, 0L);
                if (ts >= cutoffMs) {
                    cleaned.put(k, ts);
                }
            }
        } catch (JSONException ignored) {
            return cleaned;
        }
        return cleaned;
    }

    private static int countLedgerMatches(@NonNull JSONObject ledger, @NonNull String prefix) {
        int count = 0;
        Iterator<String> keys = ledger.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            if (k.startsWith(prefix)) {
                count++;
            }
        }
        return count;
    }

    private static long findLatestLedgerTimestamp(
        @NonNull JSONObject ledger,
        @NonNull String prefix
    ) {
        long latest = 0L;
        Iterator<String> keys = ledger.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            if (k.startsWith(prefix)) {
                long ts = ledger.optLong(k, 0L);
                if (ts > latest) {
                    latest = ts;
                }
            }
        }
        return latest;
    }

    @Nullable
    private static Double readOptionalDouble(@Nullable JSONArray arr, int idx) {
        if (arr == null || idx < 0 || idx >= arr.length() || arr.isNull(idx)) {
            return null;
        }
        double val = arr.optDouble(idx, Double.NaN);
        return Double.isNaN(val) || Double.isInfinite(val) ? null : val;
    }

    @Nullable
    private static Double readOptionalConfigNumber(@NonNull JSONObject obj, @NonNull String key) {
        if (!obj.has(key) || obj.isNull(key)) {
            return null;
        }
        double val = obj.optDouble(key, Double.NaN);
        return Double.isNaN(val) || Double.isInfinite(val) ? null : val;
    }

    @Nullable
    private static Double computeMeanCloud(
        @Nullable Double low,
        @Nullable Double mid,
        @Nullable Double high
    ) {
        double sum = 0;
        int count = 0;
        if (low != null) {
            sum += low;
            count++;
        }
        if (mid != null) {
            sum += mid;
            count++;
        }
        if (high != null) {
            sum += high;
            count++;
        }
        return count > 0 ? sum / count : null;
    }

    private static int parseHHMMToMinutes(@NonNull String hhmm) {
        String[] parts = hhmm.trim().split(":");
        if (parts.length != 2) {
            return 0;
        }
        try {
            int h = Math.max(0, Math.min(23, Integer.parseInt(parts[0])));
            int m = Math.max(0, Math.min(59, Integer.parseInt(parts[1])));
            return h * 60 + m;
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private static boolean isWithinWindow(
        int minuteOfDay,
        @NonNull String startHHMM,
        @NonNull String endHHMM,
        @NonNull String notifyFromHHMM,
        int currentMinuteOfDay
    ) {
        if (!notifyFromHHMM.trim().isEmpty()) {
            int notifyFrom = parseHHMMToMinutes(notifyFromHHMM);
            if (currentMinuteOfDay < notifyFrom) {
                return false;
            }
        }
        int start = parseHHMMToMinutes(startHHMM);
        int end = parseHHMMToMinutes(endHHMM);
        if (start <= end) {
            return minuteOfDay >= start && minuteOfDay <= end;
        }
        return minuteOfDay >= start || minuteOfDay <= end;
    }

    private static int getLocalMinuteOfDay(long epochMs, @NonNull TimeZone tz) {
        Calendar cal = Calendar.getInstance(tz);
        cal.setTimeInMillis(epochMs);
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
    }

    private static String formatLocalHour(long epochMs, @NonNull TimeZone tz) {
        Calendar cal = Calendar.getInstance(tz);
        cal.setTimeInMillis(epochMs);
        return String.format(
            Locale.US,
            "%02d:%02d",
            cal.get(Calendar.HOUR_OF_DAY),
            cal.get(Calendar.MINUTE)
        );
    }

    private static String formatLocalYmd(long epochMs, @NonNull TimeZone tz) {
        Calendar cal = Calendar.getInstance(tz);
        cal.setTimeInMillis(epochMs);
        return String.format(
            Locale.US,
            "%04d-%02d-%02d",
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH) + 1,
            cal.get(Calendar.DAY_OF_MONTH)
        );
    }

    private static String joinStrings(@NonNull List<String> items, @NonNull String sep) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < items.size(); i++) {
            if (i > 0) sb.append(sep);
            sb.append(items.get(i));
        }
        return sb.toString();
    }

    private static int hashTagToId(@NonNull String tag) {
        int hash = 0x811c9dc5;
        for (int i = 0; i < tag.length(); i++) {
            hash ^= tag.charAt(i);
            hash *= 0x01000193;
        }
        return (Math.abs(hash == Integer.MIN_VALUE ? 1 : hash) % 900_000) + 10_000;
    }
}
