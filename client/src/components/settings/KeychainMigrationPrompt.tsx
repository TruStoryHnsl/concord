/**
 * One-time keychain migration prompt (Phase-2 source routing).
 *
 * Before Phase 2, every saved source's credentials lived in plaintext
 * localStorage (the `concord_sources` zustand-persisted store). Phase 2
 * introduced the porch-backed, Stronghold-encrypted keychain. This modal
 * offers — exactly once, on the first native launch after this ships — to
 * move the user's existing saved sources into their primary profile's
 * keychain.
 *
 * Gating (enforced by the caller in App.tsx via
 * {@link shouldShowKeychainMigration}, AND defensively re-checked here so
 * the component is self-contained):
 *   - Native only (`isTauri()`). The web build has no porch / Stronghold.
 *   - Shown only once: a `concord_keychain_migrated` localStorage flag is
 *     set on EITHER action (Move OR Not now). Dismissing is non-destructive
 *     but still sets the flag, so the prompt never reappears.
 *   - Only when there is at least one migratable saved source.
 *
 * "Move" calls {@link keychainAdd} for each migratable source, then sets
 * the flag and shows a result. Failures are surfaced as a count but never
 * block — the flag is set regardless so the user is not nagged again.
 * "Not now" sets the flag and closes without writing anything.
 *
 * Pure migration logic (the plan, the gate, the flag) lives in the sibling
 * `keychainMigration.ts` so this file only exports a component
 * (fast-refresh requirement).
 *
 * Modal styling follows the hand-rolled overlay pattern used across the app
 * (e.g. `BugReportModal`): a `fixed inset-0` backdrop + a
 * `bg-surface-container` card. There is no shared Modal primitive to
 * import. The only loading animation is `<BringingUpSplash />` — never a
 * hand-rolled spinner.
 */

import { useState } from "react";
import { isTauri } from "../../api/servitude";
import { keychainAdd } from "../../api/keychain";
import { BringingUpSplash } from "../BringingUpSplash";
import {
  migratableSources,
  planSourceMigration,
  markKeychainMigrated,
  existingKeychainKeys,
  sourceKey,
} from "./keychainMigration";

export interface KeychainMigrationPromptProps {
  /** Called after the prompt is actioned (Move or Not now) — the caller
   *  unmounts the modal. The migration flag is already set by then. */
  onClose: () => void;
}

export function KeychainMigrationPrompt({
  onClose,
}: KeychainMigrationPromptProps) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ moved: number; failed: number } | null>(
    null,
  );

  // Defensive re-check: if somehow mounted on web, render nothing.
  if (!isTauri()) return null;

  const sourceCount = migratableSources().length;

  const handleMove = async () => {
    setBusy(true);
    const targets = migratableSources();
    // Skip sources the keychain already holds (persisted at login time) so
    // re-running the move never writes a duplicate entry.
    const existing = await existingKeychainKeys();
    let moved = 0;
    let failed = 0;
    for (const source of targets) {
      const plan = planSourceMigration(source);
      if (!plan) continue;
      if (existing.has(sourceKey(plan.sourceKind, plan.sourceHost))) continue;
      try {
        await keychainAdd(plan);
        moved += 1;
      } catch (err) {
        failed += 1;
        console.warn(
          "[KeychainMigration] failed to migrate source",
          source.host,
          err instanceof Error ? err.message : err,
        );
      }
    }
    // Set the flag regardless of partial failure — we never re-nag.
    markKeychainMigrated();
    setBusy(false);
    setDone({ moved, failed });
  };

  const handleNotNow = () => {
    // Non-destructive dismiss, but still one-and-done.
    markKeychainMigrated();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        // Backdrop click dismisses (treated as "Not now") — but never while
        // a migration is in flight or after it has completed.
        if (e.target === e.currentTarget && !busy && !done) handleNotNow();
      }}
    >
      <div className="bg-surface-container rounded-xl border border-outline-variant/15 shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-outline-variant/15">
          <h2 className="text-lg font-semibold text-on-surface">
            Move your saved sources?
          </h2>
        </div>

        <div className="p-5 space-y-4">
          {busy ? (
            <BringingUpSplash
              size="compact"
              status="Moving your sources…"
              testId="keychain-migration-progress"
            />
          ) : done ? (
            <div className="space-y-3 text-sm text-on-surface-variant">
              <p className="text-on-surface">
                {done.moved > 0
                  ? `Moved ${done.moved} source${done.moved === 1 ? "" : "s"} into your primary profile.`
                  : "Nothing was moved."}
              </p>
              {done.failed > 0 && (
                <p className="text-on-surface-variant">
                  {done.failed} source{done.failed === 1 ? "" : "s"} couldn’t
                  be moved. They’re still saved as before — nothing was lost.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-on-surface-variant">
              Move your {sourceCount} saved source
              {sourceCount === 1 ? "" : "s"} into your primary profile so their
              logins are stored securely in your keychain. Your existing
              sources stay exactly where they are — this only adds an encrypted
              copy.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-outline-variant/15">
          {done ? (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 primary-glow hover:brightness-110 text-on-surface text-sm rounded-md transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleNotNow}
                disabled={busy}
                className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface disabled:opacity-40 transition-colors"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={handleMove}
                disabled={busy}
                className="px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors"
              >
                Move
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
