// Finance Sankey v2 data layer. EVERY Firebase call lives in this file, so the rest of
// the page (and the headless tests, which use a fake with the same interface) never
// touches the SDK directly. Loaded by index.html as an ES module; skipped in fake mode.
//
// Interface (also published as window.FS2Data):
//   signIn(), signOut(), onUser(cb)
//   loadMonths(sinceMs) -> [{month:"YYYY-MM", tx:{id:Tx}, updatedAt:ms, source}]
//   writeMonths({ "YYYY-MM": {tx, source}, ... })   full overwrite per month, batched
//   loadPlan() -> plan|null, savePlan(plan)
//   getSettings() -> {}|settings, setSettings(partial)   (merge)
//   checkAccess() -> "ok" | "locked" | "error: ..."
//
// Data model (see finance-v2-plan/PLAN.md section 4.1):
//   users/{uid}/months/{YYYY-MM}  { txj:"<JSON of {id:Tx}>", n, updatedAt, source }  (old form: tx:{id:Tx})
//   users/{uid}/meta/settings     { cutover, lists, lookups, lastImportAt, importHash }
//   users/{uid}/plan/current      { v:1, rows:[...], updatedAt }

// One pinned SDK version, in one place (checked 24 Oct 2026: 13.1.0 is current).
const SDK = "https://www.gstatic.com/firebasejs/13.1.0";

const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut: fbSignOut
} = await import(`${SDK}/firebase-auth.js`);
const {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, getDocsFromCache, setDoc, query, where, writeBatch,
  serverTimestamp, Timestamp
} = await import(`${SDK}/firebase-firestore.js`);
const { firebaseConfig } = await import("./firebase-config.js");

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Persistent offline cache shared across tabs: warm opens read from disk, and only
// months changed since the last visit come over the network (phase 3).
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

let user = null;
const uidOrThrow = () => { if (!user) throw new Error("not signed in"); return user.uid; };
const monthsCol = () => collection(db, "users", uidOrThrow(), "months");
const settingsRef = () => doc(db, "users", uidOrThrow(), "meta", "settings");
const planRef = () => doc(db, "users", uidOrThrow(), "plan", "current");

// ---- auth -------------------------------------------------------------------------
// Popup first (works on desktop and in mobile Safari tabs). If the browser refuses
// popups (some home-screen apps do), fall back to a full-page redirect.
export async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    const code = err && err.code || "";
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, provider);
    }
    throw err;
  }
}
export function signOut() { return fbSignOut(auth); }
export function onUser(cb) { return onAuthStateChanged(auth, cb); }

// ---- months -------------------------------------------------------------------------
const monthOf = d => {
  const x = d.data();
  let tx = x.tx || {};
  if (typeof x.txj === "string") { try { tx = JSON.parse(x.txj); } catch (e) { tx = {}; } }
  return { month: d.id, tx, source: x.source || "",
           updatedAt: x.updatedAt && x.updatedAt.toMillis ? x.updatedAt.toMillis() : 0 };
};
// Months already in the offline cache (no network, no billed reads).
export async function loadCachedMonths() {
  try { return (await getDocsFromCache(monthsCol())).docs.map(monthOf); }
  catch (e) { return []; }
}
// From the server: every month (sinceMs = 0) or only months changed after sinceMs.
export async function loadMonths(sinceMs) {
  const q = sinceMs
    ? query(monthsCol(), where("updatedAt", ">", Timestamp.fromMillis(sinceMs)))
    : monthsCol();
  const snap = await getDocs(q);
  return snap.docs.map(monthOf);
}

// Full overwrite of each given month (deleted rows disappear). The rows are stored as
// ONE JSON string (txj), not a map: Firestore indexes every field of a map, so ~16
// fields x ~12,300 rows made even an 800-row batch fail with INVALID_ARGUMENT
// "Transaction too big". A string is a single index entry. Reads accept the old
// map form (tx) too. Batches stay small anyway (500-doc cap, 10 MiB request cap).
const BATCH_MAX_DOCS = 450, BATCH_MAX_ROWS = 3000;
export async function writeMonths(map) {
  const ids = Object.keys(map);
  for (const id of ids) if (!/^\d{4}-\d{2}$/.test(id)) throw new Error("bad month id " + id);
  let b = writeBatch(db), docs = 0, rows = 0;
  for (const id of ids) {
    const m = map[id], tx = m.tx || {}, n = Object.keys(tx).length;
    if (docs && (docs >= BATCH_MAX_DOCS || rows + n > BATCH_MAX_ROWS)) {
      await b.commit();
      b = writeBatch(db); docs = 0; rows = 0;
    }
    b.set(doc(monthsCol(), id), { txj: JSON.stringify(tx), n, source: m.source || "app", updatedAt: serverTimestamp() });
    docs++; rows += n;
  }
  if (docs) await b.commit();
  return ids.length;
}

// ---- plan ---------------------------------------------------------------------------
export async function loadPlan() {
  const s = await getDoc(planRef());
  if (!s.exists()) return null;
  const { updatedAt, ...plan } = s.data();
  return plan;
}
export function savePlan(plan) {
  return setDoc(planRef(), { ...plan, updatedAt: serverTimestamp() });
}

// ---- settings -----------------------------------------------------------------------
export async function getSettings() {
  const s = await getDoc(settingsRef());
  return s.exists() ? s.data() : {};
}
export function setSettings(partial) {
  return setDoc(settingsRef(), partial, { merge: true });
}

// Can this account read its own data? "locked" = the security rules do not let it in
// yet (rules not published with this uid, or a different Google account).
export async function checkAccess() {
  try { await getDoc(settingsRef()); return "ok"; }
  catch (err) {
    if (err && err.code === "permission-denied") return "locked";
    return "error: " + (err && (err.code || err.message) || err);
  }
}

const api = { signIn, signOut, onUser, loadMonths, loadCachedMonths, writeMonths, loadPlan, savePlan,
              getSettings, setSettings, checkAccess };
window.FS2Data = api;

// ---- sign-in gate (UI) ----------------------------------------------------------------
export function initGate() {
  const $ = id => document.getElementById(id);
  const gate = $("gate"), msg = $("gateMsg"), btn = $("gateBtn"), err = $("gateErr");
  window.FS2.data = api;

  // Finish a redirect sign-in if one is coming back (no-op otherwise).
  getRedirectResult(auth).catch(e => { err.textContent = friendly(e); });

  btn.addEventListener("click", async () => {
    err.textContent = ""; btn.disabled = true;
    try { await signIn(); }
    catch (e) { err.textContent = friendly(e); }
    finally { btn.disabled = false; }
  });
  $("acctOut").addEventListener("click", async () => { await signOut(); location.reload(); });
  $("acctCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(user ? user.uid : ""); $("acctCopy").textContent = "Copied"; }
    catch (e) { $("acctCopy").textContent = "Select it"; }
  });

  let first = true;
  onUser(async u => {
    user = u;
    if (!u) {
      if (!first) { location.reload(); return; }   // signed out in another tab
      gate.hidden = false; btn.hidden = false;
      msg.textContent = "Sign in with your Google account to see your data.";
      btn.focus();
      first = false;
      return;
    }
    first = false;
    gate.hidden = true;
    $("acct").hidden = false;
    $("acctEmail").textContent = u.email || "";
    $("acctUid").textContent = u.uid;
    window.FS2.start();
    const a = await checkAccess();
    const tag = document.createElement("span");
    tag.textContent = a === "ok" ? "Database: OK" : a === "locked" ? "Database: locked (rules not set for this uid)" : "Database: " + a;
    tag.style.color = a === "ok" ? "var(--income)" : "#ff9a9a";
    $("acct").appendChild(tag);
  });
}

function friendly(e) {
  const c = e && e.code || "";
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "Sign-in window closed. Try again.";
  if (c === "auth/unauthorized-domain") return "This site is not on the Firebase authorized domains list.";
  if (c === "auth/network-request-failed") return "No connection. Check the network and try again.";
  return "Sign-in failed: " + (c || (e && e.message) || e);
}
