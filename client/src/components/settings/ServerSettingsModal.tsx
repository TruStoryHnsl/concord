import { useState, useEffect, useCallback } from "react";
import { useServerStore } from "../../stores/server";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import {
  updateServerSettings,
  listMembers,
  updateMemberRole,
  kickMember,
  listBans,
  banUser,
  unbanUser,
  listWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  listWebhooks,
  createWebhook,
  deleteWebhook,
  toggleWebhook,
  searchUsers,
  sendDirectInvite,
} from "../../api/concorrd";
import type { ServerMember, ServerBan, ServerWhitelistEntry, Webhook, UserSearchResult } from "../../api/concorrd";

type Tab = "general" | "members" | "invite" | "bans" | "whitelist" | "webhooks";

interface Props {
  serverId: string;
}

/**
 * Inline server settings panel — renders inside the main content pane.
 */
export function ServerSettingsPanel({ serverId }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const server = useServerStore((s) => s.servers.find((sv) => sv.id === serverId));
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.userId);

  if (!server || !accessToken) return null;

  const isOwner = server.owner_id === userId;
  const members = useServerStore((s) => s.members[serverId] ?? []);
  const myMember = members.find((m) => m.user_id === userId);
  const isAdmin = isOwner || myMember?.role === "admin";
  const tabs: { key: Tab; label: string }[] = [
    { key: "general", label: "General" },
    { key: "members", label: "Members" },
    ...(isOwner || isAdmin
      ? [{ key: "invite" as Tab, label: "Invite User" }]
      : []),
    { key: "bans", label: "Bans" },
    ...(server.visibility === "private"
      ? [{ key: "whitelist" as Tab, label: "Whitelist" }]
      : []),
    { key: "webhooks" as Tab, label: "Webhooks" },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-700 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
              tab === t.key
                ? "bg-zinc-700 text-white"
                : "text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl">
        {tab === "general" && (
          <GeneralTab serverId={serverId} accessToken={accessToken} />
        )}
        {tab === "members" && (
          <MembersTab serverId={serverId} accessToken={accessToken} isOwner={isOwner} />
        )}
        {tab === "invite" && (
          <InviteUserTab serverId={serverId} accessToken={accessToken} />
        )}
        {tab === "bans" && (
          <BansTab serverId={serverId} accessToken={accessToken} />
        )}
        {tab === "whitelist" && (
          <WhitelistTab serverId={serverId} accessToken={accessToken} />
        )}
        {tab === "webhooks" && (
          <WebhooksTab serverId={serverId} accessToken={accessToken} />
        )}
      </div>
    </div>
  );
}

function GeneralTab({ serverId, accessToken }: { serverId: string; accessToken: string }) {
  const server = useServerStore((s) => s.servers.find((sv) => sv.id === serverId));
  const updateServer = useServerStore((s) => s.updateServer);
  const addToast = useToastStore((s) => s.addToast);

  const [name, setName] = useState(server?.name ?? "");
  const [abbreviation, setAbbreviation] = useState(server?.abbreviation ?? "");
  const [visibility, setVisibility] = useState(server?.visibility ?? "private");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateServerSettings(
        serverId,
        {
          name: name || undefined,
          visibility,
          abbreviation: abbreviation || null,
        },
        accessToken,
      );
      updateServer(serverId, {
        name: result.name,
        visibility: result.visibility,
        abbreviation: result.abbreviation,
      });
      addToast("Settings saved", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-semibold text-white">General</h3>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Server Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Abbreviation
          <span className="text-zinc-500 font-normal ml-1">(3 chars max, shown on sidebar)</span>
        </label>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value.slice(0, 3))}
            maxLength={3}
            placeholder={name.charAt(0).toUpperCase()}
            className="w-24 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white text-center focus:outline-none focus:border-indigo-500"
          />
          {/* Preview bubble */}
          <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-sm font-bold text-zinc-400">
            {abbreviation || name.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Visibility
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setVisibility("private")}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              visibility === "private"
                ? "bg-zinc-700 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Private
          </button>
          <button
            onClick={() => setVisibility("public")}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              visibility === "public"
                ? "bg-zinc-700 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Public
          </button>
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          {visibility === "private"
            ? "Only invited users can join"
            : "Anyone can find and join this server"}
        </p>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white text-sm font-medium rounded transition-colors"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

function MembersTab({
  serverId,
  accessToken,
  isOwner,
}: {
  serverId: string;
  accessToken: string;
  isOwner: boolean;
}) {
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmKick, setConfirmKick] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const load = useCallback(async () => {
    try {
      const data = await listMembers(serverId, accessToken);
      setMembers(data);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [serverId, accessToken, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await updateMemberRole(serverId, userId, role, accessToken);
      setMembers((prev) =>
        prev.map((m) => (m.user_id === userId ? { ...m, role } : m)),
      );
      addToast("Role updated", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const handleKick = async (userId: string) => {
    try {
      await kickMember(serverId, userId, accessToken);
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      addToast("Member kicked", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to kick member");
    }
    setConfirmKick(null);
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: "bg-amber-600/20 text-amber-400",
      admin: "bg-indigo-600/20 text-indigo-400",
      member: "bg-zinc-700 text-zinc-400",
    };
    return (
      <span className={`text-xs px-1.5 py-0.5 rounded ${colors[role] ?? colors.member}`}>
        {role}
      </span>
    );
  };

  if (loading) {
    return <p className="text-zinc-500 text-sm">Loading members...</p>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-white">
        Members ({members.length})
      </h3>

      <div className="space-y-1">
        {members.map((m) => {
          const name = m.display_name || m.user_id.split(":")[0].replace("@", "");
          return (
            <div
              key={m.user_id}
              className="flex items-center justify-between px-3 py-2 rounded bg-zinc-800/50 group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-zinc-200 truncate">{name}</span>
                <span className="text-xs text-zinc-500 truncate">{m.user_id}</span>
                {roleBadge(m.role)}
              </div>
              <div className="flex items-center gap-1">
                {isOwner && m.role !== "owner" && (
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                    className="text-xs bg-zinc-700 text-zinc-300 rounded px-1.5 py-1 border-none focus:outline-none"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
                {m.role !== "owner" && (
                  confirmKick === m.user_id ? (
                    <button
                      onClick={() => handleKick(m.user_id)}
                      onMouseLeave={() => setConfirmKick(null)}
                      className="text-red-400 text-xs px-1.5 py-1 animate-pulse"
                    >
                      Confirm?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmKick(m.user_id)}
                      className="text-zinc-600 hover:text-red-400 text-xs px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Kick
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BansTab({ serverId, accessToken }: { serverId: string; accessToken: string }) {
  const [bans, setBans] = useState<ServerBan[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBanId, setNewBanId] = useState("");
  const addToast = useToastStore((s) => s.addToast);

  const load = useCallback(async () => {
    try {
      const data = await listBans(serverId, accessToken);
      setBans(data);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to load bans");
    } finally {
      setLoading(false);
    }
  }, [serverId, accessToken, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBanId.trim()) return;
    try {
      await banUser(serverId, newBanId.trim(), accessToken);
      setNewBanId("");
      await load();
      addToast("User banned", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to ban user");
    }
  };

  const handleUnban = async (userId: string) => {
    try {
      await unbanUser(serverId, userId, accessToken);
      setBans((prev) => prev.filter((b) => b.user_id !== userId));
      addToast("User unbanned", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to unban");
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-white">Bans</h3>

      <form onSubmit={handleBan} className="flex gap-2">
        <input
          type="text"
          value={newBanId}
          onChange={(e) => setNewBanId(e.target.value)}
          placeholder="@user:server.com"
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded transition-colors"
        >
          Ban
        </button>
      </form>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : bans.length === 0 ? (
        <p className="text-zinc-500 text-sm">No banned users</p>
      ) : (
        <div className="space-y-1">
          {bans.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between px-3 py-2 rounded bg-zinc-800/50"
            >
              <span className="text-sm text-zinc-300">{b.user_id}</span>
              <button
                onClick={() => handleUnban(b.user_id)}
                className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
              >
                Unban
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WhitelistTab({ serverId, accessToken }: { serverId: string; accessToken: string }) {
  const [entries, setEntries] = useState<ServerWhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserId, setNewUserId] = useState("");
  const addToast = useToastStore((s) => s.addToast);

  const load = useCallback(async () => {
    try {
      const data = await listWhitelist(serverId, accessToken);
      setEntries(data);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to load whitelist");
    } finally {
      setLoading(false);
    }
  }, [serverId, accessToken, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserId.trim()) return;
    try {
      await addToWhitelist(serverId, newUserId.trim(), accessToken);
      setNewUserId("");
      await load();
      addToast("User whitelisted", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to add");
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeFromWhitelist(serverId, userId, accessToken);
      setEntries((prev) => prev.filter((e) => e.user_id !== userId));
      addToast("Removed from whitelist", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-white">Whitelist</h3>
      <p className="text-xs text-zinc-500">
        Only whitelisted users can join this private server via invite.
      </p>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          type="text"
          value={newUserId}
          onChange={(e) => setNewUserId(e.target.value)}
          placeholder="@user:server.com"
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
        >
          Add
        </button>
      </form>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-zinc-500 text-sm">No whitelisted users</p>
      ) : (
        <div className="space-y-1">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between px-3 py-2 rounded bg-zinc-800/50"
            >
              <span className="text-sm text-zinc-300">{e.user_id}</span>
              <button
                onClick={() => handleRemove(e.user_id)}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebhooksTab({ serverId, accessToken }: { serverId: string; accessToken: string }) {
  const server = useServerStore((s) => s.servers.find((sv) => sv.id === serverId));
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newChannelId, setNewChannelId] = useState<number | "">("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const textChannels = server?.channels.filter((c) => c.channel_type === "text") ?? [];

  const load = useCallback(async () => {
    try {
      const data = await listWebhooks(serverId, accessToken);
      setWebhooks(data);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, [serverId, accessToken, addToast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newChannelId === "") return;
    try {
      await createWebhook(serverId, newChannelId as number, newName.trim(), accessToken);
      setNewName("");
      setNewChannelId("");
      await load();
      addToast("Webhook created", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to create webhook");
    }
  };

  const handleDelete = async (webhookId: string) => {
    try {
      await deleteWebhook(serverId, webhookId, accessToken);
      setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
      addToast("Webhook deleted", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to delete webhook");
    }
    setConfirmDelete(null);
  };

  const handleToggle = async (webhookId: string) => {
    try {
      const result = await toggleWebhook(serverId, webhookId, accessToken);
      setWebhooks((prev) =>
        prev.map((w) => (w.id === result.id ? { ...w, enabled: result.enabled } : w)),
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to toggle webhook");
    }
  };

  const copyUrl = (webhookId: string, type: "form" | "api") => {
    const base = window.location.origin;
    const url = type === "form"
      ? `${base}/submit/${webhookId}`
      : `${base}/api/hooks/${webhookId}`;
    navigator.clipboard.writeText(url);
    addToast(`${type === "form" ? "Form" : "API"} URL copied`, "success");
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-white">Webhooks</h3>
      <p className="text-xs text-zinc-500">
        Webhooks let external users or apps post messages to a channel via a public URL.
      </p>

      <form onSubmit={handleCreate} className="flex gap-2">
        <select
          value={newChannelId}
          onChange={(e) => setNewChannelId(e.target.value ? Number(e.target.value) : "")}
          className="px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white focus:outline-none focus:border-indigo-500"
        >
          <option value="">Select channel</option>
          {textChannels.map((ch) => (
            <option key={ch.id} value={ch.id}>#{ch.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Webhook name"
          maxLength={100}
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={!newName.trim() || newChannelId === ""}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded transition-colors"
        >
          Create
        </button>
      </form>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : webhooks.length === 0 ? (
        <p className="text-zinc-500 text-sm">No webhooks configured</p>
      ) : (
        <div className="space-y-2">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="px-3 py-3 rounded bg-zinc-800/50 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <span className="text-sm text-zinc-200 font-medium">{wh.name}</span>
                  <span className="text-xs text-zinc-500 ml-2">#{wh.channel_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Enabled toggle */}
                  <button
                    onClick={() => handleToggle(wh.id)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${
                      wh.enabled ? "bg-emerald-600" : "bg-zinc-600"
                    }`}
                    title={wh.enabled ? "Enabled" : "Disabled"}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                        wh.enabled ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                  {/* Delete */}
                  {confirmDelete === wh.id ? (
                    <button
                      onClick={() => handleDelete(wh.id)}
                      onMouseLeave={() => setConfirmDelete(null)}
                      className="text-red-400 text-xs px-1 animate-pulse"
                    >
                      Confirm?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(wh.id)}
                      className="text-zinc-600 hover:text-red-400 text-xs transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyUrl(wh.id, "form")}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Copy Form URL
                </button>
                <span className="text-zinc-700">|</span>
                <button
                  onClick={() => copyUrl(wh.id, "api")}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Copy API URL
                </button>
                <span className="text-xs text-zinc-600 ml-auto">
                  by {wh.created_by.split(":")[0].replace("@", "")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InviteUserTab({ serverId, accessToken }: { serverId: string; accessToken: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [members, setMembers] = useState<ServerMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  // Load current members to filter them out
  useEffect(() => {
    listMembers(serverId, accessToken)
      .then(setMembers)
      .catch(() => {});
  }, [serverId, accessToken]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchUsers(query, accessToken);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, accessToken]);

  const memberIds = new Set(members.map((m) => m.user_id));
  const filteredResults = results.filter((u) => !memberIds.has(u.user_id));

  const handleInvite = async (userId: string) => {
    setSending(userId);
    try {
      await sendDirectInvite(serverId, userId, accessToken);
      const name = userId.split(":")[0].replace("@", "");
      addToast(`Invite sent to ${name}`, "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-semibold text-white">Invite User</h3>
      <p className="text-xs text-zinc-500">
        Search for registered users to invite directly to this server.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search users..."
        className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
      />

      {loading ? (
        <p className="text-zinc-500 text-sm">Searching...</p>
      ) : filteredResults.length === 0 ? (
        <p className="text-zinc-500 text-sm">
          {results.length > 0 && filteredResults.length === 0
            ? "All matching users are already members"
            : query
              ? "No users found"
              : "Start typing to search"}
        </p>
      ) : (
        <div className="space-y-1">
          {filteredResults.map((user) => {
            const name = user.display_name || user.user_id.split(":")[0].replace("@", "");
            return (
              <div
                key={user.user_id}
                className="flex items-center justify-between px-3 py-2 rounded bg-zinc-800/50"
              >
                <div className="min-w-0">
                  <span className="text-sm text-zinc-200">{name}</span>
                  {user.display_name && (
                    <span className="text-xs text-zinc-500 ml-2">{user.user_id}</span>
                  )}
                </div>
                <button
                  onClick={() => handleInvite(user.user_id)}
                  disabled={sending === user.user_id}
                  className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white rounded transition-colors"
                >
                  {sending === user.user_id ? "..." : "Invite"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
