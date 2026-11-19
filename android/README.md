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
- **What you see is what you sign.** Mei Lin signs the receipt's digest, so the screen is
  built from the receipt alone. Before showing a request, the app recomputes the digest exactly
  as the web app does (SHA-256 over canonical JSON, as JavaScript writes it), checks the
  signature with the public key the run recorded in the audit log, and checks that Edge Guard
  escalated the call. If any check fails it shows why, and offers no Approve button and no
  explanation. The tool, arguments and reason the console also writes beside the receipt are
  never shown: anyone who can write a request could make them say anything. The explainer
  decides whether a call may go to the cloud from the receipt's data class too.
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

## Tests

```bash
./gradlew :app:testDebugUnitTest
```

`ReceiptCheckTest` checks the phone's receipt verification against receipts made by the
TypeScript code, in `app/src/test/resources/receipt-vectors.json`: genuine escalations,
awkward values (integer-like keys, which JavaScript writes first; numbers like `1e+21`;
escapes and lone surrogates), and refusals (arguments changed after signing, another key, a
call that was not escalated, a missing run). `src/ops/receiptVectors.test.ts` holds the same
file to the TypeScript side. Regenerate it after changing receipts or signing:
`npx vite-node scripts/write-receipt-vectors.ts`.

The APK is `app/build/outputs/apk/debug/app-debug.apk`. Install it on a phone (Android 8
or later) by copying it over, or with `adb install`.

## Limits

- Without user sign-in, registering a key is open; pairing in the console is what makes
  a phone trusted, and trust is kept per browser.
- The app only sees requests while it is open. Notifications would need Cloud Messaging
  and a server to send them.
- Hybrid inference on Android is a public preview (`@OptIn(PublicPreviewAPI::class)`).
