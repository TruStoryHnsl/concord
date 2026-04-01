import { useState, useEffect, useCallback } from "react";
import { useAuthStore } from "../../stores/auth";
import { useDMStore } from "../../stores/dm";
import { useToastStore } from "../../stores/toast";
import { searchUsers } from "../../api/concord";
import type { UserSearchResult } from "../../api/concord";
import { Avatar } from "../ui/Avatar";

interface Props {
  onClose: () => void;
}

export function NewDMModal({ onClose }: Props) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const startDM = useDMStore((s) => s.startDM);
  const addToast = useToastStore((s) => s.addToast);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const search = useCallback(async () => {
    if (!accessToken || !query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchUsers(query, accessToken);
      setResults(data);
    } catch {
      // Silent — search is supplementary
    } finally {
      setLoading(false);
    }
  }, [query, accessToken]);

  useEffect(() => {
    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSelect = async (userId: string) => {
    if (!accessToken) return;
    setStarting(userId);
    try {
      await startDM(userId, accessToken);
      onClose();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to start DM");
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-container rounded-lg w-full max-w-md border border-outline-variant/15 shadow-xl">
        <div className="p-4 border-b border-outline-variant/15">
          <h3 className="text-sm font-headline font-bold text-on-surface mb-3">
            New Message
          </h3>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a user..."
            autoFocus
            className="w-full px-3 py-2 bg-surface border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-2">
          {loading ? (
            <p className="text-on-surface-variant text-sm text-center py-4">
              Searching...
            </p>
          ) : query.trim() && results.length === 0 ? (
            <p className="text-on-surface-variant text-sm text-center py-4">
              No users found
            </p>
          ) : !query.trim() ? (
            <p className="text-on-surface-variant text-sm text-center py-4">
              Type a name to search
            </p>
          ) : (
            results.map((user) => (
              <button
                key={user.user_id}
                onClick={() => handleSelect(user.user_id)}
                disabled={starting === user.user_id}
                className="btn-press w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50"
              >
                <Avatar userId={user.user_id} size="md" showPresence />
                <div className="text-left min-w-0 flex-1">
                  <p className="text-sm font-body font-medium text-on-surface truncate">
                    {user.display_name || user.user_id.split(":")[0].replace("@", "")}
                  </p>
                  <p className="text-xs text-on-surface-variant truncate">
                    {user.user_id}
                  </p>
                </div>
                {starting === user.user_id && (
                  <span className="inline-block w-4 h-4 border-2 border-outline-variant border-t-primary rounded-full animate-spin" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="px-4 pb-4 pt-2">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
