package org.fieldcast.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Restores pending FieldCast AlarmManager alerts and periodic WorkManager
 * background weather monitoring after a device reboot or app update.
 */
public class FieldCastBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        String action = intent.getAction();
        if (
            !Intent.ACTION_BOOT_COMPLETED.equals(action) &&
            !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        ) {
            return;
        }

        String configJson = FieldCastNotificationsPlugin.readStringPref(
            context,
            FieldCastNotificationsPlugin.KEY_MONITOR_CONFIG_JSON,
            ""
        );
        if (configJson.trim().isEmpty()) {
            return;
        }

        try {
            JSONObject config = new JSONObject(configJson);
            boolean enabled = config.optBoolean("enabled", false);
            if (!enabled) {
                return;
            }

            FieldCastNotificationsPlugin.ensureNotificationChannel(context);
            FieldCastNotificationsPlugin.reschedulePeriodicWorker(context, true);

            String scheduledAlertsJson = FieldCastNotificationsPlugin.readStringPref(
                context,
                FieldCastNotificationsPlugin.KEY_SCHEDULED_ALERTS_JSON,
                "[]"
            );
            FieldCastNotificationsPlugin.scheduleAlertsFromJson(context, scheduledAlertsJson);
        } catch (JSONException | RuntimeException ignored) {
            // Safe recovery without crashing boot receiver
        }
    }
}
