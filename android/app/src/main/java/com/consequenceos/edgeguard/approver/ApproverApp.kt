package com.consequenceos.edgeguard.approver

import android.app.Application
import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/**
 * Starts Firebase from the build's settings (no google-services plugin) and App Check
 * with its debug provider, which hackathon submissions accept. The debug token is set
 * at build time from android/local.properties, so the phone needs no USB or log access.
 */
class ApproverApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Store.init(this)
        val app = FirebaseApp.initializeApp(
            this,
            FirebaseOptions.Builder()
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .build(),
        )
        if (BuildConfig.APPCHECK_DEBUG_TOKEN.isNotEmpty()) {
            // Where the debug provider keeps its token; set before the provider starts.
            getSharedPreferences("com.google.firebase.appcheck.debug.store.${app.persistenceKey}", Context.MODE_PRIVATE)
                .edit()
                .putString("com.google.firebase.appcheck.debug.DEBUG_SECRET", BuildConfig.APPCHECK_DEBUG_TOKEN)
                .apply()
        }
        FirebaseAppCheck.getInstance(app).installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
    }
}
