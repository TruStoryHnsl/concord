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
      // Drop every cache this SW ever created. Remember whether any
      // existed — a non-empty set means we just replaced a *caching* SW
      // that was serving a stale app shell to the open page.
      const keys = await caches.keys();
      const replacedCachingSw = keys.length > 0;
      await Promise.all(keys.map((k) => caches.delete(k)));
      // Take control of open pages so the next navigation is handled
      // by this SW (or rather, by its unregistration).
      await self.clients.claim();
      // Unregister ourselves. Subsequent requests go straight to the
      // network without SW mediation.
      await self.registration.unregister();
      // If we just evicted a caching SW, the page on screen is still the
      // stale cached shell — reload controlled windows ONCE so they pick
      // up fresh network code. We only do this when caches actually
      // existed: a clean install (this pass-through SW already present,
      // no caches) skips the reload, so there is no splash flash on
      // normal loads. Stuck-on-stale users auto-recover instead of
      // needing a manual second refresh.
      if (replacedCachingSw) {
        const windows = await self.clients.matchAll({ type: "window" });
        for (const client of windows) {
          if ("navigate" in client) client.navigate(client.url);
        }
      }
    })(),
  );
});

// Pass-through fetch — don't inject any caching layer on the way out.
self.addEventListener("fetch", () => {});
