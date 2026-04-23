// Self-unregistering service worker.
//
// We previously registered a pass-through SW to qualify the site for
// Chrome's "Add to Home Screen" prompt. In practice it caused more
// support pain than it was worth: once a browser has an SW registered,
// the client update path depends on both the page AND the SW refreshing,
// and users got stuck on stale shells when vite re-bundles during
// iteration. Until we actually need offline support, any SW that the
// browser still has installed should clear itself out on the next visit.
//
// This file is kept instead of deleted because `main.tsx` calls
// `navigator.serviceWorker.register("/sw.js")` — returning 404 there
// leaves a registered-but-missing SW in a broken state. A 200 response
// that immediately unregisters is the clean self-heal.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache this SW ever created.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // Take control of open pages so the next navigation is handled
      // by this SW (or rather, by its unregistration).
      await self.clients.claim();
      // Unregister ourselves. Subsequent requests go straight to the
      // network without SW mediation.
      await self.registration.unregister();
      // Deliberately DO NOT reload clients. Reloading here caused a
      // visible splash flash on every page load that still had this
      // SW registered: HTML paints → activate fires → reload → HTML
      // paints again. Caches are already cleared above and we've
      // unregistered, so the next navigation hits the network cleanly.
    })(),
  );
});

// Pass-through fetch — don't inject any caching layer on the way out.
self.addEventListener("fetch", () => {});
