// Gradle 8.8 is reused from the local cache. Android Gradle plugin 8.5.2 is the oldest that Kotlin
// Kotlin 2.4 accepts; Kotlin 2.4 is required because the on-device add-on pulls ML Kit
// libraries compiled with it.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
}
