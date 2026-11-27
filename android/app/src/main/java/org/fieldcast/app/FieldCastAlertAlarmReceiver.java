package org.fieldcast.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * BroadcastReceiver triggered by Android AlarmManager to dispatch scheduled
 * FieldCast operational alerts on {@link FieldCastNotificationsPlugin#CHANNEL_ID}
 * even when the app process is closed or the screen is locked.
 */
public class FieldCastAlertAlarmReceiver extends BroadcastReceiver {

    public static final String EXTRA_NOTIFICATION_ID = "fieldcast_notification_id";
    public static final String EXTRA_TITLE = "fieldcast_title";
    public static final String EXTRA_BODY = "fieldcast_body";
    public static final String EXTRA_SUBTEXT = "fieldcast_subtext";
    public static final String EXTRA_TAG = "fieldcast_tag";
    public static final String EXTRA_URGENT = "fieldcast_urgent";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        FieldCastNotificationsPlugin.ensureNotificationChannel(context);
        if (!FieldCastNotificationsPlugin.canPostNotifications(context)) {
            return;
        }

        int notificationId = intent.getIntExtra(
            EXTRA_NOTIFICATION_ID,
            (int) (System.currentTimeMillis() % 800_000L) + 10_000
        );
        String rawTitle = intent.getStringExtra(EXTRA_TITLE);
        String title = (rawTitle != null && !rawTitle.trim().isEmpty())
            ? rawTitle.trim()
            : "Alerta Operacional FieldCast";
        String rawBody = intent.getStringExtra(EXTRA_BODY);
        String body = rawBody != null ? rawBody.trim() : "";
        String subText = intent.getStringExtra(EXTRA_SUBTEXT);
        boolean urgent = intent.getBooleanExtra(EXTRA_URGENT, false);

        FieldCastNotificationsPlugin.postOperationalNotification(
            context,
            notificationId,
            title,
            body,
            subText,
            urgent
        );
    }
}
