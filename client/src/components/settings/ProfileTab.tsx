import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { changePassword, getTOTPStatus, setupTOTP, verifyTOTP, disableTOTP, type TOTPSetupResult } from "../../api/concord";
import { Avatar } from "../ui/Avatar";

export function ProfileTab() {
  const client = useAuthStore((s) => s.client);
  const userId = useAuthStore((s) => s.userId);
  const addToast = useToastStore((s) => s.addToast);

  const currentName = userId?.split(":")[0].replace("@", "") ?? "";
  const [displayName, setDisplayName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleNameSave = async () => {
    if (!client || !displayName.trim()) return;
    setSaving(true);
    try {
      await client.setDisplayName(displayName.trim());
      addToast("Display name updated", "success");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to update display name",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      addToast("Please select an image file");
      return;
    }

    // Validate size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      addToast("Image must be under 2MB");
      return;
    }

    setUploading(true);
    try {
      const response = await client.uploadContent(file, {
        type: file.type,
      });
      const mxcUrl = response.content_uri;
      await client.setAvatarUrl(mxcUrl);
      addToast("Avatar updated", "success");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to upload avatar",
      );
    } finally {
      setUploading(false);
      // Clear file input so the same file can be re-selected
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-white">Profile</h3>

      {/* Avatar preview + upload */}
      <div className="flex items-center gap-4">
        {userId && <Avatar userId={userId} size="lg" />}
        <div className="space-y-1">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white text-sm rounded-md transition-colors"
          >
            {uploading ? "Uploading..." : "Change Avatar"}
          </button>
          <p className="text-xs text-zinc-500">JPG, PNG, or GIF. Max 2MB.</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            className="hidden"
          />
        </div>
      </div>

      {/* Display name */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-200">
          Display Name
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleNameSave}
            disabled={saving || !displayName.trim() || displayName === currentName}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* User ID (read-only) */}
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-zinc-400">User ID</span>
        <span className="text-sm text-zinc-500 font-mono">{userId}</span>
      </div>

      {/* Password change */}
      <PasswordChangeSection />

      {/* Two-factor authentication */}
      <TOTPSection />
    </div>
  );
}

function PasswordChangeSection() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const addToast = useToastStore((s) => s.addToast);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);

  const canSubmit =
    currentPw.length > 0 &&
    newPw.length >= 8 &&
    newPw === confirmPw &&
    !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !accessToken) return;

    setSaving(true);
    try {
      await changePassword(currentPw, newPw, accessToken);
      addToast("Password changed successfully", "success");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Failed to change password",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-zinc-700 pt-6 space-y-3">
      <h4 className="text-sm font-medium text-zinc-200">Change Password</h4>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="password"
          value={currentPw}
          onChange={(e) => setCurrentPw(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <input
          type="password"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          placeholder="New password (min 8 characters)"
          autoComplete="new-password"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <input
          type="password"
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        {newPw.length > 0 && newPw.length < 8 && (
          <p className="text-xs text-amber-400">
            Password must be at least 8 characters
          </p>
        )}
        {confirmPw.length > 0 && newPw !== confirmPw && (
          <p className="text-xs text-red-400">Passwords do not match</p>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors"
        >
          {saving ? "Changing..." : "Change Password"}
        </button>
      </form>
    </div>
  );
}

function TOTPSection() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const addToast = useToastStore((s) => s.addToast);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setupData, setSetupData] = useState<TOTPSetupResult | null>(null);
  const [code, setCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    getTOTPStatus(accessToken).then((r) => setEnabled(r.enabled)).catch(() => {});
  }, [accessToken]);

  const handleSetup = async () => {
    if (!accessToken) return;
    setWorking(true);
    try {
      const data = await setupTOTP(accessToken);
      setSetupData(data);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setWorking(false);
    }
  };

  const handleVerify = async () => {
    if (!accessToken || code.length !== 6) return;
    setWorking(true);
    try {
      await verifyTOTP(code, accessToken);
      setEnabled(true);
      setSetupData(null);
      setCode("");
      addToast("Two-factor authentication enabled", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setWorking(false);
    }
  };

  const handleDisable = async () => {
    if (!accessToken || disableCode.length !== 6) return;
    setWorking(true);
    try {
      await disableTOTP(disableCode, accessToken);
      setEnabled(false);
      setDisableCode("");
      addToast("Two-factor authentication disabled", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to disable");
    } finally {
      setWorking(false);
    }
  };

  if (enabled === null) return null;

  return (
    <div className="border-t border-zinc-700 pt-6 space-y-3">
      <h4 className="text-sm font-medium text-zinc-200">Two-Factor Authentication</h4>

      {enabled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-emerald-400">Enabled</span>
          </div>
          <p className="text-xs text-zinc-500">
            Your account is protected with an authenticator app. Your online indicator appears on the left side of your avatar.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="Enter code to disable"
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 font-mono tracking-widest"
              maxLength={6}
            />
            <button
              onClick={handleDisable}
              disabled={working || disableCode.length !== 6}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors"
            >
              Disable
            </button>
          </div>
        </div>
      ) : setupData ? (
        <div className="space-y-4">
          <p className="text-xs text-zinc-400">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.), then enter the 6-digit code to confirm.
          </p>
          <div className="flex justify-center">
            <img
              src={setupData.qr_code}
              alt="TOTP QR Code"
              className="w-48 h-48 rounded-lg bg-white p-2"
            />
          </div>
          <div className="bg-zinc-800 rounded p-2">
            <p className="text-xs text-zinc-500 mb-1">Manual entry key:</p>
            <p className="text-xs text-zinc-300 font-mono break-all select-all">{setupData.secret}</p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono tracking-widest text-center text-lg"
              maxLength={6}
              autoFocus
            />
            <button
              onClick={handleVerify}
              disabled={working || code.length !== 6}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors"
            >
              {working ? "..." : "Verify"}
            </button>
          </div>
          <button
            onClick={() => setSetupData(null)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Cancel setup
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            Add an extra layer of security by requiring a code from an authenticator app when you log in.
            Authorized users have their online indicator on the left side of their avatar.
          </p>
          <button
            onClick={handleSetup}
            disabled={working}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white text-sm rounded-md transition-colors"
          >
            {working ? "Setting up..." : "Set Up Authenticator"}
          </button>
        </div>
      )}
    </div>
  );
}
