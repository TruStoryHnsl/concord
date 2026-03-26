import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";
import { joinServer } from "@/api/tauri";
import { useServersStore } from "@/stores/servers";

interface JoinServerModalProps {
  onClose: () => void;
}

function JoinServerModal({ onClose }: JoinServerModalProps) {
  const navigate = useNavigate();
  const addServer = useServersStore((s) => s.addServer);

  const [inviteCode, setInviteCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = useCallback(async () => {
    const trimmed = inviteCode.trim();
    if (!trimmed) {
      setError("Please enter an invite code");
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const server = await joinServer(trimmed);
      addServer(server);
      onClose();
      navigate(`/server/${server.id}`);
    } catch (err) {
      console.error("Failed to join server:", err);
      setError(
        err instanceof Error ? err.message : "Failed to join server",
      );
      setJoining(false);
    }
  }, [inviteCode, addServer, onClose, navigate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm">
      <GlassPanel className="w-full max-w-md p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-secondary text-xl">
              login
            </span>
            <h2 className="font-headline font-bold text-lg text-on-surface">
              Join a Server
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        <p className="text-sm text-on-surface-variant font-body">
          Enter a node address or invite code to join an existing server.
        </p>

        {/* Invite Code Input */}
        <div className="space-y-2">
          <label className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Invite Code
          </label>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleJoin();
            }}
            placeholder="knode-tx-992-delta"
            className="w-full px-4 py-2.5 rounded-xl bg-surface-container border-none text-on-surface placeholder:text-on-surface-variant/50 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
            autoFocus
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-error-container/20 border border-error/20">
            <span className="material-symbols-outlined text-error text-base">
              error
            </span>
            <p className="text-xs text-on-error-container font-body">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleJoin}
            disabled={joining || !inviteCode.trim()}
          >
            {joining ? (
              <>
                <span className="material-symbols-outlined text-lg animate-spin">
                  progress_activity
                </span>
                Joining...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-lg">
                  login
                </span>
                Join Server
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </GlassPanel>
    </div>
  );
}

export default JoinServerModal;
