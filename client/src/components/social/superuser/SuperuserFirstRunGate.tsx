/**
 * First-run gate overlay. OWNED by superuser-ux.
 *
 * A self-contained, additively-mountable overlay that blocks the app on
 * first launch (native only) until the device owner claims their profile.
 * Drop `<SuperuserFirstRunGate />` near the top of `App.tsx`'s render tree
 * (additive import — does not edit other features' files). It renders
 * nothing on web, nothing while loading, and nothing once an owner is
 * already claimed; only on a fresh native install does it surface the
 * full-screen claim flow.
 *
 * Once the owner claims, the gate dismisses itself and the rest of the app
 * is reachable. Owner-controls editing thereafter lives in the
 * {@link SuperuserPanel} (mount it in a settings surface).
 */
import { useEffect, useState } from "react";

import { isTauri } from "../../../api/servitude";
import { FirstRunClaim } from "./FirstRunClaim";
import { useOwnerIdentity } from "./useOwnerIdentity";

interface SuperuserFirstRunGateProps {
  /**
   * When false the gate stays dormant (renders nothing) regardless of claim
   * state — lets the host defer first-run until the app is otherwise ready
   * (e.g. after the launch animation). Defaults to true.
   */
  active?: boolean;
}

export function SuperuserFirstRunGate({ active = true }: SuperuserFirstRunGateProps) {
  // Hooks must run unconditionally; gate the WORK, not the hook calls.
  const enabled = active && isTauri();
  return enabled ? <SuperuserFirstRunGateNative /> : null;
}

function SuperuserFirstRunGateNative() {
  const { owner, loading, claimed, reload, claim } = useOwnerIdentity();
  // Latch dismissal so a post-claim reload race can't re-show the overlay.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (claimed) setDismissed(true);
  }, [claimed]);

  // Render nothing until we know the claim state, once claimed, or once
  // dismissed. The only visible state is "fresh install, unclaimed".
  if (dismissed || claimed) return null;
  if (loading && owner === null) return null;
  if (owner === null) return null; // load failed — don't block the app.

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-surface/95 backdrop-blur-sm p-6 overflow-y-auto"
      data-testid="superuser-first-run-gate"
    >
      <div className="w-full">
        <FirstRunClaim
          onClaim={claim}
          onClaimed={() => setDismissed(true)}
          onReload={reload}
        />
      </div>
    </div>
  );
}
