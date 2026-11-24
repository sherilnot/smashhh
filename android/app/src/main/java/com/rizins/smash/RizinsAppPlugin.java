package com.rizins.smash;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Marks APKs built with Firebase. The website's push script only turns on
 * Android push when this plugin exists, because older APKs without Firebase
 * crash if PushNotifications.register() is called.
 */
@CapacitorPlugin(name = "RizinsApp")
public class RizinsAppPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("firebase", true);
        call.resolve(result);
    }
}
