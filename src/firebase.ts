import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let firebaseApp: FirebaseApp | undefined;

function requireEnvironment(): void {
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Firebase is not configured. Missing: ${missing.join(", ")}`);
  }

  if (!import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY) {
    throw new Error("App Check is not configured. Add VITE_RECAPTCHA_ENTERPRISE_SITE_KEY.");
  }
}

export function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) return firebaseApp;

  requireEnvironment();

  if (import.meta.env.DEV) {
    // Keep a token that was set before the app loaded (for example, by a test harness).
    self.FIREBASE_APPCHECK_DEBUG_TOKEN ??= true;
  }

  firebaseApp = initializeApp(firebaseConfig);
  initializeAppCheck(firebaseApp, {
    provider: new ReCaptchaEnterpriseProvider(
      import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
    ),
    isTokenAutoRefreshEnabled: true,
  });

  return firebaseApp;
}

declare global {
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

