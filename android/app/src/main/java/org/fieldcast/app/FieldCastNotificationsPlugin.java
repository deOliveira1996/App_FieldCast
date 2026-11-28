package org.fieldcast.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native Capacitor 6 plugin for FieldCast operational & meteorological alerts.
 * Supports immediate alerts, AlarmManager background scheduling (with graceful
 * fallback when exact alarm permission is not granted), and periodic WorkManager
 * weather/tide checks while the app is closed or locked.
 */
@CapacitorPlugin(
    name = "FieldCastNotifications",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class FieldCastNotificationsPlugin extends Plugin {

    public static final String CHANNEL_ID = "fieldcast_operational_alerts";
    private static final String CHANNEL_NAME = "Alertas Operacionais FieldCast";
    private static final String CHANNEL_DESCRIPTION =
        "Alertas meteorológicos, oceanográficos, maré MSL, geomagnéticos e janelas operacionais.";
    private static final String ALIAS_NOTIFICATIONS = "notifications";

    public static final String PREFS_NAME = "fieldcast_bg_alerts_prefs";
    public static final String KEY_SCHEDULED_ALERTS_JSON = "scheduled_alerts_json";
    public static final String KEY_MONITOR_CONFIG_JSON = "monitor_config_json";
    public static final String KEY_LEDGER_JSON = "bg_dispatch_ledger_json";
    public static final String WORK_UNIQUE_NAME = "fieldcast_periodic_weather_alert_check";

    private static final long PERIODIC_CHECK_INTERVAL_MINUTES = 90L;
    private static final AtomicInteger FALLBACK_NOTIFICATION_ID = new AtomicInteger(5200);

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        if (context != null) {
            ensureNotificationChannel(context);
        }
    }

    @Override
    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(buildPermissionSnapshot());
    }

    @Override
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Context context = getContext();
            if (context != null && !hasPostNotificationsPermission(context)) {
                requestPermissionForAlias(
                    ALIAS_NOTIFICATIONS,
                    call,
                    "handleNotificationsPermissionResult"
                );
                return;
            }
        }
        call.resolve(buildPermissionSnapshot());
    }

    @PermissionCallback
    private void handleNotificationsPermissionResult(PluginCall call) {
        if (call == null) {
            return;
        }
        call.resolve(buildPermissionSnapshot());
    }

    @PluginMethod
    public void dispatchNotification(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Contexto Android indisponível para envio de notificação.");
            return;
        }

        ensureNotificationChannel(context);

        if (!canPostNotifications(context)) {
            JSObject deniedResult = new JSObject();
            deniedResult.put("dispatched", false);
            deniedResult.put("reason", "permission_denied");
            call.resolve(deniedResult);
            return;
        }

        String rawTitle = call.getString("title", "Alerta Operacional FieldCast");
        String title = (rawTitle != null && !rawTitle.trim().isEmpty())
            ? rawTitle.trim()
            : "Alerta Operacional FieldCast";

        String rawBody = call.getString("body", "");
        String body = rawBody != null ? rawBody.trim() : "";

        String rawSubText = call.getString("subText", null);
        String subText = (rawSubText != null && !rawSubText.trim().isEmpty())
            ? rawSubText.trim()
            : null;

        Integer requestedId = call.getInt("notificationId");
        int notificationId = (requestedId != null && requestedId > 0)
            ? requestedId
            : FALLBACK_NOTIFICATION_ID.incrementAndGet();

        boolean dispatched = postOperationalNotification(
            context,
            notificationId,
            title,
            body,
            subText,
            false
        );

        JSObject ret = new JSObject();
        ret.put("dispatched", dispatched);
        ret.put("notificationId", notificationId);
        call.resolve(ret);
    }

    @PluginMethod
    public void scheduleBackgroundAlerts(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            JSObject ret = new JSObject();
            ret.put("scheduled", 0);
            call.resolve(ret);
            return;
        }

        ensureNotificationChannel(context);

        JSArray alertsArray = call.getArray("alerts");
        if (alertsArray == null) {
            cancelScheduledAlarms(context);
            saveStringPref(context, KEY_SCHEDULED_ALERTS_JSON, "[]");
            JSObject ret = new JSObject();
            ret.put("scheduled", 0);
            call.resolve(ret);
            return;
        }

        String alertsJson = alertsArray.toString();
        cancelScheduledAlarms(context);
        saveStringPref(context, KEY_SCHEDULED_ALERTS_JSON, alertsJson);
        int scheduled = scheduleAlertsFromJson(context, alertsJson);

        JSObject ret = new JSObject();
        ret.put("scheduled", scheduled);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAllScheduledAlerts(PluginCall call) {
        Context context = getContext();
        if (context != null) {
            cancelScheduledAlarms(context);
            saveStringPref(context, KEY_SCHEDULED_ALERTS_JSON, "[]");
        }
        JSObject ret = new JSObject();
        ret.put("cancelled", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void syncBackgroundMonitorConfig(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            JSObject ret = new JSObject();
            ret.put("synced", false);
            call.resolve(ret);
            return;
        }

        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Double latObj = call.getDouble("latitude");
        Double lonObj = call.getDouble("longitude");
        double latitude = latObj != null ? latObj : 0.0;
        double longitude = lonObj != null ? lonObj : 0.0;
        String locationName = call.getString("locationName", "Área Principal");
        String timezone = call.getString("timezone", "UTC");
        boolean extremeAuto = Boolean.TRUE.equals(call.getBoolean("extremeEventsAutoEnabled", true));
        Integer minPerDayObj = call.getInt("extremeMinPerDay", 2);
        int extremeMinPerDay = minPerDayObj != null ? Math.max(1, Math.min(12, minPerDayObj)) : 2;
        Integer intervalObj = call.getInt("urgentIntervalMinutes", 180);
        int urgentIntervalMinutes = intervalObj != null ? Math.max(15, Math.min(360, intervalObj)) : 180;
        String rulesJson = call.getString("rulesJson", "[]");

        JSONObject config = new JSONObject();
        try {
            config.put("enabled", enabled);
            config.put("latitude", latitude);
            config.put("longitude", longitude);
            config.put("locationName", locationName != null ? locationName : "Área Principal");
            config.put("timezone", timezone != null ? timezone : "UTC");
            config.put("extremeEventsAutoEnabled", extremeAuto);
            config.put("extremeMinPerDay", extremeMinPerDay);
            config.put("urgentIntervalMinutes", urgentIntervalMinutes);
            config.put("rulesJson", rulesJson != null ? rulesJson : "[]");
        } catch (JSONException ignored) {
            JSObject ret = new JSObject();
            ret.put("synced", false);
            call.resolve(ret);
            return;
        }

        saveStringPref(context, KEY_MONITOR_CONFIG_JSON, config.toString());
        if (!enabled) {
            cancelScheduledAlarms(context);
        }
        reschedulePeriodicWorker(context, enabled);

        JSObject ret = new JSObject();
        ret.put("synced", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getBackgroundAlertStatus(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        if (context == null) {
            ret.put("supported", false);
            ret.put("notificationsGranted", false);
            ret.put("exactAlarmAllowed", false);
            ret.put("ignoringBatteryOptimizations", false);
            call.resolve(ret);
            return;
        }

        boolean notificationsGranted = canPostNotifications(context);
        boolean exactAlarmAllowed = isExactAlarmPermitted(context);
        boolean ignoringBattery = isIgnoringBatteryOptimizations(context);

        ret.put("supported", true);
        ret.put("notificationsGranted", notificationsGranted);
        ret.put("exactAlarmAllowed", exactAlarmAllowed);
        ret.put("ignoringBatteryOptimizations", ignoringBattery);
        call.resolve(ret);
    }

    @PluginMethod
    public void getBackgroundStatus(PluginCall call) {
        getBackgroundAlertStatus(call);
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            ret.put("requested", false);
            call.resolve(ret);
            return;
        }

        if (isIgnoringBatteryOptimizations(context)) {
            ret.put("requested", true);
            call.resolve(ret);
            return;
        }

        boolean launched = false;
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            launched = true;
        } catch (RuntimeException primaryEx) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
                launched = true;
            } catch (RuntimeException ignored) {
                launched = false;
            }
        }

        ret.put("requested", launched);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        requestBatteryOptimizationExemption(call);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Context context = getContext();
        JSObject ret = new JSObject();
        if (context == null) {
            ret.put("opened", false);
            call.resolve(ret);
            return;
        }

        boolean opened = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(Uri.parse("package:" + context.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                opened = true;
            } catch (RuntimeException primaryEx) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    fallback.setData(Uri.parse("package:" + context.getPackageName()));
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(fallback);
                    opened = true;
                } catch (RuntimeException ignored) {
                    opened = false;
                }
            }
        } else {
            // Exact alarms require no separate runtime grant on Android < 12
            opened = true;
        }

        ret.put("opened", opened);
        call.resolve(ret);
    }

    // =========================================================================
    // Static Helpers Shared with Receivers and Periodic WorkManager Worker
    // =========================================================================

    public static void ensureNotificationChannel(@NonNull Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription(CHANNEL_DESCRIPTION);
                channel.enableVibration(true);
                nm.createNotificationChannel(channel);
            }
        }
    }

    public static boolean hasPostNotificationsPermission(@NonNull Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return (
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) ==
                PackageManager.PERMISSION_GRANTED
            );
        }
        return true;
    }

    public static boolean canPostNotifications(@NonNull Context context) {
        if (!hasPostNotificationsPermission(context)) {
            return false;
        }
        try {
            return NotificationManagerCompat.from(context).areNotificationsEnabled();
        } catch (RuntimeException ex) {
            return true;
        }
    }

    public static boolean isExactAlarmPermitted(@NonNull Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            return am != null && am.canScheduleExactAlarms();
        } catch (RuntimeException ex) {
            return false;
        }
    }

    public static boolean isIgnoringBatteryOptimizations(@NonNull Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return true;
        }
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        } catch (RuntimeException ex) {
            return false;
        }
    }

    @SuppressWarnings("MissingPermission")
    public static boolean postOperationalNotification(
        @NonNull Context context,
        int notificationId,
        @NonNull String title,
        @NonNull String body,
        @Nullable String subText,
        boolean urgent
    ) {
        ensureNotificationChannel(context);
        if (!canPostNotifications(context)) {
            return false;
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId,
            launchIntent,
            pendingFlags
        );

        int smallIcon = context.getApplicationInfo().icon;
        if (smallIcon == 0) {
            smallIcon = android.R.drawable.ic_dialog_info;
        }

        NotificationCompat.BigTextStyle bigTextStyle = new NotificationCompat.BigTextStyle()
            .setBigContentTitle(title)
            .bigText(body);
        if (subText != null && !subText.trim().isEmpty()) {
            bigTextStyle.setSummaryText(subText.trim());
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(smallIcon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(bigTextStyle)
            .setPriority(urgent ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        if (subText != null && !subText.trim().isEmpty()) {
            builder.setSubText(subText.trim());
        }

        Notification notification = builder.build();
        try {
            NotificationManagerCompat.from(context).notify(notificationId, notification);
            return true;
        } catch (RuntimeException ex) {
            return false;
        }
    }

    public static int scheduleAlertsFromJson(@NonNull Context context, @Nullable String alertsJson) {
        if (alertsJson == null || alertsJson.trim().isEmpty()) {
            return 0;
        }

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return 0;
        }

        int scheduled = 0;
        long nowMs = System.currentTimeMillis();

        try {
            JSONArray array = new JSONArray(alertsJson);
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.optJSONObject(i);
                if (obj == null) {
                    continue;
                }
                int id = obj.optInt("id", 0);
                if (id <= 0) {
                    id = FALLBACK_NOTIFICATION_ID.incrementAndGet();
                }
                long triggerAtMs = obj.optLong("triggerAtEpochMs", 0L);
                if (triggerAtMs <= nowMs - 60_000L) {
                    continue;
                }
                long safeTriggerMs = Math.max(nowMs + 5_000L, triggerAtMs);

                String title = obj.optString("title", "Alerta FieldCast");
                String body = obj.optString("body", "");
                String subText = obj.optString("subText", "");
                String tag = obj.optString("tag", "alert-" + id);
                boolean urgent = obj.optBoolean("urgent", false);

                Intent intent = new Intent(context, FieldCastAlertAlarmReceiver.class);
                intent.putExtra(FieldCastAlertAlarmReceiver.EXTRA_NOTIFICATION_ID, id);
                intent.putExtra(FieldCastAlertAlarmReceiver.EXTRA_TITLE, title);
                intent.putExtra(FieldCastAlertAlarmReceiver.EXTRA_BODY, body);
                intent.putExtra(FieldCastAlertAlarmReceiver.EXTRA_SUBTEXT, subText);
                intent.putExtra(FieldCastAlertAlarmReceiver.EXTRA_TAG, tag);
                intent.putExtra(FieldCastAlertAlarmReceiver.EXTRA_URGENT, urgent);

                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pi = PendingIntent.getBroadcast(context, id, intent, flags);

                if (scheduleSingleAlarmSafely(context, alarmManager, safeTriggerMs, pi)) {
                    scheduled++;
                }
            }
        } catch (JSONException ignored) {
            return scheduled;
        }

        return scheduled;
    }

    private static boolean scheduleSingleAlarmSafely(
        @NonNull Context context,
        @NonNull AlarmManager alarmManager,
        long triggerAtMs,
        @NonNull PendingIntent pendingIntent
    ) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (alarmManager.canScheduleExactAlarms()) {
                    alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        triggerAtMs,
                        pendingIntent
                    );
                } else {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        triggerAtMs,
                        pendingIntent
                    );
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerAtMs,
                    pendingIntent
                );
            } else {
                alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent);
            }
            return true;
        } catch (SecurityException secEx) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarmManager.setAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        triggerAtMs,
                        pendingIntent
                    );
                } else {
                    alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtMs, pendingIntent);
                }
                return true;
            } catch (RuntimeException ignored) {
                return false;
            }
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    public static void cancelScheduledAlarms(@NonNull Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }
        String existingJson = readStringPref(context, KEY_SCHEDULED_ALERTS_JSON, "[]");
        try {
            JSONArray array = new JSONArray(existingJson);
            for (int i = 0; i < array.length(); i++) {
                JSONObject obj = array.optJSONObject(i);
                if (obj == null) {
                    continue;
                }
                int id = obj.optInt("id", 0);
                if (id <= 0) {
                    continue;
                }
                Intent intent = new Intent(context, FieldCastAlertAlarmReceiver.class);
                int flags = PendingIntent.FLAG_NO_CREATE;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pi = PendingIntent.getBroadcast(context, id, intent, flags);
                if (pi != null) {
                    alarmManager.cancel(pi);
                    pi.cancel();
                }
            }
        } catch (JSONException | RuntimeException ignored) {
            // Safe cleanup
        }
    }

    public static void reschedulePeriodicWorker(@NonNull Context context, boolean enabled) {
        try {
            WorkManager wm = WorkManager.getInstance(context);
            if (!enabled) {
                wm.cancelUniqueWork(WORK_UNIQUE_NAME);
                return;
            }

            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                FieldCastBackgroundCheckWorker.class,
                PERIODIC_CHECK_INTERVAL_MINUTES,
                TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .build();

            wm.enqueueUniquePeriodicWork(
                WORK_UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            );
        } catch (RuntimeException ignored) {
            // Zero-Crash if WorkManager is unavailable in an unusual context
        }
    }

    public static void saveStringPref(
        @NonNull Context context,
        @NonNull String key,
        @NonNull String value
    ) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(key, value).apply();
    }

    @NonNull
    public static String readStringPref(
        @NonNull Context context,
        @NonNull String key,
        @NonNull String fallback
    ) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String val = prefs.getString(key, fallback);
        return val != null ? val : fallback;
    }

    @NonNull
    private JSObject buildPermissionSnapshot() {
        JSObject ret = new JSObject();
        Context context = getContext();
        if (context == null) {
            ret.put("notifications", PermissionState.DENIED.toString());
            return ret;
        }

        boolean systemEnabled;
        try {
            systemEnabled = NotificationManagerCompat.from(context).areNotificationsEnabled();
        } catch (RuntimeException ex) {
            systemEnabled = true;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (hasPostNotificationsPermission(context) && systemEnabled) {
                ret.put("notifications", PermissionState.GRANTED.toString());
            } else {
                PermissionState state = getPermissionState(ALIAS_NOTIFICATIONS);
                if (state == PermissionState.GRANTED && !systemEnabled) {
                    ret.put("notifications", PermissionState.DENIED.toString());
                } else {
                    ret.put(
                        "notifications",
                        state != null ? state.toString() : PermissionState.PROMPT.toString()
                    );
                }
            }
        } else {
            ret.put(
                "notifications",
                systemEnabled
                    ? PermissionState.GRANTED.toString()
                    : PermissionState.DENIED.toString()
            );
        }

        return ret;
    }
}
