import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Firebase settings and the App Check debug token come from android/local.properties,
// which is not committed. See android/README.md.
val local = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
fun setting(name: String): String = "\"" + (local.getProperty(name) ?: "").replace("\"", "") + "\""

android {
    namespace = "com.consequenceos.edgeguard.approver"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.consequenceos.edgeguard.approver"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "FIREBASE_API_KEY", setting("firebase.apiKey"))
        buildConfigField("String", "FIREBASE_APP_ID", setting("firebase.appId"))
        buildConfigField("String", "FIREBASE_PROJECT_ID", setting("firebase.projectId"))
        buildConfigField("String", "APPCHECK_DEBUG_TOKEN", setting("appcheck.debugToken"))
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation("com.google.firebase:firebase-ai:18.2.0")
    implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta08")
    implementation("com.google.firebase:firebase-firestore:27.2.0")
    implementation("com.google.firebase:firebase-appcheck-debug:20.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // ReceiptCheckTest: plain JVM tests. The real org.json replaces the Android stub there.
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20180813")
}
