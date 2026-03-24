import { useState, useEffect, useCallback } from "react";
import { useServerStore } from "../../stores/server";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { discoverServers, joinServer } from "../../api/concord";
import type { ServerDiscoverResult } from "../../api/concord";

type Tab = "browse" | "create";

interface Props {
  onClose: () => void;
}

export function NewServerModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("create");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-800 rounded-lg w-full max-w-md border border-zinc-700 shadow-xl">
        {/* Tabs */}
        <div className="flex border-b border-zinc-700">
          <button
            onClick={() => setTab("create")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === "create"
                ? "text-white border-b-2 border-indigo-500"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Create New
          </button>
          <button
            onClick={() => setTab("browse")}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === "browse"
                ? "text-white border-b-2 border-indigo-500"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Browse Public
          </button>
        </div>

        <div className="p-4">
          {tab === "create" ? (
            <CreateTab onClose={onClose} />
          ) : (
            <BrowseTab onClose={onClose} />
          )}
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateTab({ onClose }: { onClose: () => void }) {
  const createServer = useServerStore((s) => s.createServer);
  const accessToken = useAuthStore((s) => s.accessToken);
  const addToast = useToastStore((s) => s.addToast);

  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !accessToken) return;
    setCreating(true);
    try {
      await createServer(name.trim(), accessToken, {
        visibility,
        abbreviation: abbreviation || undefined,
      });
      addToast("Server created", "success");
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to create server");
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleCreate} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Server Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Server"
          autoFocus
          maxLength={100}
          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Abbreviation
          <span className="text-zinc-500 font-normal ml-1">(optional, 3 chars max)</span>
        </label>
        <input
          type="text"
          value={abbreviation}
          onChange={(e) => setAbbreviation(e.target.value.slice(0, 3))}
          maxLength={3}
          placeholder={name ? name.charAt(0).toUpperCase() : ""}
          className="w-24 px-3 py-2 bg-zinc-900 border border-zinc-600 rounded text-sm text-white text-center placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Visibility
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setVisibility("private")}
            className={`flex-1 py-2 rounded text-sm transition-colors ${
              visibility === "private"
                ? "bg-zinc-700 text-white"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Private
          </button>
          <button
            type="button"
            onClick={() => setVisibility("public")}
            className={`flex-1 py-2 rounded text-sm transition-colors ${
              visibility === "public"
                ? "bg-zinc-700 text-white"
                : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Public
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={!name.trim() || creating}
        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded transition-colors"
      >
        {creating ? "Creating..." : "Create Server"}
      </button>
    </form>
  );
}

function BrowseTab({ onClose }: { onClose: () => void }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const loadServers = useServerStore((s) => s.loadServers);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const addToast = useToastStore((s) => s.addToast);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ServerDiscoverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await discoverServers(query, accessToken);
      setResults(data);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [query, accessToken, addToast]);

  // Search on mount and when query changes (with debounce)
  useEffect(() => {
    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleJoin = async (serverId: string) => {
    if (!accessToken) return;
    setJoining(serverId);
    try {
      await joinServer(serverId, accessToken);
      await loadServers(accessToken);
      setActiveServer(serverId);
      addToast("Joined server!", "success");
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search public servers..."
        autoFocus
        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
      />

      <div className="max-h-64 overflow-y-auto space-y-1">
        {loading ? (
          <p className="text-zinc-500 text-sm text-center py-4">Searching...</p>
        ) : results.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-4">
            No public servers found
          </p>
        ) : (
          results.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between px-3 py-2 rounded bg-zinc-900/50 hover:bg-zinc-700/50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-400 flex-shrink-0">
                  {s.abbreviation || s.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{s.name}</p>
                  <p className="text-xs text-zinc-500">
                    {s.member_count} {s.member_count === 1 ? "member" : "members"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleJoin(s.id)}
                disabled={joining === s.id}
                className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white rounded transition-colors flex-shrink-0"
              >
                {joining === s.id ? "..." : "Join"}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
