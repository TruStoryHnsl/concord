/**
 * Component home: **superuser-ux** (OWNED by the superuser-ux branch).
 *
 * First-run / owner setup UX, owner-profile claim, and owner controls for
 * the social graph. The superuser-ux branch owns everything under
 * `client/src/components/social/superuser/`.
 *
 * This panel orchestrates the two states the owner experience has:
 *
 *   1. **First run** (`owner.claimed === false`) → {@link FirstRunClaim}.
 *   2. **Claimed** (`owner.claimed === true`) → {@link OwnerControls}.
 *
 * It is native-only: the `social_owner_*` commands require the local
 * Stronghold seed, which the browser node doesn't hold. On web it renders a
 * "desktop only" placeholder. Mount it wherever the owner identity should be
 * managed (e.g. additively from `App.tsx` as a first-run gate, or from a
 * settings surface) — see {@link SuperuserFirstRunGate} for the overlay
 * variant.
 */
import { isTauri } from "../../../api/servitude";
import { useToastStore } from "../../../stores/toast";
import { BringingUpSplash } from "../../BringingUpSplash";
import { FirstRunClaim } from "./FirstRunClaim";
import { OwnerControls } from "./OwnerControls";
import { useOwnerIdentity } from "./useOwnerIdentity";

export function SuperuserPanel() {
  if (!isTauri()) {
    return (
      <div
        className="border-t border-outline-variant/20 pt-6 space-y-2"
        data-testid="superuser-panel-web"
      >
        <h4 className="text-sm font-headline font-semibold text-on-surface">
          Owner identity
        </h4>
        <p className="text-xs text-on-surface-variant">
          Your peer-to-peer owner profile is managed in the desktop app, which
          holds the cryptographic identity it's bound to.
        </p>
      </div>
    );
  }
  return <SuperuserPanelNative />;
}

function SuperuserPanelNative() {
  const { owner, loading, error, claimed, reload, claim, update } =
    useOwnerIdentity();
  const addToast = useToastStore((s) => s.addToast);

  if (loading && owner === null) {
    return (
      <div className="py-8" data-testid="superuser-panel-loading">
        <BringingUpSplash />
      </div>
    );
  }

  if (error && owner === null) {
    return (
      <div className="space-y-3 py-6" data-testid="superuser-panel-error">
        <p className="text-sm text-error" role="alert">
          Couldn't load your owner profile: {error}
        </p>
        <button
          onClick={() => void reload()}
          className="px-4 py-2 primary-glow hover:brightness-110 text-on-surface text-sm rounded-md transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (owner && claimed) {
    return <OwnerControls owner={owner} onUpdate={update} onToast={addToast} />;
  }

  // owner is loaded but unclaimed → first-run.
  return (
    <FirstRunClaim onClaim={claim} onClaimed={() => void reload()} onReload={reload} />
  );
}
