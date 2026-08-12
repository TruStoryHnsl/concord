/**
 * IdentityTab — the unified identity settings surface.
 *
 * Replaces the redundant Profile ("profile") and Identity ("users")
 * tabs with ONE user-first page (settings key "identity"; the legacy
 * keys resolve here via `resolveSettingsTab` in stores/settings.ts):
 *
 *   1. Account — the profile basics (avatar, display name, password,
 *      recovery email, 2FA, logout). `ProfileTab` renders this section;
 *      it kept its export name for test/import stability.
 *   2. Your superuser — the device-local root identity: claim/owner
 *      panel (SuperuserPanel), keychain backup/restore
 *      (SuperuserBackupSection), trust edges (IdentityTrustSection) and
 *      the account-services relay (AccountServicesSection). Every one
 *      of these sections degrades honestly on web (the superuser lives
 *      on the user's device, not in the browser) — the surface itself
 *      never unmounts.
 *   3. Personae — the peer-facing identities, listed with their
 *      establishment state on every existing connection (this
 *      instance/portal, Matrix, Reticulum, P2P). See PersonaeSection.
 */

import { useAuthStore } from "../../stores/auth";
import { isTauri } from "../../api/servitude";
import { ProfileTab } from "./ProfileTab";
import { IdentityTrustSection } from "./IdentityTrustSection";
import { SuperuserBackupSection, SUPERUSER_BACKUP_ANCHOR_ID } from "./SuperuserBackupSection";
import { AccountServicesSection } from "./AccountServicesSection";
import { SuperuserPanel } from "../social/superuser/SuperuserPanel";
import { PersonaeSection } from "./identity/PersonaeSection";

export function IdentityTab() {
  const userId = useAuthStore((s) => s.userId);
  const loginHandle = userId ? userId.split(":")[0].replace("@", "") : null;
  const native = isTauri();

  const scrollToBackup = () => {
    document
      .getElementById(SUPERUSER_BACKUP_ANCHOR_ID)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-10" data-testid="identity-tab">
      {/* ── 1. Account basics ─────────────────────────────────── */}
      <ProfileTab />

      {/* ── 2. Your superuser ─────────────────────────────────── */}
      <section className="space-y-4" data-testid="identity-superuser-section">
        <div>
          <h3 className="text-xl font-semibold text-on-surface">
            Your superuser
          </h3>
          <p className="text-sm text-on-surface-variant mt-1 max-w-prose">
            {native
              ? "Your superuser is the root identity on this device. It derives the personae below, owns the keychain that syncs to your other devices, and is never shown to peers."
              : "Your superuser lives on your device, in the desktop app — it never leaves it, and this browser never holds it. What you see here is its roamed state: the personae it has bound to this account."}
          </p>
        </div>

        {loginHandle && (
          <div className="rounded-lg bg-surface-container-high border border-primary/30 px-3 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-2xl">
              shield_person
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-on-surface">
                Signed in as {loginHandle}
              </div>
              <div className="text-xs text-on-surface-variant">
                {native
                  ? "Claim this login as your superuser to make it your root identity across your devices."
                  : "This is the account you're connected with on this instance."}
              </div>
            </div>
            {native && (
              <button
                type="button"
                onClick={scrollToBackup}
                className="flex-shrink-0 px-3 py-1.5 text-sm rounded-lg bg-primary text-on-primary hover:opacity-90"
                data-testid="users-tab-claim-superuser"
              >
                Claim as superuser
              </button>
            )}
          </div>
        )}

        {/* WS-2 — reachable superuser (owner-identity) panel. Renders its
            own web fallback. */}
        <SuperuserPanel />

        {/* F5 — Hub credential backup: claim/restore the superuser
            keychain. Web build shows a desktop-only statement. */}
        <SuperuserBackupSection />

        {/* F-A — Concord-native user-definition protocol: trust edges. */}
        <IdentityTrustSection />

        {/* WS-5 — optional docker account-services center. */}
        <AccountServicesSection />
      </section>

      {/* ── 3. Personae ───────────────────────────────────────── */}
      <section
        className="space-y-4 border-t border-outline-variant/15 pt-6"
        data-testid="identity-personae-section"
      >
        <h3 className="text-xl font-semibold text-on-surface">Personae</h3>
        <PersonaeSection />
      </section>
    </div>
  );
}
