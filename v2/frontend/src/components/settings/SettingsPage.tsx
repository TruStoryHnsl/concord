import { useEffect, useState, useCallback } from "react";
import GlassPanel from "@/components/ui/GlassPanel";
import Toggle from "@/components/ui/Toggle";
import Button from "@/components/ui/Button";
import { useSettingsStore } from "@/stores/settings";
import { setupTotp, enableTotp, disableTotp, isTotpEnabled } from "@/api/tauri";
import type { TotpSetup } from "@/api/tauri";

function SettingsPage() {
  const {
    theme,
    notifications,
    port,
    autoStart,
    backgroundOp,
    setTheme,
    setNotifications,
    setPort,
    setAutoStart,
    setBackgroundOp,
  } = useSettingsStore();

  const [displayNameDraft, setDisplayNameDraft] = useState("Node-preview");
  const [logLevel, setLogLevel] = useState(2); // 0=error, 1=warn, 2=info, 3=debug, 4=trace
  const [manualPeer, setManualPeer] = useState("");

  // TOTP state
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState<string | null>(null);
  const [showTotpSetup, setShowTotpSetup] = useState(false);
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  // Privacy
  const [encryptedBackups, setEncryptedBackups] = useState(true);
  const [discoverable, setDiscoverable] = useState(true);

  useEffect(() => {
    void isTotpEnabled().then(setTotpEnabled).catch(() => {});
  }, []);

  const handleStartTotpSetup = useCallback(async () => {
    try {
      const data = await setupTotp();
      setTotpSetupData(data);
      setShowTotpSetup(true);
      setTotpError(null);
      setTotpCode("");
    } catch {
      setTotpError("Failed to initialize TOTP setup");
    }
  }, []);

  const handleConfirmTotp = useCallback(async () => {
    if (totpCode.length !== 6) {
      setTotpError("Code must be 6 digits");
      return;
    }
    try {
      await enableTotp(totpCode);
      setTotpEnabled(true);
      setShowTotpSetup(false);
      setTotpSetupData(null);
      setTotpCode("");
      setTotpError(null);
    } catch {
      setTotpError("Invalid verification code");
    }
  }, [totpCode]);

  const handleDisableTotp = useCallback(async () => {
    if (disableCode.length !== 6) {
      setTotpError("Code must be 6 digits");
      return;
    }
    try {
      await disableTotp(disableCode);
      setTotpEnabled(false);
      setShowDisableConfirm(false);
      setDisableCode("");
      setTotpError(null);
    } catch {
      setTotpError("Invalid verification code");
    }
  }, [disableCode]);

  const logLevelLabels = ["Error", "Warn", "Info", "Debug", "Trace"];

  return (
    <div className="mesh-background min-h-full p-6">
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <div className="space-y-1">
          <h1 className="font-headline font-bold text-3xl text-on-surface">
            Settings
          </h1>
          <p className="text-on-surface-variant text-sm font-body">
            Configure your node, appearance, and security preferences.
          </p>
        </div>

        {/* General */}
        <GlassPanel className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-lg">
              tune
            </span>
            <h2 className="font-headline font-semibold text-lg text-on-surface">
              General
            </h2>
          </div>
          <div className="space-y-4">
            {/* Theme */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-body text-on-surface">Theme</p>
                <p className="text-xs font-body text-on-surface-variant">
                  Choose your visual theme
                </p>
              </div>
              <select
                value={theme}
                onChange={(e) =>
                  setTheme(e.target.value as "dark" | "light" | "system")
                }
                className="px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-sm font-body border-none focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="dark">Midnight Teal</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>

            {/* Notifications */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-body text-on-surface">Notifications</p>
                <p className="text-xs font-body text-on-surface-variant">
                  Receive push notifications for messages
                </p>
              </div>
              <Toggle checked={notifications} onChange={setNotifications} />
            </div>

            {/* Display name */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-body text-on-surface">Display Name</p>
                <p className="text-xs font-body text-on-surface-variant">
                  Your name visible to peers
                </p>
              </div>
              <input
                type="text"
                value={displayNameDraft}
                onChange={(e) => setDisplayNameDraft(e.target.value)}
                className="w-48 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-sm font-body border-none focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
        </GlassPanel>

        {/* Node Settings */}
        <GlassPanel className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-lg">
              hub
            </span>
            <h2 className="font-headline font-semibold text-lg text-on-surface">
              Node Settings
            </h2>
          </div>
          <div className="space-y-4">
            {/* Local port */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-body text-on-surface">Local Port</p>
                <p className="text-xs font-body text-on-surface-variant">
                  Port for P2P connections
                </p>
              </div>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-28 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-sm font-body border-none focus:outline-none focus:ring-1 focus:ring-primary/30 text-right"
              />
            </div>

            {/* Auto-start */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-body text-on-surface">Auto Start</p>
                <p className="text-xs font-body text-on-surface-variant">
                  Launch Concord on system startup
                </p>
              </div>
              <Toggle checked={autoStart} onChange={setAutoStart} />
            </div>

            {/* Background operation */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-body text-on-surface">
                  Background Operation
                </p>
                <p className="text-xs font-body text-on-surface-variant">
                  Keep node running when app is minimized
                </p>
              </div>
              <Toggle checked={backgroundOp} onChange={setBackgroundOp} />
            </div>
          </div>
        </GlassPanel>

        {/* Privacy */}
        <GlassPanel className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-lg">
              lock
            </span>
            <h2 className="font-headline font-semibold text-lg text-on-surface">
              Privacy
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Encrypted backups card */}
            <div className="p-4 rounded-xl bg-surface-container-low space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">
                  shield
                </span>
                <p className="text-sm font-body font-medium text-on-surface">
                  Encrypted Backups
                </p>
              </div>
              <p className="text-xs text-on-surface-variant font-body">
                Encrypt all local data backups
              </p>
              <Toggle
                checked={encryptedBackups}
                onChange={setEncryptedBackups}
              />
            </div>

            {/* Discoverability card */}
            <div className="p-4 rounded-xl bg-surface-container-low space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-lg">
                  visibility
                </span>
                <p className="text-sm font-body font-medium text-on-surface">
                  Discoverability
                </p>
              </div>
              <p className="text-xs text-on-surface-variant font-body">
                Allow peers to find you on the mesh
              </p>
              <Toggle checked={discoverable} onChange={setDiscoverable} />
            </div>
          </div>
        </GlassPanel>

        {/* Security — 2FA */}
        <GlassPanel className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-lg">
              security
            </span>
            <h2 className="font-headline font-semibold text-lg text-on-surface">
              Security
            </h2>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-body text-on-surface">
                  Two-Factor Authentication
                </p>
                <p className="text-xs font-body text-on-surface-variant">
                  Add an extra layer of security with TOTP
                </p>
              </div>
              {totpEnabled ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 text-secondary text-xs font-label font-medium">
                    <span className="material-symbols-outlined text-xs">
                      check_circle
                    </span>
                    2FA Active
                  </span>
                  <button
                    onClick={() => {
                      setShowDisableConfirm(true);
                      setTotpError(null);
                      setDisableCode("");
                    }}
                    className="text-xs text-error font-label hover:text-error/80 transition-colors"
                  >
                    Disable
                  </button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => void handleStartTotpSetup()}
                >
                  <span className="material-symbols-outlined text-lg">
                    lock
                  </span>
                  Enable 2FA
                </Button>
              )}
            </div>

            {/* TOTP Setup Flow */}
            {showTotpSetup && totpSetupData && (
              <div className="p-4 rounded-xl bg-surface-container-low space-y-4">
                <p className="text-sm font-body font-medium text-on-surface">
                  Set up your authenticator app
                </p>
                <div className="space-y-2">
                  <p className="text-xs text-on-surface-variant font-body">
                    Add this key to your authenticator app:
                  </p>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container">
                    <span className="font-mono text-sm text-primary break-all flex-1">
                      {totpSetupData.secret}
                    </span>
                    <button
                      onClick={() =>
                        void navigator.clipboard.writeText(totpSetupData.secret)
                      }
                      className="shrink-0 text-on-surface-variant hover:text-primary transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">
                        content_copy
                      </span>
                    </button>
                  </div>
                  <p className="text-[10px] text-on-surface-variant font-body break-all">
                    URI: {totpSetupData.uri}
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-on-surface-variant font-body">
                    Enter the 6-digit code from your app to verify:
                  </p>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={totpCode}
                      onChange={(e) =>
                        setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="000000"
                      maxLength={6}
                      className="w-32 px-3 py-2 rounded-lg bg-surface-container text-on-surface text-sm font-mono text-center tracking-widest border-none focus:outline-none focus:ring-1 focus:ring-primary/30"
                    />
                    <Button
                      variant="primary"
                      onClick={() => void handleConfirmTotp()}
                      disabled={totpCode.length !== 6}
                    >
                      Verify
                    </Button>
                    <button
                      onClick={() => {
                        setShowTotpSetup(false);
                        setTotpSetupData(null);
                      }}
                      className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                {totpError && (
                  <p className="text-xs text-error font-body">{totpError}</p>
                )}
              </div>
            )}

            {/* Disable confirmation */}
            {showDisableConfirm && (
              <div className="p-4 rounded-xl bg-surface-container-low space-y-3">
                <p className="text-sm font-body font-medium text-on-surface">
                  Confirm 2FA Disable
                </p>
                <p className="text-xs text-on-surface-variant font-body">
                  Enter your current 2FA code to disable:
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={disableCode}
                    onChange={(e) =>
                      setDisableCode(
                        e.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    placeholder="000000"
                    maxLength={6}
                    className="w-32 px-3 py-2 rounded-lg bg-surface-container text-on-surface text-sm font-mono text-center tracking-widest border-none focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <Button
                    variant="danger"
                    onClick={() => void handleDisableTotp()}
                    disabled={disableCode.length !== 6}
                  >
                    Disable 2FA
                  </Button>
                  <button
                    onClick={() => setShowDisableConfirm(false)}
                    className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                {totpError && (
                  <p className="text-xs text-error font-body">{totpError}</p>
                )}
              </div>
            )}
          </div>
        </GlassPanel>

        {/* Advanced */}
        <GlassPanel className="p-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-on-surface-variant text-lg">
              terminal
            </span>
            <h2 className="font-headline font-semibold text-lg text-on-surface">
              Advanced
            </h2>
          </div>
          <div className="space-y-4">
            {/* Log level */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-body text-on-surface">Log Level</p>
                  <p className="text-xs font-body text-on-surface-variant">
                    Verbosity of console output
                  </p>
                </div>
                <span className="text-sm font-label font-medium text-primary">
                  {logLevelLabels[logLevel]}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={4}
                value={logLevel}
                onChange={(e) => setLogLevel(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-surface-container-highest accent-primary cursor-pointer"
              />
            </div>

            {/* Manual peer entry */}
            <div className="space-y-2">
              <div>
                <p className="text-sm font-body text-on-surface">
                  Manual Peer Entry
                </p>
                <p className="text-xs font-body text-on-surface-variant">
                  Connect to a peer by multiaddr
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualPeer}
                  onChange={(e) => setManualPeer(e.target.value)}
                  placeholder="/ip4/192.168.1.10/udp/4001/quic-v1/p2p/12D3..."
                  className="flex-1 px-3 py-2 rounded-lg bg-surface-container text-on-surface text-sm font-mono border-none focus:outline-none focus:ring-1 focus:ring-primary/30 placeholder:text-on-surface-variant/40"
                />
                <Button variant="secondary" disabled={!manualPeer.trim()}>
                  Connect
                </Button>
              </div>
            </div>
          </div>
        </GlassPanel>

        {/* Save button */}
        <div className="flex justify-end pb-8">
          <Button variant="primary">
            <span className="material-symbols-outlined text-lg">save</span>
            Save All Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
