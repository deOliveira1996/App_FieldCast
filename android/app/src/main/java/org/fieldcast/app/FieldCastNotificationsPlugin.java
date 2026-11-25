package org.fieldcast.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Native Capacitor 6 plugin for FieldCast operational & meteorological alerts.
 * Uses exclusively standard Android SDK + AndroidX Core NotificationCompat (compileSdk 35)
 * with zero extra Gradle dependencies.
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
        "Alertas meteorológicos, oceanográficos, geomagnéticos e janelas operacionais configuradas.";
    private static final String ALIAS_NOTIFICATIONS = "notifications";

    private static final AtomicInteger FALLBACK_NOTIFICATION_ID = new AtomicInteger(5200);

    @Override
    public void load() {
        super.load();
        ensureNotificationChannel();
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
            if (!hasPostNotificationsPermission()) {
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

        ensureNotificationChannel();

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

        Notification notification = buildOperationalNotification(
            context,
            notificationId,
            title,
            body,
            subText
        );

        boolean dispatched = postNotificationSafely(context, notificationId, notification);
        JSObject ret = new JSObject();
        ret.put("dispatched", dispatched);
        ret.put("notificationId", notificationId);
        call.resolve(ret);
    }

    @SuppressWarnings("MissingPermission")
    private boolean postNotificationSafely(
        @NonNull Context context,
        int notificationId,
        @NonNull Notification notification
    ) {
        try {
            NotificationManagerCompat.from(context).notify(notificationId, notification);
            return true;
        } catch (RuntimeException ex) {
            return false;
        }
    }

    @NonNull
    private Notification buildOperationalNotification(
        @NonNull Context context,
        int notificationId,
        @NonNull String title,
        @NonNull String body,
        String subText
    ) {
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
        if (subText != null) {
            bigTextStyle.setSummaryText(subText);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(smallIcon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(bigTextStyle)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setContentIntent(contentIntent);

        if (subText != null) {
            builder.setSubText(subText);
        }

        return builder.build();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Context context = getContext();
            if (context == null) {
                return;
            }
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

    private boolean hasPostNotificationsPermission() {
        Context context = getContext();
        if (context == null) {
            return false;
        }
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

    private boolean canPostNotifications(@NonNull Context context) {
        if (!hasPostNotificationsPermission()) {
            return false;
        }
        try {
            return NotificationManagerCompat.from(context).areNotificationsEnabled();
        } catch (RuntimeException ex) {
            return true;
        }
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
            if (hasPostNotificationsPermission() && systemEnabled) {
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
