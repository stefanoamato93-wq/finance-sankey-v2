// Firebase web config for Finance v2 (shared by finance-sankey-v2 and expense-tracker-v2).
// This is NOT a secret: Google designs it to sit in public web pages.
// Security comes from Google sign-in + the Firestore rules (owner uid only).
//
// Fill in from: Firebase console > Project settings > Your apps > Web app > SDK setup and configuration > Config.
export const firebaseConfig = {
  apiKey: "AIzaSyCvN8ZWVFYMhGmH0qXkSPrPgpCMGeorG2E",
  // same site as the apps: the sign-in helper is self-hosted on the root site (repo stefanoamato93-wq.github.io),
  // so phone browsers that split storage between sites can finish the redirect sign-in (25 Oct 2026)
  authDomain: "stefanoamato93-wq.github.io",
  projectId: "finance-stefano",
  storageBucket: "finance-stefano.firebasestorage.app",
  messagingSenderId: "803207911332",
  appId: "1:803207911332:web:8399e77f2eb3d09f65d331"
};
