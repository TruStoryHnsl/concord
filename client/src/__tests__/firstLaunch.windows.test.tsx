/**
 * Windows native first-launch flow — INS-058 hollow-shell contract.
 *
 * This test asserts the post-INS-058 design (per
 * `feedback_ux_hollow_webui_spec.md`, 2026-04-10): every native build
 * (Windows, macOS, Linux, iOS, Android, Apple TV, Google TV) renders
 * the FULL hollow Concord shell on first launch — Sources + Servers
 * + Channels + Chat columns all rendered, columns empty, with the
 * SourcesPanel `+` tile as the universal entry point for adding a
 * Concord/Matrix instance. NO modal/gate screen.
 *
 * What this test verifies:
 *
 *   1. Tauri v2 webview starts.
 *   2. `window.__TAURI_INTERNALS__` is present (the canonical v2
 *      detection key — NOT v1 `__TAURI__`; see
 *      `noLegacyTauriGlobal.test.ts` for the regression guard).
 *   3. `tauri-plugin-store` has no persisted serverConfig under
 *      `%APPDATA%\com.concord.chat\<store>` because the install is
 *      fresh.
 *   4. `localStorage` is empty.
 *
 * Under those conditions, `App` MUST render `ChatLayout` as the
 * first interactive surface — NOT `ServerPickerScreen` (gating
 * modal removed by INS-058), NOT `LoginForm` (login happens AFTER
 * the user picks a source via the `+` tile), NOT `DockerFirstBootScreen`
 * (web/Docker path only).
 *
 * The `+`-tile-visible coverage lives in the SourcesPanel component
 * tests (since this test mocks ChatLayout to a sentinel and can't
 * peek inside).
 *
 * Test mechanics:
 *
 *   - We stub `window.__TAURI_INTERNALS__ = {}` so every isTauri
 *     guard in the client (`isTauriRuntime` in serverConfig.ts,
 *     `isTauri` in usePlatform.ts, `isDesktopMode`/`hasServerUrl` in
 *     api/serverUrl.ts) reports true.
 *   - We DO NOT stub `__TAURI__` (the v1 key) — that's the bug we're
 *     guarding against. The `noLegacyTauriGlobal` test verifies no
 *     production code reads it; this test verifies that running with
 *     ONLY `__TAURI_INTERNALS__` (the real v2 layout) takes the
 *     correct branch.
 *   - We `localStorage.clear()` so persisted serverConfig is empty.
 *   - We mock the heaviest of App.tsx's deps to keep the render fast
 *     and free of network I/O. Specifically the Matrix/auth restore
 *     and the LiveKit room — neither participates in the first-launch
 *     decision being asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ──────────────────────────────────────────────────────────────────────
// Module mocks. Hoisted by vitest's `vi.mock()` mechanic — they have to
// be at top of file *before* App imports happen.
// ──────────────────────────────────────────────────────────────────────

// LiveKit — App renders <LiveKitRoom> only when voice is connected. On
// a fresh first-launch path it never gets there, but the import chain
// pulls in heavy WebRTC code. Stub it.
vi.mock("@livekit/components-react", () => ({
  LiveKitRoom: ({ children }: { children?: React.ReactNode }) =>
    children ?? null,
}));

// Boot splash uses raf timers + a long animation. Replace with a no-op
// so the test doesn't have to advance timers to dismiss it.
vi.mock("../bootSplash", () => ({ showBootSplash: () => {} }));

vi.mock("../components/LaunchAnimation", () => ({
  LaunchAnimation: ({ onDone }: { onDone: () => void }) => {
    // Fire onDone synchronously to dismiss the launch overlay. The
    // overlay sits on top of everything; if we leave it mounted, the
    // ServerPickerScreen technically *is* in the tree but the splash
    // covers it on screen, which is misleading for a behavioral test.
    setTimeout(onDone, 0);
    return null;
  },
}));

vi.mock("../components/MarkReady", () => ({
  MarkReady: () => null,
}));

// Auth restore reaches into Matrix-JS-SDK on real boots. We stub the
// store so `restoreSession()` is a noop and `isLoading` flips false
// immediately, putting the App into the "checked auth, no session"
// state where the picker decision happens.
vi.mock("../stores/auth", () => {
  const fakeState = {
    isLoggedIn: false,
    isLoading: false,
    accessToken: null,
    userId: null,
    client: null,
    restoreSession: vi.fn(),
  };
  type AuthState = typeof fakeState;
  type Selector<T> = (s: AuthState) => T;
  const useAuthStore = ((selector?: Selector<unknown>) =>
    selector ? selector(fakeState) : fakeState) as unknown as {
    (selector?: Selector<unknown>): unknown;
    getState: () => AuthState;
  };
  useAuthStore.getState = () => fakeState;
  return { useAuthStore };
});

// Server store — empty on first launch. The actions just need to be
// callable, never invoked on the first-launch path.
vi.mock("../stores/server", () => {
  const fakeState = {
    servers: [],
    activeServerId: null,
    setActiveServer: vi.fn(),
    setActiveChannel: vi.fn(),
    loadServers: vi.fn(),
    leaveOrphanRooms: vi.fn(),
  };
  type ServerState = typeof fakeState;
  type Selector<T> = (s: ServerState) => T;
  const useServerStore = ((selector?: Selector<unknown>) =>
    selector ? selector(fakeState) : fakeState) as unknown as {
    (selector?: Selector<unknown>): unknown;
    getState: () => ServerState;
  };
  useServerStore.getState = () => fakeState;
  return { useServerStore };
});

vi.mock("../api/concord", () => ({
  // First-launch on a Tauri build never invokes this — App.tsx
  // short-circuits the Docker first-boot branch when isTauri. We
  // stub it to a never-resolving promise so any leak is visible
  // (test would hang) rather than silently passing through.
  getInstanceInfo: () =>
    new Promise(() => {
      /* never resolves */
    }),
  redeemInvite: vi.fn(),
}));

vi.mock("../api/livekit", () => ({
  getVoiceToken: vi.fn(),
}));

// ServerPickerScreen has its own well-known + login form deps. We
// replace the whole component with a sentinel so this test focuses on
// *which screen App chose to render*, not the picker's internals.
vi.mock("../components/auth/ServerPickerScreen", () => ({
  ServerPickerScreen: ({ onConnected }: { onConnected?: () => void }) => (
    <div data-testid="server-picker-screen" data-has-onconnected={String(!!onConnected)}>
      ServerPickerScreen sentinel
    </div>
  ),
}));

// LoginForm should NOT render on first launch. If it ever does, we
// want the test to see it explicitly.
vi.mock("../components/auth/LoginForm", () => ({
  LoginForm: () => <div data-testid="login-form">LoginForm sentinel</div>,
}));

// ChatLayout should NOT render on first launch on Tauri. Same idea.
vi.mock("../components/layout/ChatLayout", () => ({
  ChatLayout: () => <div data-testid="chat-layout">ChatLayout sentinel</div>,
}));

vi.mock("../components/voice/VoiceConnectionBar", () => ({
  VoiceConnectionBar: () => null,
}));

vi.mock("../components/DirectInviteBanner", () => ({
  DirectInviteBanner: () => null,
}));

vi.mock("../components/voice/CustomAudioRenderer", () => ({
  CustomAudioRenderer: () => null,
}));

vi.mock("../components/voice/FloatingVideoTiles", () => ({
  FloatingVideoTiles: () => null,
}));

vi.mock("../components/auth/DockerFirstBootScreen", () => ({
  DockerFirstBootScreen: () => (
    <div data-testid="docker-first-boot">DockerFirstBootScreen sentinel</div>
  ),
}));

// ──────────────────────────────────────────────────────────────────────
// Test
// ──────────────────────────────────────────────────────────────────────

describe("first-launch (Windows native): __TAURI_INTERNALS__ + empty serverConfig", () => {
  beforeEach(() => {
    // Simulate a Tauri v2 webview environment. The KEY thing this
    // test guards is the v2-correct global, NOT the v1 `__TAURI__`.
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      writable: true,
      configurable: true,
    });
    // Wipe any persisted serverConfig from prior test runs in the
    // same vitest worker.
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it("renders ChatLayout (hollow shell) as the first interactive surface", async () => {
    const { default: App } = await import("../App");

    render(<App />);

    // Wait one microtask for the LaunchAnimation onDone to fire and
    // unmount the splash overlay.
    await new Promise((r) => setTimeout(r, 5));

    // Critical: ChatLayout — the hollow shell — must be the rendered
    // first screen. The `+` tile inside SourcesPanel is the entry
    // point for adding a Concord/Matrix source; no modal/gate.
    expect(screen.getByTestId("chat-layout")).toBeTruthy();

    // Negative space — none of these should render on first launch
    // for a Tauri build with no persisted server. Under INS-058, the
    // ServerPickerScreen + LoginForm flows live BEHIND the `+` tile
    // inside SourcesPanel, not as pre-shell gates.
    expect(screen.queryByTestId("server-picker-screen")).toBeNull();
    expect(screen.queryByTestId("login-form")).toBeNull();
    expect(screen.queryByTestId("docker-first-boot")).toBeNull();
  });
});
