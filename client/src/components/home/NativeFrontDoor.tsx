/**
 * NativeFrontDoor — mounts the native personal-messenger Home as the default
 * entry surface, OVER the always-mounted ChatLayout (App keeps ChatLayout
 * alive underneath so voice/source/session state is never torn down).
 *
 * Surfaces (`useHomeFeedStore.surface`):
 *   - `home`        — the Home conversation list full-screen (phone) or
 *                     list + empty detail (desktop).
 *   - `native-chat` — the Home shell with the native messenger chat surface
 *                     in the detail pane (Cycle 2 / WS-C). Still an overlay
 *                     above ChatLayout.
 *   - `handoff`     — the front door steps aside to reveal the underlying
 *                     ChatLayout (docker source / local porch / add-source /
 *                     settings). A floating handoff chip situates the user
 *                     (back-to-Home + instance identity + SOURCE) per WS-D §9.
 *
 * Native-only: App gates this mount on `isTauri`. Web/docker never render it
 * and their entry path is untouched.
 *
 * The Home shell (HomeScreen) carries the persistent messenger navigation
 * (Chats / Peers tabs + Settings) — see `useHomeFeedStore.tab`.
 */

import { HomeScreen } from "./HomeScreen";
import { SourceBrandIcon, inferSourceBrand } from "../sources/sourceBrand";
import { useHomeFeedStore } from "../../stores/homeFeed";

function DockerHandoffChip() {
  const goHome = useHomeFeedStore((s) => s.goHome);
  const handoff = useHomeFeedStore((s) => s.dockerHandoff);

  const source = handoff?.source;
  const brand = source ? inferSourceBrand(source) : null;
  const accent = source?.branding?.accentColor ?? "var(--color-secondary)";

  return (
    <div className="safe-top fixed left-3 top-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full bg-surface-container-high/95 py-1.5 pl-1.5 pr-3 elev-md edge-hairline backdrop-blur">
      <button
        type="button"
        onClick={goHome}
        aria-label="Back to Home"
        title="Back to Home"
        className="btn-press flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-xl">arrow_back</span>
      </button>

      {source && brand ? (
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container"
          style={{
            boxShadow: `0 0 0 1.5px color-mix(in srgb, ${accent} 70%, transparent)`,
          }}
        >
          {source.branding?.logoUrl ? (
            <img
              src={source.branding.logoUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <SourceBrandIcon
              brand={brand}
              size={18}
              color={source.branding?.accentColor}
            />
          )}
        </span>
      ) : null}

      {handoff && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-label text-xs font-semibold text-on-surface">
            {handoff.title}
          </span>
          <span className="text-overline text-[9px] leading-none text-on-surface-variant/70">
            Source
          </span>
        </span>
      )}
    </div>
  );
}

export function NativeFrontDoor() {
  const surface = useHomeFeedStore((s) => s.surface);

  if (surface === "handoff") {
    // ChatLayout shows beneath; a compact chip situates the user and offers
    // the back-to-Home path without covering the docker UI's own controls.
    return <DockerHandoffChip />;
  }

  // home + native-chat both render the Home shell as a full overlay. The
  // shell itself decides whether the detail pane shows the chat surface.
  return (
    <div className="fixed inset-0 z-[55] bg-surface">
      <HomeScreen />
    </div>
  );
}
