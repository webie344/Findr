# Keepr — setup guide

A vanilla JS SPA: snap a photo of something + pin its location, ask people to
share where *they* left your stuff (consent-based, one-time), and get nudged
if you walk away from a spot without the item.

It's also a installable PWA — Chrome (desktop and Android) shows an "Install"
prompt, and it works offline for its own UI.

Files:
- `index.html` — markup for onboarding, auth, main app, and the public share page
- `style.css` — all styling and animations
- `app.js` — Firebase Auth + Firestore logic, Cloudinary upload, geolocation, routing, PWA install handling
- `manifest.json` — PWA metadata (name, icons, colors, display mode)
- `sw.js` — service worker: caches the app shell for offline/instant loads
- `icons/` — generated app icons (192, 512, maskable, Apple touch icon)

## 1. Firebase setup

1. Go to the [Firebase console](https://console.firebase.google.com) → create a project.
2. **Authentication** → Sign-in method → enable **Email/Password** and **Google**.
3. **Firestore Database** → create database (start in production mode).
4. Project settings → "Your apps" → add a **Web app** → copy the config object.
5. Paste it into `app.js` at the top, replacing the `firebaseConfig` placeholder.

### Firestore security rules

Go to Firestore → Rules and use something like this. It lets:
- owners manage only their own items
- anyone holding a `locationRequests` doc's ID read it and submit a location **once** (so an unauthenticated recipient can respond), but never read other people's requests by guessing, and never edit anything else about an item.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /items/{itemId} {
      allow read, update, delete: if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerId;
    }

    match /locationRequests/{requestId} {
      // Owner can create/read their own requests
      allow create: if request.auth != null && request.auth.uid == request.resource.data.ownerId;
      allow read: if true; // recipients need to open the link without logging in
      // Only allow a recipient to fill in location + flip status once, nothing else
      allow update: if resource.data.status == "pending"
                    && request.resource.data.status == "completed"
                    && request.resource.data.location != null
                    && request.resource.data.ownerId == resource.data.ownerId
                    && request.resource.data.itemId == resource.data.itemId;
    }
  }
}
```

This keeps the share link working for a logged-out recipient while stopping
anyone from reusing a link to pull location again or tampering with other
fields.

## 2. Cloudinary setup

1. Create a free account at [cloudinary.com](https://cloudinary.com).
2. Dashboard → copy your **Cloud name**.
3. Settings → Upload → **Upload presets** → Add upload preset → set **Signing
   mode** to **Unsigned** → save → copy the preset name.
4. Paste both into `app.js`:
   ```js
   const CLOUDINARY_CLOUD_NAME = "your_cloud_name";
   const CLOUDINARY_UPLOAD_PRESET = "your_unsigned_preset";
   ```

Unsigned presets are meant for this exact case (client-side uploads without
exposing your API secret). You can restrict them to an `items/` folder and a
max file size in the preset settings if you want tighter control.

## 3. Running it

This is a static SPA — no build step. Since it uses Firebase's ES module
imports, open it through a local server rather than `file://`:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then visit the printed URL.

## 4. Deploying

Any static host works — Vercel, Netlify, Firebase Hosting, GitHub Pages.
Just make sure the deployed URL is added to Firebase Auth → Settings →
**Authorized domains**, or Google sign-in will fail.

**The service worker (and therefore "Install" in Chrome) only activates over
HTTPS** — `localhost` is an exception for local testing, but any real domain
needs TLS. Vercel/Netlify/Firebase Hosting/GitHub Pages all give you HTTPS
automatically, so a normal deploy is fine.

## 5. Installing it as an app

Once deployed on HTTPS:

- **Chrome (desktop or Android):** Chrome fires its own install prompt
  automatically, and Keepr also shows an in-app "Install Keepr" banner/button
  (top of the Items screen, and in Profile) that triggers the same native
  prompt via `beforeinstallprompt`.
- **iOS Safari:** iOS doesn't support that install prompt at all — Keepr
  detects iOS and shows a plain-text hint on the Profile screen ("tap Share →
  Add to Home Screen") instead, which is the only way to install a PWA there.

If you change `index.html`, `style.css`, or `app.js` after people have
already installed the app, bump `CACHE_VERSION` in `sw.js` (e.g. `keepr-v2`)
so the service worker knows to drop its old cache and fetch the new files —
otherwise installed users may keep seeing a stale cached version for a while.

## How the location-sharing link works

1. On an item's detail page, tapping **"Ask someone to share where they left
   it"** creates a `locationRequests` document (`status: "pending"`) and
   builds a link: `yoursite.com/#/share/<requestId>`.
2. You send that link yourself (WhatsApp button included, or copy/paste it
   anywhere).
3. The recipient doesn't need an account. They see the item's name/photo and
   a plain explanation of what sharing does, then tap **"Share my
   location"** — their browser's own geolocation permission prompt appears.
4. Only after they tap and allow does their coordinate get written back,
   flipping the request to `completed`. The security rule above stops that
   same link from being reused to request a second location.
5. You see it update live on the item's page under "Pin requests."

## The "did you leave without it" reminder

This runs with `navigator.geolocation.watchPosition` while the app is open in
a browser tab — it is **not** a true background/OS-level geofence (web apps
can't reliably do that, especially on iOS). It's a best-effort nudge for
while you're actively using the app, not a guarantee. If you later want real
background alerts, that means wrapping this in a native shell (Capacitor,
React Native) and using the platform's native geofencing APIs.
