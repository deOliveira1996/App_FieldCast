package org.fieldcast.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Android 14+ (API 34/35) Foreground Location Service for FieldCast route recording.
 * Keeps CPU and GNSS active via a partial WakeLock while the screen is off / pocketed,
 * buffers up to 5000 fixes in thread-safe native memory, and streams fixes to
 * {@link BackgroundGeolocationPlugin} whenever the WebView is active.
 */
public class FieldCastLocationForegroundService extends Service {

    public static final String CHANNEL_ID = "fieldcast_bg_location";
    public static final int NOTIFICATION_ID = 4101;

    public static final String EXTRA_NOTIFICATION_TITLE = "backgroundTitle";
    public static final String EXTRA_NOTIFICATION_BODY = "backgroundMessage";

    private static final String DEFAULT_NOTIFICATION_TITLE = "FieldCast: Gravando rota...";
    private static final String DEFAULT_NOTIFICATION_BODY =
        "Rastreamento GPS ativo em segundo plano (filtro de acurácia <= 20m)";

    private static final String WAKELOCK_TAG = "FieldCast::GpsTrackerLock";
    private static final long WAKELOCK_TIMEOUT_MS = 8 * 60 * 60 * 1000L;

    private static final long GPS_MIN_TIME_MS = 2500L;
    private static final float GPS_MIN_DISTANCE_M = 3.0f;
    private static final long NETWORK_MIN_TIME_MS = 5000L;
    private static final float NETWORK_MIN_DISTANCE_M = 5.0f;

    private static final int MAX_BUFFER_SIZE = 5000;

    public interface LocationFixListener {
        void onLocationFix(@NonNull Location location);
    }

    private static final CopyOnWriteArrayList<Location> BUFFERED_LOCATIONS =
        new CopyOnWriteArrayList<>();

    private static volatile LocationFixListener activeListener;
    private static volatile boolean serviceRunning = false;

    private PowerManager.WakeLock wakeLock;
    private LocationManager locationManager;
    private boolean isListening = false;

    private final LocationListener locationListener = new LocationListener() {
        @Override
        public void onLocationChanged(@NonNull Location location) {
            handleLocationFix(location);
        }

        @Override
        public void onStatusChanged(String provider, int status, Bundle extras) {
            // Required override for API < 29 compatibility (avoids AbstractMethodError)
        }

        @Override
        public void onProviderEnabled(@NonNull String provider) {
            // No-op
        }

        @Override
        public void onProviderDisabled(@NonNull String provider) {
            // No-op
        }
    };

    public static void setLocationFixListener(@Nullable LocationFixListener listener) {
        activeListener = listener;
    }

    public static boolean isRunning() {
        return serviceRunning;
    }

    /**
     * Atomically snapshots and clears buffered fixes accumulated while WebView JS was throttled.
     */
    @NonNull
    public static List<Location> drainBufferedLocations() {
        synchronized (BUFFERED_LOCATIONS) {
            List<Location> drained = new ArrayList<>(BUFFERED_LOCATIONS);
            BUFFERED_LOCATIONS.clear();
            return drained;
        }
    }

    public static void clearBufferedLocations() {
        synchronized (BUFFERED_LOCATIONS) {
            BUFFERED_LOCATIONS.clear();
        }
    }

    private static void handleLocationFix(@Nullable Location location) {
        if (location == null) {
            return;
        }

        Location copy = new Location(location);
        synchronized (BUFFERED_LOCATIONS) {
            while (BUFFERED_LOCATIONS.size() >= MAX_BUFFER_SIZE) {
                BUFFERED_LOCATIONS.remove(0);
            }
            BUFFERED_LOCATIONS.add(copy);
        }

        LocationFixListener listener = activeListener;
        if (listener != null) {
            try {
                listener.onLocationFix(copy);
            } catch (RuntimeException ignored) {
                // Zero-Crash: buffered copy remains safe for drainBufferedLocations()
            }
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        serviceRunning = true;
        createNotificationChannelIfNeeded();
        acquirePartialWakeLock();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        serviceRunning = true;
        createNotificationChannelIfNeeded();
        acquirePartialWakeLock();

        String title = DEFAULT_NOTIFICATION_TITLE;
        String body = DEFAULT_NOTIFICATION_BODY;
        if (intent != null) {
            String customTitle = intent.getStringExtra(EXTRA_NOTIFICATION_TITLE);
            String customBody = intent.getStringExtra(EXTRA_NOTIFICATION_BODY);
            if (customTitle != null && !customTitle.trim().isEmpty()) {
                title = customTitle;
            }
            if (customBody != null && !customBody.trim().isEmpty()) {
                body = customBody;
            }
        }

        Notification notification = buildForegroundNotification(title, body);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (SecurityException se) {
            serviceRunning = false;
            releasePartialWakeLock();
            stopSelf();
            return START_NOT_STICKY;
        } catch (RuntimeException re) {
            serviceRunning = false;
            releasePartialWakeLock();
            stopSelf();
            return START_NOT_STICKY;
        }

        startLocationListeners();
        return START_STICKY;
    }

    private void createNotificationChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "FieldCast Rastreamento GPS",
                    NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription(
                    "Mantém o rastreamento de rota GPS ativo em segundo plano durante operações de campo."
                );
                channel.setShowBadge(false);
                nm.createNotificationChannel(channel);
            }
        }
    }

    @NonNull
    private Notification buildForegroundNotification(@NonNull String title, @NonNull String body) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, launchIntent, pendingFlags);

        int smallIcon = getApplicationInfo().icon;
        if (smallIcon == 0) {
            smallIcon = android.R.drawable.ic_menu_mylocation;
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(smallIcon)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(contentIntent)
            .build();
    }

    private void acquirePartialWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                if (wakeLock == null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG);
                    wakeLock.setReferenceCounted(false);
                }
                if (!wakeLock.isHeld()) {
                    wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
                }
            }
        } catch (RuntimeException ignored) {
            // Zero-Crash if WakeLock acquisition is restricted by OEM policy
        }
    }

    private void releasePartialWakeLock() {
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                }
            } catch (RuntimeException ignored) {
                // Zero-Crash if already released
            }
            wakeLock = null;
        }
    }

    private boolean hasLocationPermission() {
        return (
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        );
    }

    @SuppressWarnings("MissingPermission")
    private void startLocationListeners() {
        if (isListening || !hasLocationPermission()) {
            return;
        }

        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            return;
        }

        boolean registeredAny = false;

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    GPS_MIN_TIME_MS,
                    GPS_MIN_DISTANCE_M,
                    locationListener,
                    Looper.getMainLooper()
                );
                registeredAny = true;
            }
        } catch (SecurityException | IllegalArgumentException ignored) {
            // Continue to network provider check
        }

        try {
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    NETWORK_MIN_TIME_MS,
                    NETWORK_MIN_DISTANCE_M,
                    locationListener,
                    Looper.getMainLooper()
                );
                registeredAny = true;
            }
        } catch (SecurityException | IllegalArgumentException ignored) {
            // Ignore unavailable provider
        }

        isListening = registeredAny;
    }

    private void stopLocationListeners() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException | IllegalArgumentException ignored) {
                // Zero-Crash cleanup
            }
        }
        isListening = false;
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (RuntimeException ignored) {
            // Zero-Crash cleanup
        }
    }

    @Override
    public void onDestroy() {
        serviceRunning = false;
        stopLocationListeners();
        releasePartialWakeLock();
        stopForegroundCompat();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
