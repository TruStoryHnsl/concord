import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/*
 * Node 22+ exposes a built-in `window.localStorage` proxy gated on the
 * `--localstorage-file` CLI flag. When the flag is present without a
 * path (which is what `node` is shipped with on some versions) jsdom
 * leaves that proxy in place instead of installing its own Storage
 * implementation, and the proxy's `setItem` / `clear` are undefined.
 * Every store file that calls zustand's `persist` middleware then
 * crashes the test suite with `storage.setItem is not a function`.
 *
 * Detect that degraded state and install a minimal in-memory Storage
 * polyfill so the persist middleware has working read/write. The
 * polyfill is a plain Map wrapper — it mimics enough of the
 * Web Storage API (getItem, setItem, removeItem, clear, length, key)
 * for zustand's JSON storage wrapper and the handful of localStorage
 * call sites in the client codebase.
 */
(() => {
  if (typeof window === "undefined") return;
  const needsPolyfill =
    !window.localStorage ||
    typeof window.localStorage.setItem !== "function" ||
    typeof window.localStorage.clear !== "function";
  if (!needsPolyfill) return;

  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    get length(): number {
      return this.store.size;
    }
    clear(): void {
      this.store.clear();
    }
    getItem(key: string): string | null {
      return this.store.has(key) ? (this.store.get(key) as string) : null;
    }
    key(index: number): string | null {
      return Array.from(this.store.keys())[index] ?? null;
    }
    removeItem(key: string): void {
      this.store.delete(key);
    }
    setItem(key: string, value: string): void {
      this.store.set(key, String(value));
    }
  }

  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
})();

// Testing-library's automatic cleanup is disabled when `globals: true`
// doesn't inject an `afterEach`, so do it explicitly here.
afterEach(() => {
  cleanup();
});
