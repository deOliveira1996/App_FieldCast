package org.fieldcast.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Native Capacitor 6 plugin bridging {@link FieldCastLocationForegroundService}
 * to {@code registerPlugin('BackgroundGeolocation')} in TypeScript.
 */
@CapacitorPlugin(
    name = "BackgroundGeolocation",
    permissions = {
        @Permission(
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            },
            alias = "location"
        ),
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class BackgroundGeolocationPlugin extends Plugin {

    private static final String ALIAS_LOCATION = "location";
    private static final String ALIAS_NOTIFICATIONS = "notifications";

    private final Map<String, PluginCall> watchingCalls = new ConcurrentHashMap<>();

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void addWatcher(PluginCall call) {
        call.setKeepAlive(true);
        boolean shouldRequestPermissions = Boolean.TRUE.equals(
            call.getBoolean("requestPermissions", true)
        );

        if (!hasLocationPermission()) {
            if (shouldRequestPermissions) {
                if (
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    getPermissionState(ALIAS_NOTIFICATIONS) != PermissionState.GRANTED
                ) {
                    requestPermissionForAliases(
                        new String[] { ALIAS_LOCATION, ALIAS_NOTIFICATIONS },
                        call,
                        "completeAddWatcher"
                    );
                } else {
                    requestPermissionForAlias(ALIAS_LOCATION, call, "completeAddWatcher");
                }
            } else {
                call.setKeepAlive(false);
                call.reject("Permissão de localização não concedida.");
            }
            return;
        }

        if (
            shouldRequestPermissions &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            getPermissionState(ALIAS_NOTIFICATIONS) == PermissionState.PROMPT
        ) {
            requestPermissionForAlias(ALIAS_NOTIFICATIONS, call, "completeAddWatcher");
            return;
        }

        startForegroundWatcher(call);
    }

    @PermissionCallback
    private void completeAddWatcher(PluginCall call) {
        if (call == null) {
            return;
        }
        if (hasLocationPermission()) {
            startForegroundWatcher(call);
        } else {
            call.setKeepAlive(false);
            call.reject("Permissão de localização negada pelo usuário.");
        }
    }

    private void startForegroundWatcher(@NonNull PluginCall call) {
        if (watchingCalls.isEmpty() && !FieldCastLocationForegroundService.isRunning()) {
            FieldCastLocationForegroundService.clearBufferedLocations();
        }

        watchingCalls.put(call.getCallbackId(), call);

        FieldCastLocationForegroundService.setLocationFixListener(location -> {
            JSObject payload = locationToJSObject(location);
            for (PluginCall activeCall : watchingCalls.values()) {
                try {
                    activeCall.resolve(payload);
                } catch (RuntimeException ignored) {
                    // Buffered location remains available via drainBufferedLocations()
                }
            }
        });

        String title = call.getString("backgroundTitle", "FieldCast: Gravando rota...");
        String body = call.getString(
            "backgroundMessage",
            "Rastreamento GPS ativo em segundo plano (filtro de acurácia <= 20m)"
        );

        Intent serviceIntent = new Intent(getContext(), FieldCastLocationForegroundService.class);
        serviceIntent.putExtra(FieldCastLocationForegroundService.EXTRA_NOTIFICATION_TITLE, title);
        serviceIntent.putExtra(FieldCastLocationForegroundService.EXTRA_NOTIFICATION_BODY, body);

        try {
            ContextCompat.startForegroundService(getContext(), serviceIntent);
        } catch (RuntimeException ex) {
            watchingCalls.remove(call.getCallbackId());
            if (watchingCalls.isEmpty()) {
                FieldCastLocationForegroundService.setLocationFixListener(null);
            }
            call.setKeepAlive(false);
            call.reject("Falha ao iniciar o serviço de localização em primeiro plano.", ex);
        }
    }

    @PluginMethod
    public void removeWatcher(PluginCall call) {
        String callbackId = call.getString("id");
        if (callbackId != null) {
            PluginCall removed = watchingCalls.remove(callbackId);
            if (removed != null && bridge != null) {
                removed.release(bridge);
            } else if (bridge != null) {
                PluginCall saved = bridge.getSavedCall(callbackId);
                if (saved != null) {
                    saved.release(bridge);
                }
            }
        } else {
            if (bridge != null) {
                for (PluginCall activeCall : watchingCalls.values()) {
                    activeCall.release(bridge);
                }
            }
            watchingCalls.clear();
        }

        if (watchingCalls.isEmpty()) {
            FieldCastLocationForegroundService.setLocationFixListener(null);
            FieldCastLocationForegroundService.clearBufferedLocations();
            try {
                Intent stopIntent = new Intent(
                    getContext(),
                    FieldCastLocationForegroundService.class
                );
                getContext().stopService(stopIntent);
            } catch (RuntimeException ignored) {
                // Zero-Crash cleanup
            }
        }

        call.resolve();
    }

    @PluginMethod
    public void drainBufferedLocations(PluginCall call) {
        List<Location> drained = FieldCastLocationForegroundService.drainBufferedLocations();
        JSArray locationsArray = new JSArray();
        for (Location loc : drained) {
            if (loc != null) {
                locationsArray.put(locationToJSObject(loc));
            }
        }
        JSObject ret = new JSObject();
        ret.put("locations", locationsArray);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        // Detach WebView callback reference to avoid Activity leak while service keeps buffering
        FieldCastLocationForegroundService.setLocationFixListener(null);
        watchingCalls.clear();
        super.handleOnDestroy();
    }

    private boolean hasLocationPermission() {
        return (
            ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.ACCESS_FINE_LOCATION
            ) ==
                PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) ==
                PackageManager.PERMISSION_GRANTED
        );
    }

    @NonNull
    private static JSObject locationToJSObject(@NonNull Location location) {
        JSObject ret = new JSObject();
        ret.put("latitude", location.getLatitude());
        ret.put("longitude", location.getLongitude());
        ret.put("accuracy", (double) location.getAccuracy());
        if (location.hasSpeed()) {
            ret.put("speed", (double) location.getSpeed());
        } else {
            ret.put("speed", JSObject.NULL);
        }
        if (location.hasBearing()) {
            ret.put("bearing", (double) location.getBearing());
        } else {
            ret.put("bearing", JSObject.NULL);
        }
        ret.put("time", location.getTime());
        return ret;
    }
}
