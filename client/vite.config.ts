import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production build config — no dev server, no proxies, no SSL plugin.
// Nginx handles all routing in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: true,
    hmr: {
      // HMR connects back through the same host the page was loaded from
      clientPort: 443,
      protocol: 'wss',
    },
  },
  build: {
    // Phase 9 (bundle split) — strip the libp2p chunk from every
    // `<link rel="modulepreload">` Vite would otherwise emit.
    //
    // Vite's default `modulePreload` behavior preloads ALL chunks
    // the entry HTML transitively depends on, INCLUDING dynamically
    // imported ones. That's a performance optimization for the
    // common case (you want async chunks warm when the user
    // navigates into them), but it directly defeats the cold-start
    // saving we're after — a preload link fetches the bytes at
    // initial-page load, even if execution is deferred.
    //
    // We keep modulePreload enabled (so the main + vendor chunks
    // get the warm-cache benefit) and use `resolveDependencies` to
    // filter the libp2p chunk out of every emitted preload list.
    // The lazy `import("./node")` still triggers the fetch on
    // demand the first time `ensureBrowserNode` runs — that's the
    // whole point of the lazy seam.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((dep) => !/(?:^|\/)libp2p-[^/]+\.js$/.test(dep)),
    },
    rollupOptions: {
      output: {
        // Phase 9 (bundle split) — pin the heavy libp2p tree to a
        // single named chunk so it's identifiable in `dist/assets/`
        // and the cold-start bundle drops the ~700 KB raw / ~220 KB
        // gzipped libp2p delta. The lazy loader lives at
        // `client/src/libp2p/lazyNode.ts` — it's intentionally
        // small + dependency-free so it can stay in the main chunk
        // and only the dynamic `import("./node")` triggers a fetch
        // of the heavy chunk. Same posture for `bootstrap.ts`: it's
        // a static-data file with no libp2p imports and belongs in
        // the main chunk so `useBrowserLibp2p` can read it without
        // triggering a chunk fetch.
        //
        // Inclusion rules:
        //   - `src/libp2p/node.ts`, `identity.ts`, `federation.ts`
        //     and anything under `node_modules/{@libp2p/*,libp2p,
        //     @chainsafe/libp2p-*,@multiformats/multiaddr}` go to
        //     the libp2p chunk.
        //   - `src/libp2p/lazyNode.ts` and `src/libp2p/bootstrap.ts`
        //     stay in main so the lazy import boundary is
        //     respected.
        manualChunks(id: string): string | undefined {
          // Heavy stack modules from the source tree. Listing the
          // specific entry filenames avoids accidentally pulling in
          // `lazyNode.ts` / `bootstrap.ts` (which would re-create
          // the static-dep edge that defeats the lazy split).
          if (
            id.includes('/src/libp2p/node.') ||
            id.includes('/src/libp2p/identity.') ||
            id.includes('/src/libp2p/federation.')
          ) {
            return 'libp2p'
          }
          // Vendor packages — every libp2p protocol implementation,
          // the libp2p core, and the multiaddr parser only the
          // libp2p stack uses.
          if (
            id.includes('node_modules/@libp2p/') ||
            id.includes('node_modules/@chainsafe/libp2p-') ||
            id.includes('node_modules/@multiformats/multiaddr') ||
            /node_modules\/libp2p\//.test(id)
          ) {
            return 'libp2p'
          }
          // Phase 10 (bundle split) — pin the LiveKit voice stack to its
          // own named chunk. `livekit-client` + `@livekit/components-*`
          // are only exercised once a user joins voice; the lazy
          // `<VoiceRoomProvider/>` boundary in `App.tsx` defers the
          // `@livekit/components-react` consumer tree behind a dynamic
          // import, so this chunk is fetched on first voice join rather
          // than at cold start.
          if (
            id.includes('node_modules/@livekit/') ||
            /node_modules\/livekit-client\//.test(id)
          ) {
            return 'livekit'
          }
          // Phase 10 — matrix-js-sdk is statically imported across the
          // chat hooks/stores (it is the core protocol client, not a
          // rarely-needed surface), so it can't be lazy. But pinning it
          // to its own vendor chunk strips ~hundreds of KB out of the
          // main entry chunk, shrinking the cold-start parse/eval cost.
          // The matrix-crypto wasm is already its own on-demand `.wasm`
          // asset loaded by the SDK; this only buckets the JS.
          if (/node_modules\/matrix-js-sdk\//.test(id)) {
            return 'matrix'
          }
          // Phase 10 — consolidate the entire `@tauri-apps/*` surface
          // (api/core + window/event/image/dpi + plugin-dialog) into a
          // single chunk. The app mixes static (`import { invoke }`) and
          // dynamic (`await import("@tauri-apps/api/core")`) usage of
          // `core`; left unbucketed, Rollup warns the dynamic import
          // "will not move module into another chunk" and keeps core in
          // main. Forcing one `tauri` chunk makes both import styles
          // resolve to the same chunk, clearing the mixed-import warning
          // and pulling the Tauri runtime out of the web cold-start path.
          if (id.includes('node_modules/@tauri-apps/')) {
            return 'tauri'
          }
          return undefined
        },
      },
    },
  },
})
