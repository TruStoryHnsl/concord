import { useState, useRef } from "react";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { changePassword } from "../../api/concorrd";
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
