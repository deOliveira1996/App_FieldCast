package org.fieldcast.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundGeolocationPlugin.class);
        registerPlugin(FieldCastNotificationsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
