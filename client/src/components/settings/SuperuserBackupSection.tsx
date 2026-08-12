/**
 * Superuser keychain backup/restore — native settings section.
 *
 * Two controls, both backed by the `hub_*` Tauri commands:
 *
 *   - Back up: enter a passphrase + a Hub peer-id, build the
 *     passphrase-encrypted ciphertext locally (`hub_claim`), and surface
 *     the returned opaque envelope to upload to the Hub.
 *   - Restore: on a new device, enter the passphrase + the ciphertext +
 *     the Hub peer-id, and decrypt + overwrite the local keychain
 *     (`hub_restore`).
 *
 * The passphrase never leaves this device; the Hub only ever holds the
 * opaque ciphertext.
 *
 * Web build shows a one-line desktop-only statement — the crypto runs
 * against the local porch, which a browser build doesn't host.
 */

import { useEffect, useRef, useState } from "react";

import { isTauri } from "../../api/servitude";
import {
  hubClaim,
  hubRestore,
  MIN_PASSPHRASE_LEN,
  type HubClaimPayload,
} from "../../api/hub";
import { exportSeedMnemonic, importSeedMnemonic, seedErrorMessage } from "../../api/seed";
import { socialOwnerGet } from "../../api/social/superuser";
import { useToastStore } from "../../stores/toast";

const inputClass =
  "w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30";
const primaryBtn =
  "px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors";

/**
 * `id` lets a sibling tab (e.g. UsersTab's "Claim as superuser" action)
 * scroll this section into view. Stable so the anchor target doesn't move.
 */
export const SUPERUSER_BACKUP_ANCHOR_ID = "superuser-backup-section";

export function SuperuserBackupSection() {
  if (!isTauri()) {
    return (
      <div
        id={SUPERUSER_BACKUP_ANCHOR_ID}
        className="border-t border-outline-variant/15 pt-6 space-y-3"
        data-testid="superuser-backup-section"
      >
        <h4 className="text-sm font-medium text-on-surface">
          Superuser Keychain Backup
        </h4>
        <p className="text-xs text-on-surface-variant">
          Available in the desktop app only.
        </p>
      </div>
    );
  }
  return <SuperuserBackupNative />;
}

function SuperuserBackupNative() {
  const addToast = useToastStore((s) => s.addToast);

  // Back-up form.
  const [backupPass, setBackupPass] = useState("");
  const [backupHub, setBackupHub] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [result, setResult] = useState<HubClaimPayload | null>(null);

  // Restore form.
  const [restorePass, setRestorePass] = useState("");
  const [restoreHub, setRestoreHub] = useState("");
  const [restoreCipher, setRestoreCipher] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);

  // If the section was navigated to via the URL hash (the UsersTab/Identity
  // "Claim as superuser" action sets it), scroll it into view on mount.
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.location.hash === `#${SUPERUSER_BACKUP_ANCHOR_ID}`
    ) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const backupPassTooShort =
    backupPass.length > 0 && backupPass.length < MIN_PASSPHRASE_LEN;
  const canBackup =
    backupPass.length >= MIN_PASSPHRASE_LEN &&
    backupHub.trim().length > 0 &&
    !backupBusy;

  const restorePassTooShort =
    restorePass.length > 0 && restorePass.length < MIN_PASSPHRASE_LEN;
  const canRestore =
    restorePass.length >= MIN_PASSPHRASE_LEN &&
    restoreCipher.trim().length > 0 &&
    !restoreBusy;

  const handleBackup = async () => {
    if (!canBackup) return;
    setBackupBusy(true);
    setResult(null);
    try {
      const payload = await hubClaim(backupPass, backupHub.trim());
      setResult(payload);
      setBackupPass("");
      addToast("Keychain backup built", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!canRestore) return;
    setRestoreBusy(true);
    try {
      await hubRestore(restorePass, restoreCipher.trim(), restoreHub.trim());
      setRestorePass("");
      setRestoreCipher("");
      addToast("Keychain restored", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoreBusy(false);
    }
  };

  const copyCiphertext = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.ciphertextB64);
      addToast("Ciphertext copied", "success");
    } catch {
      addToast("Copy failed");
    }
  };

  return (
    <div
      id={SUPERUSER_BACKUP_ANCHOR_ID}
      ref={rootRef}
      className="border-t border-outline-variant/15 pt-6 space-y-6"
      data-testid="superuser-backup-section"
    >
      <h4 className="text-sm font-medium text-on-surface">
        Superuser Keychain Backup
      </h4>

      {/* Back up */}
      <div className="space-y-3">
        <p className="text-xs text-on-surface-variant">
          Encrypts this device&apos;s superuser keychain with a passphrase
          and produces a ciphertext to upload to a Hub. The passphrase
          stays on this device.
        </p>
        <input
          type="password"
          value={backupPass}
          onChange={(e) => setBackupPass(e.target.value)}
          placeholder={`Passphrase (min ${MIN_PASSPHRASE_LEN} characters)`}
          autoComplete="new-password"
          data-testid="superuser-backup-passphrase"
          className={inputClass}
        />
        {backupPassTooShort && (
          <p className="text-xs text-error">
            Passphrase must be at least {MIN_PASSPHRASE_LEN} characters.
          </p>
        )}
        <input
          type="text"
          value={backupHub}
          onChange={(e) => setBackupHub(e.target.value)}
          placeholder="Hub peer ID"
          spellCheck={false}
          data-testid="superuser-backup-hub"
          className={`${inputClass} font-mono`}
        />
        <button
          onClick={handleBackup}
          disabled={!canBackup}
          data-testid="superuser-backup-submit"
          className={primaryBtn}
        >
          {backupBusy ? "Encrypting…" : "Back up keychain"}
        </button>

        {result && (
          <div className="space-y-2 rounded border border-outline-variant/30 bg-surface-container p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-on-surface-variant">
                Ciphertext for {result.hubPeerId} ({result.sizeBytes} bytes)
              </span>
              <button
                onClick={copyCiphertext}
                data-testid="superuser-backup-copy"
                className="text-xs text-primary hover:underline whitespace-nowrap"
              >
                Copy
              </button>
            </div>
            <textarea
              readOnly
              value={result.ciphertextB64}
              data-testid="superuser-backup-result"
              className="w-full h-24 px-2 py-1 bg-surface-container-low border border-outline-variant rounded text-xs text-on-surface font-mono break-all resize-none focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Restore */}
      <div className="space-y-3">
        <h5 className="text-xs font-medium text-on-surface">
          Restore on this device
        </h5>
        <p className="text-xs text-on-surface-variant">
          Decrypts a Hub ciphertext with the passphrase and overwrites this
          device&apos;s keychain. This replaces the current local keychain.
        </p>
        <input
          type="password"
          value={restorePass}
          onChange={(e) => setRestorePass(e.target.value)}
          placeholder={`Passphrase (min ${MIN_PASSPHRASE_LEN} characters)`}
          autoComplete="off"
          data-testid="superuser-restore-passphrase"
          className={inputClass}
        />
        {restorePassTooShort && (
          <p className="text-xs text-error">
            Passphrase must be at least {MIN_PASSPHRASE_LEN} characters.
          </p>
        )}
        <input
          type="text"
          value={restoreHub}
          onChange={(e) => setRestoreHub(e.target.value)}
          placeholder="Hub peer ID (leave blank for offline restore)"
          spellCheck={false}
          data-testid="superuser-restore-hub"
          className={`${inputClass} font-mono`}
        />
        <textarea
          value={restoreCipher}
          onChange={(e) => setRestoreCipher(e.target.value)}
          placeholder="Ciphertext (base64)"
          spellCheck={false}
          data-testid="superuser-restore-cipher"
          className={`${inputClass} h-24 font-mono break-all resize-none`}
        />
        <button
          onClick={handleRestore}
          disabled={!canRestore}
          data-testid="superuser-restore-submit"
          className={primaryBtn}
        >
          {restoreBusy ? "Restoring…" : "Restore keychain"}
        </button>
      </div>

      {/* Recovery phrase — BIP39 seed export / import */}
      <RecoveryPhraseSection />
    </div>
  );
}

/**
 * BIP39 recovery-phrase surface (NUI-F19 identity portability).
 *
 * Export: two-step confirmation before the 24 words are revealed — the
 * phrase IS the identity, so the first click only shows the warning, and a
 * second explicit action reveals it. The phrase is held in component state
 * only while revealed and dropped on dismiss.
 *
 * Import: restore this install's seed from a phrase. Only offered when no
 * owner is claimed yet (the command refuses a claimed install anyway; the
 * UI hides the affordance so the refusal is never a surprise). On success
 * the install becomes a second device under the phrase's owner.
 */
function RecoveryPhraseSection() {
  const addToast = useToastStore((s) => s.addToast);

  // Export flow: idle → confirm → revealed.
  const [confirming, setConfirming] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  // Import flow.
  const [draftPhrase, setDraftPhrase] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [ownerClaimed, setOwnerClaimed] = useState<boolean | null>(null);

  // Whether restore is even offered: only on an unclaimed install.
  useEffect(() => {
    let cancelled = false;
    socialOwnerGet()
      .then((owner) => {
        if (!cancelled) setOwnerClaimed(owner.claimed);
      })
      .catch(() => {
        if (!cancelled) setOwnerClaimed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReveal = async () => {
    if (!understood) return;
    setExportBusy(true);
    try {
      const words = await exportSeedMnemonic();
      setPhrase(words);
      setConfirming(false);
      setUnderstood(false);
    } catch (err) {
      addToast(seedErrorMessage(err));
    } finally {
      setExportBusy(false);
    }
  };

  const copyPhrase = async () => {
    if (!phrase) return;
    try {
      await navigator.clipboard.writeText(phrase);
      addToast("Recovery phrase copied", "success");
    } catch {
      addToast("Copy failed");
    }
  };

  const handleImport = async () => {
    const words = draftPhrase.trim();
    if (!words || importBusy) return;
    setImportBusy(true);
    try {
      const id = await importSeedMnemonic(words);
      setDraftPhrase("");
      addToast(
        `Identity restored — owner fingerprint ${id.ownerFingerprint.slice(0, 8)}…`,
        "success",
      );
    } catch (err) {
      addToast(seedErrorMessage(err));
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="recovery-phrase-section">
      <h5 className="text-xs font-medium text-on-surface">Recovery phrase</h5>
      <p className="text-xs text-on-surface-variant">
        The 24-word phrase that carries this install&apos;s identity. Anyone
        holding it can sign as this device and decrypt anything sealed to it.
      </p>

      {/* Export */}
      {phrase === null ? (
        <div className="space-y-2">
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              data-testid="recovery-phrase-export-start"
              className={primaryBtn}
            >
              Show recovery phrase
            </button>
          ) : (
            <div className="space-y-2 rounded border border-outline-variant/30 bg-surface-container p-3">
              <p className="text-xs text-on-surface-variant">
                This phrase is the identity. Anyone who has it can sign as this
                device and decrypt anything sealed to it. Write it down and
                keep it somewhere safe — it is the only way to restore this
                identity on a new device.
              </p>
              <label className="flex items-center gap-2 text-xs text-on-surface">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                  data-testid="recovery-phrase-understood"
                />
                I understand — I will keep this phrase private.
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleReveal()}
                  disabled={!understood || exportBusy}
                  data-testid="recovery-phrase-reveal"
                  className={primaryBtn}
                >
                  {exportBusy ? "Revealing…" : "Reveal phrase"}
                </button>
                <button
                  onClick={() => {
                    setConfirming(false);
                    setUnderstood(false);
                  }}
                  data-testid="recovery-phrase-export-cancel"
                  className="px-4 py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded border border-outline-variant/30 bg-surface-container p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-on-surface-variant">
              Your 24-word recovery phrase
            </span>
            <button
              onClick={copyPhrase}
              data-testid="recovery-phrase-copy"
              className="text-xs text-primary hover:underline whitespace-nowrap"
            >
              Copy
            </button>
          </div>
          <textarea
            readOnly
            value={phrase}
            data-testid="recovery-phrase-value"
            className="w-full h-28 px-2 py-1 bg-surface-container-low border border-outline-variant rounded text-xs text-on-surface font-mono break-all resize-none focus:outline-none"
          />
          <button
            onClick={() => setPhrase(null)}
            data-testid="recovery-phrase-dismiss"
            className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Done — hide phrase
          </button>
        </div>
      )}

      {/* Import — only on an unclaimed install */}
      {ownerClaimed === false && (
        <div className="space-y-2">
          <p className="text-xs text-on-surface-variant">
            Restore this install from a phrase. This replaces the current
            identity and makes this device a second device under the
            phrase&apos;s owner.
          </p>
          <textarea
            value={draftPhrase}
            onChange={(e) => setDraftPhrase(e.target.value)}
            placeholder="24 words, space-separated"
            spellCheck={false}
            autoComplete="off"
            data-testid="recovery-phrase-import-input"
            className={`${inputClass} h-24 font-mono break-all resize-none`}
          />
          <button
            onClick={() => void handleImport()}
            disabled={!draftPhrase.trim() || importBusy}
            data-testid="recovery-phrase-import-submit"
            className={primaryBtn}
          >
            {importBusy ? "Restoring…" : "Restore from phrase"}
          </button>
        </div>
      )}
      {ownerClaimed === true && (
        <p className="text-xs text-on-surface-variant italic">
          Restore is only available on a fresh install — this device already
          has a claimed owner.
        </p>
      )}
    </div>
  );
}
