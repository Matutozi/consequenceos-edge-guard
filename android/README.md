# Edge Guard Approver (Android)

Mei Lin's approver app. When Edge Guard escalates a call in the web console, the request
appears here. Mei Lin reads an explanation, then approves or rejects; her answer is
signed with a key in Android Keystore and the console checks that signature before the
executor runs anything.

- **Firebase AI Logic hybrid inference.** Explanations use `InferenceMode.PREFER_ON_DEVICE`
  (Gemini Nano on phones with AICore, Gemini in the cloud otherwise). A call on
  confidential or restricted data uses `ONLY_ON_DEVICE`: without Gemini Nano it gets a
  rule-based explanation and nothing is sent to the cloud. The screen says which path
  answered.
- **Keystore signing.** An ECDSA P-256 key is generated in Android Keystore on first
  launch and never leaves it. Signatures are converted from DER to the raw form the
  console verifies with WebCrypto.
- **Pairing.** The phone registers its public key in Firestore under its fingerprint and
  shows the fingerprint. The console trusts a phone only after someone compares the two.
- **No push service.** Requests arrive through a Firestore listener while the app is
  open, so no Cloud Functions or billing are needed.
- **App Check** uses the debug provider. The debug token is set at build time.

## Build

Requires JDK 17 and the Android SDK (platform 34). No Android Studio or emulator.

Create `android/local.properties` (not committed):

```properties
sdk.dir=/path/to/Android/sdk
firebase.apiKey=...        # from the Android app's google-services.json
firebase.appId=1:...:android:...
firebase.projectId=edge-guard-f1314
appcheck.debugToken=...    # a debug token registered for the Android app in App Check
```

Then:

```bash
./gradlew :app:assembleDebug
```

The APK is `app/build/outputs/apk/debug/app-debug.apk`. Install it on a phone (Android 8
or later) by copying it over, or with `adb install`.

## Limits

- Without user sign-in, registering a key is open; pairing in the console is what makes
  a phone trusted, and trust is kept per browser.
- The app only sees requests while it is open. Notifications would need Cloud Messaging
  and a server to send them.
- Hybrid inference on Android is a public preview (`@OptIn(PublicPreviewAPI::class)`).
