import { initializeApp, type FirebaseApp } from "firebase/app";
import { CustomProvider, initializeAppCheck } from "firebase/app-check";

/**
 * Firebase for the extension. Same project as the web app, different App Check setup:
 * reCAPTCHA cannot run in an extension (it has no web origin of its own), so the cloud
 * path uses an App Check debug token, which the hackathon accepts for submissions.
 *
 * The token comes from VITE_EXTENSION_APPCHECK_DEBUG_TOKEN at build time and is therefore
 * inside the built extension. Anyone with the build can read it: share builds only with
 * judges, and revoke the token when judging ends. Without a token the extension still
 * works on the device; anything only the cloud could have checked goes to the person.
 *
 * The build routes the web app's `src/firebase` import here (see vite.extension.config.ts),
 * so the assessor code is shared unchanged.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let firebaseApp: FirebaseApp | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) return firebaseApp;
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) throw new Error(`Firebase is not configured. Missing: ${missing.join(", ")}`);

  const token = import.meta.env.VITE_EXTENSION_APPCHECK_DEBUG_TOKEN;
  if (token) self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;

  firebaseApp = initializeApp(firebaseConfig);
  // With a debug token, App Check exchanges it and never asks this provider. Without one,
  // the provider refuses, so cloud requests fail and the guard falls back to the person.
  initializeAppCheck(firebaseApp, {
    provider: new CustomProvider({
      getToken: () => Promise.reject(new Error("No App Check token: the cloud is not available to this build.")),
    }),
    isTokenAutoRefreshEnabled: false,
  });
  return firebaseApp;
}

declare global {
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}
