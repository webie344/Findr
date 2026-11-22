/* ===========================================================
   Keepr — app.js
   Vanilla JS SPA — Firebase Auth + Firestore, Cloudinary storage
   =========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup,
  sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, where, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* -----------------------------------------------------------
   1. CONFIG — replace with your own project's values
   ----------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyC9jF-ocy6HjsVzWVVlAyXW-4aIFgA79-A",
    authDomain: "crypto-6517d.firebaseapp.com",
    projectId: "crypto-6517d",
    storageBucket: "crypto-6517d.firebasestorage.app",
    messagingSenderId: "60263975159",
    appId: "1:60263975159:web:bd53dcaad86d6ed9592bf2"
};

// Cloudinary unsigned upload — create an "unsigned" upload preset in your
// Cloudinary dashboard (Settings → Upload → Upload presets → Add upload preset,
// set "Signing Mode" to "Unsigned") and paste its name + your cloud name below.
const CLOUDINARY_CLOUD_NAME = "ddtdqrh1b";
const CLOUDINARY_UPLOAD_PRESET = "profile-pictures";

/* -----------------------------------------------------------
   2. INIT
   ----------------------------------------------------------- */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

let currentUser = null;
let unsubItems = null;
let unsubShareRequestsByItem = {}; // itemId -> unsub fn
let itemsCache = [];
let activeItemId = null;
let watchPositionId = null;
let lastKnownPos = null;

/* -----------------------------------------------------------
   3. DOM HELPERS
   ----------------------------------------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function showLoader() { show($("#global-loader")); }
function hideLoader() { hide($("#global-loader")); }

let toastTimer = null;
function toast(msg, type = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show" + (type ? ` toast-${type}` : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts.seconds != null) return ts.seconds * 1000;
  return new Date(ts).getTime() || 0;
}

function timeAgo(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* -----------------------------------------------------------
   4. ROUTER (very small hash router)
   Routes:
     (no hash)               -> onboarding / auth / app
     #/share/:requestId       -> public share (recipient) page
   ----------------------------------------------------------- */
function getRoute() {
  const hash = window.location.hash || "";
  const m = hash.match(/^#\/share\/([a-zA-Z0-9_-]+)/);
  if (m) return { name: "share", requestId: m[1] };
  return { name: "home" };
}

window.addEventListener("hashchange", routeChanged);

function routeChanged() {
  const route = getRoute();
  if (route.name === "share") {
    renderAllScreensHidden();
    show($("#share-screen"));
    loadShareRequest(route.requestId);
  } else {
    hide($("#share-screen"));
    renderHomeFlow();
  }
}

function renderAllScreensHidden() {
  hide($("#onboarding-screen"));
  hide($("#auth-screen"));
  hide($("#app-screen"));
  hide($("#share-screen"));
}

function renderHomeFlow() {
  hide($("#share-screen"));
  if (currentUser) {
    hide($("#onboarding-screen"));
    hide($("#auth-screen"));
    show($("#app-screen"));
  } else if (localStorage.getItem("keepr_seen_onboarding")) {
    hide($("#onboarding-screen"));
    show($("#auth-screen"));
  } else {
    show($("#onboarding-screen"));
    hide($("#auth-screen"));
  }
}

/* =============================================================
   5. ONBOARDING
   ============================================================= */
let onboardingIndex = 0;
const SLIDE_COUNT = 3;

function goToSlide(i) {
  onboardingIndex = Math.max(0, Math.min(SLIDE_COUNT - 1, i));
  $("#onboarding-track").style.transform = `translateX(-${onboardingIndex * (100 / SLIDE_COUNT)}%)`;
  $$(".dot").forEach((d, idx) => d.classList.toggle("active", idx === onboardingIndex));
  const btn = $("#btn-onboarding-next");
  btn.querySelector("span").textContent = onboardingIndex === SLIDE_COUNT - 1 ? "Create your account" : "Next";
}

$("#btn-onboarding-next").addEventListener("click", () => {
  if (onboardingIndex === SLIDE_COUNT - 1) {
    completeOnboarding();
  } else {
    goToSlide(onboardingIndex + 1);
  }
});

$("#btn-skip-onboarding").addEventListener("click", completeOnboarding);

function completeOnboarding() {
  localStorage.setItem("keepr_seen_onboarding", "1");
  renderHomeFlow();
}

$$(".dot").forEach((dot) => {
  dot.addEventListener("click", () => goToSlide(Number(dot.dataset.dot)));
});

// basic swipe support
(function enableSwipe() {
  const track = $("#onboarding-track");
  let startX = 0, deltaX = 0, dragging = false;
  track.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX; dragging = true;
  }, { passive: true });
  track.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    deltaX = e.touches[0].clientX - startX;
  }, { passive: true });
  track.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    if (deltaX < -40) goToSlide(onboardingIndex + 1);
    else if (deltaX > 40) goToSlide(onboardingIndex - 1);
    deltaX = 0;
  });
})();

/* =============================================================
   6. AUTH
   ============================================================= */
const authTabIndicator = $("#auth-tab-indicator");

$$(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    $$(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const which = tab.dataset.authTab;
    authTabIndicator.style.transform = which === "signup" ? "translateX(100%)" : "translateX(0)";
    if (which === "signup") {
      show($("#form-signup")); hide($("#form-login"));
    } else {
      show($("#form-login")); hide($("#form-signup"));
    }
  });
});

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  showLoader();
  try {
    await signInWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
  } catch (err) {
    toast(friendlyAuthError(err), "error");
  } finally {
    hideLoader();
  }
});

$("#form-signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  showLoader();
  try {
    const cred = await createUserWithEmailAndPassword(auth, fd.get("email"), fd.get("password"));
    await updateProfile(cred.user, { displayName: fd.get("name") });
    await setDoc(doc(db, "users", cred.user.uid), {
      name: fd.get("name"),
      email: fd.get("email"),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    toast(friendlyAuthError(err), "error");
  } finally {
    hideLoader();
  }
});

$("#btn-google").addEventListener("click", async () => {
  showLoader();
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    const userRef = doc(db, "users", cred.user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        name: cred.user.displayName || "",
        email: cred.user.email || "",
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    toast(friendlyAuthError(err), "error");
  } finally {
    hideLoader();
  }
});

$("#btn-forgot").addEventListener("click", async () => {
  const email = $("#form-login input[name=email]").value.trim();
  if (!email) return toast("Enter your email above first", "error");
  try {
    await sendPasswordResetEmail(auth, email);
    toast("Password reset email sent", "success");
  } catch (err) {
    toast(friendlyAuthError(err), "error");
  }
});

$("#btn-signout").addEventListener("click", async () => {
  stopReminderWatch();
  await signOut(auth);
});

function friendlyAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That email doesn't look right.",
    "auth/user-not-found": "No account with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in was closed.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    await hydrateProfile(user);
    attachItemsListener();
    maybeStartReminderWatch();
  } else {
    detachItemsListener();
    stopReminderWatch();
  }
  if (getRoute().name !== "share") renderHomeFlow();
});

async function hydrateProfile(user) {
  const name = user.displayName || (user.email ? user.email.split("@")[0] : "You");
  const initial = name.trim().charAt(0).toUpperCase() || "K";
  $("#avatar-initial").textContent = initial;
  $("#profile-avatar").textContent = initial;
  $("#profile-name").textContent = name;
  $("#profile-email").textContent = user.email || "";
}

/* =============================================================
   7. BOTTOM NAV / VIEW SWITCHING
   ============================================================= */
function switchView(viewId) {
  $$(".view").forEach((v) => hide(v));
  show($("#" + viewId));
  $$(".nav-btn[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });
  $("#app-main")?.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

$$(".nav-btn[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

$("#btn-nav-add").addEventListener("click", () => {
  resetAddForm();
  switchView("view-add");
});

$("#btn-profile").addEventListener("click", () => {
  renderProfileStats();
  switchView("view-profile");
});

$$(".back-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchView(btn.dataset.back));
});

/* =============================================================
   8. ITEMS — Firestore CRUD + realtime list
   ============================================================= */
function itemsCol() {
  return collection(db, "items");
}

function attachItemsListener() {
  detachItemsListener();
  // Filtered by ownerId only (no orderBy) so this never needs a composite
  // index — we sort newest-first ourselves once the snapshot comes back.
  const q = query(itemsCol(), where("ownerId", "==", currentUser.uid));
  unsubItems = onSnapshot(q, (snap) => {
    itemsCache = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    renderItemsList(itemsCache);
    renderProfileStats();
  }, (err) => {
    console.error(err);
    toast("Couldn't load your items", "error");
  });
}

function detachItemsListener() {
  if (unsubItems) { unsubItems(); unsubItems = null; }
  Object.values(unsubShareRequestsByItem).forEach((fn) => fn && fn());
  unsubShareRequestsByItem = {};
  itemsCache = [];
}

function renderItemsList(items) {
  const listEl = $("#items-list");
  const emptyEl = $("#items-empty");
  const search = $("#input-search-items").value.trim().toLowerCase();
  const filtered = search
    ? items.filter((it) => (it.name || "").toLowerCase().includes(search))
    : items;

  $("#items-subtitle").textContent = items.length
    ? `${items.length} item${items.length === 1 ? "" : "s"} kept`
    : "Tap a card to see its spot";

  if (!filtered.length) {
    listEl.innerHTML = "";
    if (items.length === 0) show(emptyEl); else hide(emptyEl);
    return;
  }
  hide(emptyEl);

  listEl.innerHTML = filtered.map((it) => `
    <div class="item-card" data-item-id="${it.id}">
      ${it.photoUrl
        ? `<img class="item-thumb" src="${escapeHtml(it.photoUrl)}" alt="" />`
        : `<div class="item-thumb-fallback">📦</div>`}
      <div class="item-info">
        <strong>${escapeHtml(it.name)}</strong>
        <span class="item-meta">
          ${it.location ? "📍 " + timeAgo(it.updatedAt || it.createdAt) : "No location yet"}
        </span>
      </div>
      ${it.reminderEnabled ? '<span class="item-reminder-badge">🔔 Watching</span>' : ""}
      <span class="chev">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </div>
  `).join("");

  $$(".item-card", listEl).forEach((card) => {
    card.addEventListener("click", () => openItemDetail(card.dataset.itemId));
  });
}

$("#input-search-items").addEventListener("input", () => renderItemsList(itemsCache));

/* ---------- Add item ---------- */
let pendingPhotoFile = null;
let pendingLocation = null;

function resetAddForm() {
  $("#form-add-item").reset();
  pendingPhotoFile = null;
  pendingLocation = null;
  show($("#photo-placeholder"));
  hide($("#photo-preview-img"));
  $("#photo-preview-img").src = "";
  $("#location-capture-box").classList.remove("captured");
  $("#location-capture-title").textContent = "Pin this item's current location";
  $("#location-capture-sub").textContent = "We'll use your device's precise location";
  $("#btn-capture-location").textContent = "Use my location";
}

$("#photo-dropzone").addEventListener("click", () => $("#input-photo").click());

$("#input-photo").addEventListener("change", () => {
  const file = $("#input-photo").files[0];
  if (!file) return;
  pendingPhotoFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    $("#photo-preview-img").src = reader.result;
    hide($("#photo-placeholder"));
    show($("#photo-preview-img"));
  };
  reader.readAsDataURL(file);
});

$("#btn-capture-location").addEventListener("click", async () => {
  const btn = $("#btn-capture-location");
  btn.disabled = true;
  btn.textContent = "Locating…";
  try {
    const pos = await getPreciseLocation();
    pendingLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    $("#location-capture-box").classList.add("captured");
    $("#location-capture-title").textContent = "Location pinned ✓";
    $("#location-capture-sub").textContent =
      `Accurate to ~${Math.round(pos.coords.accuracy)}m`;
    btn.textContent = "Update location";
  } catch (err) {
    toast(geoErrorMessage(err), "error");
    btn.textContent = "Use my location";
  } finally {
    btn.disabled = false;
  }
});

function getPreciseLocation(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
      ...opts,
    });
  });
}

function geoErrorMessage(err) {
  if (err?.code === 1) return "Location permission denied. Enable it in your browser settings.";
  if (err?.code === 2) return "Couldn't determine your location.";
  if (err?.code === 3) return "Location request timed out. Try again.";
  return "Couldn't get your location.";
}

$("#form-add-item").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#input-item-name").value.trim();
  const note = $("#input-item-note").value.trim();
  const reminderEnabled = $("#input-item-reminder").checked;
  if (!name) return;

  const btn = $("#btn-save-item");
  btn.disabled = true;
  btn.textContent = "Saving…";
  showLoader();
  try {
    let photoUrl = "";
    if (pendingPhotoFile) {
      photoUrl = await uploadToCloudinary(pendingPhotoFile);
    }
    await addDoc(itemsCol(), {
      ownerId: currentUser.uid,
      name,
      note,
      photoUrl,
      location: pendingLocation || null,
      reminderEnabled: !!(reminderEnabled && pendingLocation),
      reminderRadiusMeters: 120,
      lastSeenInsideRadius: !!pendingLocation,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    toast("Item saved", "success");
    switchView("view-items");
  } catch (err) {
    console.error(err);
    toast("Couldn't save item. Check your Firebase/Cloudinary setup.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save item";
    hideLoader();
  }
});

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );
  if (!res.ok) throw new Error("Cloudinary upload failed");
  const data = await res.json();
  return data.secure_url;
}

/* ---------- Item detail ---------- */
function openItemDetail(itemId) {
  const item = itemsCache.find((i) => i.id === itemId);
  if (!item) return;
  activeItemId = itemId;

  $("#detail-item-name").textContent = item.name;
  $("#detail-note").textContent = item.note || "No notes added.";
  $("#detail-photo").src = item.photoUrl || "";
  $("#detail-photo").style.display = item.photoUrl ? "block" : "none";
  $("#detail-input-reminder").checked = !!item.reminderEnabled;

  if (item.location) {
    renderMap(item.location.lat, item.location.lng);
    $("#map-updated").textContent = "Updated " + timeAgo(item.updatedAt || item.createdAt);
  } else {
    $("#map-frame").src = "";
    $("#map-updated").textContent = "No location pinned yet";
  }

  listenShareRequestsForItem(itemId);
  switchView("view-item-detail");
}

function renderMap(lat, lng) {
  const d = 0.004;
  const bbox = `${lng - d},${lat - d},${lng + d},${lat + d}`;
  $("#map-frame").src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&marker=${lat},${lng}&layer=mapnik`;
  $("#map-open-link").href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

$("#detail-input-reminder").addEventListener("change", async (e) => {
  if (!activeItemId) return;
  const checked = e.target.checked;
  const item = itemsCache.find((i) => i.id === activeItemId);
  if (checked && !item?.location) {
    e.target.checked = false;
    return toast("This item needs a pinned location first", "error");
  }
  try {
    await updateDoc(doc(db, "items", activeItemId), {
      reminderEnabled: checked,
      lastSeenInsideRadius: true,
    });
    toast(checked ? "Reminder on for this spot" : "Reminder turned off");
  } catch (err) {
    toast("Couldn't update reminder", "error");
  }
});

$("#btn-delete-item").addEventListener("click", async () => {
  if (!activeItemId) return;
  if (!confirm("Delete this item? This can't be undone.")) return;
  showLoader();
  try {
    await deleteDoc(doc(db, "items", activeItemId));
    toast("Item deleted");
    switchView("view-items");
  } catch (err) {
    toast("Couldn't delete item", "error");
  } finally {
    hideLoader();
  }
});

/* =============================================================
   9. LOCATION-SHARE REQUESTS (owner side)
   ============================================================= */
function shareRequestsCol() {
  return collection(db, "locationRequests");
}

$("#btn-share-request").addEventListener("click", async () => {
  if (!activeItemId) return;
  const item = itemsCache.find((i) => i.id === activeItemId);
  if (!item) return;
  showLoader();
  try {
    const ref = await addDoc(shareRequestsCol(), {
      itemId: activeItemId,
      ownerId: currentUser.uid,
      requesterName: currentUser.displayName || "Someone",
      itemName: item.name,
      itemNote: item.note || "",
      itemPhoto: item.photoUrl || "",
      status: "pending",
      location: null,
      createdAt: serverTimestamp(),
      respondedAt: null,
    });
    const link = `${window.location.origin}${window.location.pathname}#/share/${ref.id}`;
    openShareLinkModal(link, item.name);
  } catch (err) {
    console.error(err);
    toast("Couldn't create share link", "error");
  } finally {
    hideLoader();
  }
});

function openShareLinkModal(link, itemName) {
  const overlay = $("#modal-overlay");
  const sheet = $("#modal-sheet");
  const message = encodeURIComponent(
    `Hey! Could you share your location so I know where you left my ${itemName}? ${link}`
  );
  sheet.innerHTML = `
    <div class="modal-handle"></div>
    <h3>Link ready</h3>
    <p class="muted small" style="margin-top:6px;">Send this so they can confirm and share where they left it.</p>
    <div class="modal-link-box">
      <input type="text" readonly value="${escapeHtml(link)}" id="modal-link-input" />
      <button id="modal-copy-btn">Copy</button>
    </div>
    <div class="modal-share-row">
      <a class="btn btn-primary" href="https://wa.me/?text=${message}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="btn btn-ghost" id="modal-close-btn">Close</button>
    </div>
  `;
  show(overlay);
  $("#modal-copy-btn").addEventListener("click", () => {
    $("#modal-link-input").select();
    navigator.clipboard?.writeText(link);
    toast("Link copied");
  });
  $("#modal-close-btn").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); }, { once: true });
}

function closeModal() {
  hide($("#modal-overlay"));
  $("#modal-sheet").innerHTML = "";
}

function listenShareRequestsForItem(itemId) {
  if (unsubShareRequestsByItem[itemId]) unsubShareRequestsByItem[itemId]();
  // Filtered by itemId only (no orderBy) — sorted client-side — so this
  // never needs a composite index either.
  const q = query(shareRequestsCol(), where("itemId", "==", itemId));
  unsubShareRequestsByItem[itemId] = onSnapshot(q, (snap) => {
    const requests = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
    renderShareRequests(requests);
  });
}

function renderShareRequests(requests) {
  const wrap = $("#share-requests-wrap");
  const list = $("#share-requests-list");
  if (!requests.length) { hide(wrap); return; }
  show(wrap);
  list.innerHTML = requests.map((r) => `
    <div class="share-request-item">
      <span class="share-request-status ${r.status}"></span>
      <span class="srq-text">
        ${r.status === "completed"
          ? "Location shared " + timeAgo(r.respondedAt)
          : "Waiting for a reply…"}
      </span>
      ${r.status === "completed" && r.location
        ? `<button class="srq-link" data-lat="${r.location.lat}" data-lng="${r.location.lng}">View pin</button>`
        : ""}
    </div>
  `).join("");

  $$(".srq-link", list).forEach((btn) => {
    btn.addEventListener("click", () => {
      renderMap(Number(btn.dataset.lat), Number(btn.dataset.lng));
      $("#map-updated").textContent = "From shared pin";
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* =============================================================
   10. SHARE (RECIPIENT) PAGE — public, unauthenticated
   ============================================================= */
let activeShareRequestId = null;

async function loadShareRequest(requestId) {
  activeShareRequestId = requestId;
  show($("#share-loading"));
  hide($("#share-content"));
  hide($("#share-done"));
  hide($("#share-error"));

  try {
    const ref = doc(db, "locationRequests", requestId);
    const snap = await getDoc(ref);
    hide($("#share-loading"));

    if (!snap.exists()) {
      show($("#share-error"));
      return;
    }
    const data = snap.data();

    if (data.status === "completed") {
      $("#share-done-text").textContent = "You already shared a pin for this request.";
      show($("#share-done"));
      return;
    }

    $("#share-requester-line").textContent = `${data.requesterName || "Someone"} wants to know where you left:`;
    $("#share-item-name").textContent = data.itemName || "an item";
    $("#share-item-note").textContent = data.itemNote || "";
    if (data.itemPhoto) {
      $("#share-item-photo").src = data.itemPhoto;
      show($("#share-item-photo"));
    } else {
      hide($("#share-item-photo"));
    }
    show($("#share-content"));
  } catch (err) {
    console.error(err);
    hide($("#share-loading"));
    $("#share-error-text").textContent = "Something went wrong loading this request.";
    show($("#share-error"));
  }
}

$("#btn-share-my-location").addEventListener("click", async () => {
  if (!activeShareRequestId) return;
  const btn = $("#btn-share-my-location");
  btn.disabled = true;
  btn.textContent = "Getting your location…";
  try {
    const pos = await getPreciseLocation();
    await updateDoc(doc(db, "locationRequests", activeShareRequestId), {
      status: "completed",
      location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
      respondedAt: serverTimestamp(),
    });
    hide($("#share-content"));
    show($("#share-done"));
  } catch (err) {
    toast(geoErrorMessage(err), "error");
    btn.disabled = false;
    btn.textContent = "Share my location";
  }
});

$("#btn-decline-share").addEventListener("click", () => {
  hide($("#share-content"));
  $("#share-done-text").textContent = "No worries — nothing was shared.";
  $("#share-done").querySelector("h2").textContent = "Okay!";
  $("#share-done").querySelector(".share-done-emoji").textContent = "👋";
  show($("#share-done"));
});

/* =============================================================
   11. "DID YOU FORGET IT" REMINDERS (best-effort, foreground)
   ============================================================= */
function maybeStartReminderWatch() {
  const watchedItems = () => itemsCache.filter((i) => i.reminderEnabled && i.location);
  if (!navigator.geolocation) return;
  stopReminderWatch();
  watchPositionId = navigator.geolocation.watchPosition(
    (pos) => {
      lastKnownPos = pos;
      checkGeofences(watchedItems());
    },
    (err) => console.warn("watchPosition error", err),
    { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
  );
}

function stopReminderWatch() {
  if (watchPositionId !== null) {
    navigator.geolocation.clearWatch(watchPositionId);
    watchPositionId = null;
  }
}

const notifiedRecently = new Set();

function checkGeofences(items) {
  if (!lastKnownPos) return;
  const { latitude, longitude } = lastKnownPos.coords;
  items.forEach((item) => {
    const dist = haversineMeters(latitude, longitude, item.location.lat, item.location.lng);
    const radius = item.reminderRadiusMeters || 120;
    const isInside = dist <= radius;
    const wasInside = item.lastSeenInsideRadius !== false;

    if (wasInside && !isInside && !notifiedRecently.has(item.id)) {
      notifiedRecently.add(item.id);
      setTimeout(() => notifiedRecently.delete(item.id), 10 * 60 * 1000);
      notifyLeftBehind(item);
      updateDoc(doc(db, "items", item.id), { lastSeenInsideRadius: false }).catch(() => {});
    } else if (!wasInside && isInside) {
      updateDoc(doc(db, "items", item.id), { lastSeenInsideRadius: true }).catch(() => {});
    }
  });
}

function notifyLeftBehind(item) {
  const text = `Did you take your ${item.name}? Looks like you're leaving its spot.`;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification("Keepr reminder", { body: text, icon: undefined, tag: "keepr-" + item.id });
  } else {
    toast(text);
  }
}

$("#btn-notif-permission").addEventListener("click", async () => {
  if (!("Notification" in window)) return toast("Notifications aren't supported in this browser", "error");
  const perm = await Notification.requestPermission();
  if (perm === "granted") toast("Reminders enabled", "success");
  else toast("Notifications weren't enabled", "error");
});

/* =============================================================
   12. PROFILE STATS
   ============================================================= */
async function renderProfileStats() {
  $("#stat-items-count").textContent = itemsCache.length;
  try {
    const q = query(shareRequestsCol(), where("ownerId", "==", currentUser?.uid || "__none__"), where("status", "==", "completed"));
    const snap = await getDocs(q);
    $("#stat-shared-count").textContent = snap.size;
  } catch {
    $("#stat-shared-count").textContent = "–";
  }
}

/* =============================================================
   13. PWA — install prompt + service worker
   ============================================================= */
let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true; // iOS Safari
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (!isStandalone() && !localStorage.getItem("keepr_install_dismissed")) {
    show($("#install-banner"));
  }
  show($("#btn-install-app"));
});

async function triggerInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  if (outcome === "accepted") toast("Installing Keepr…", "success");
  deferredInstallPrompt = null;
  hide($("#install-banner"));
  hide($("#btn-install-app"));
}

$("#btn-install-banner").addEventListener("click", triggerInstall);
$("#btn-install-app").addEventListener("click", triggerInstall);

$("#btn-dismiss-banner").addEventListener("click", () => {
  hide($("#install-banner"));
  localStorage.setItem("keepr_install_dismissed", "1");
});

window.addEventListener("appinstalled", () => {
  hide($("#install-banner"));
  hide($("#btn-install-app"));
  deferredInstallPrompt = null;
  toast("Keepr installed", "success");
});

// iOS Safari has no beforeinstallprompt — show a manual hint instead, but
// only once the person is actually in the app (not mid-onboarding/auth).
(function maybeShowIosHint() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (isIos && !isStandalone() && !localStorage.getItem("keepr_ios_hint_dismissed")) {
    show($("#ios-install-hint"));
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

/* =============================================================
   14. BOOT
   ============================================================= */
goToSlide(0);
routeChanged();
