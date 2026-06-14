import { useState, useEffect } from "react";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { createInvite, sendEmailInvite, checkEmailAvailable } from "../../api/concord";

interface Props {
  serverId: string;
  onClose: () => void;
}

export function InviteModal({ serverId, onClose }: Props) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const addToast = useToastStore((s) => s.addToast);
  const [emailAvailable, setEmailAvailable] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    checkEmailAvailable()
      .then((r) => setEmailAvailable(r.available))
      .catch(() => {});
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-container rounded-lg w-full max-w-md border border-outline-variant/15 shadow-xl">
        <div className="p-4 border-b border-outline-variant/15 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-on-surface">Invite People</h2>
          <button
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-5">
          {accessToken && (
            <>
              {emailAvailable && (
                <>
                  <EmailInviteSection serverId={serverId} accessToken={accessToken} addToast={addToast} />
                  <div className="border-t border-outline-variant/15" />
                </>
              )}
              <PermanentLinkSection serverId={serverId} accessToken={accessToken} addToast={addToast} />
              <div className="border-t border-outline-variant/15" />
              <ExpiringLinkSection serverId={serverId} accessToken={accessToken} addToast={addToast} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailInviteSection({
  serverId,
  accessToken,
  addToast,
}: {
  serverId: string;
  accessToken: string;
  addToast: (msg: string, type?: "info" | "success" | "error") => void;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!email.trim()) return;
    setSending(true);
    try {
      await sendEmailInvite(serverId, email.trim(), accessToken);
      addToast(`Invite sent to ${email}`, "success");
      setEmail("");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to send", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-on-surface mb-2">Send via Email</h3>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="friend@example.com"
          className="flex-1 px-3 py-2 bg-surface border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button
          onClick={send}
          disabled={sending || !email.trim()}
          className="px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded transition-colors"
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </div>
      <p className="text-xs text-on-surface-variant mt-1">Sends a single-use invite link (expires in 7 days)</p>
    </div>
  );
}

function PermanentLinkSection({
  serverId,
  accessToken,
  addToast,
}: {
  serverId: string;
  accessToken: string;
  addToast: (msg: string, type?: "info" | "success" | "error") => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const invite = await createInvite(serverId, accessToken, {
        permanent: true,
      });
      setLink(`${window.location.origin}?invite=${invite.token}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast("Failed to copy");
    }
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-on-surface mb-2">Permanent Link</h3>
      {link ? (
        <div className="flex gap-2">
          <code className="flex-1 text-xs text-primary bg-surface px-3 py-2 rounded truncate">
            {link}
          </code>
          <button
            onClick={copy}
            className={`px-3 py-2 text-xs rounded transition-colors ${
              copied
                ? "bg-secondary/10 text-secondary"
                : "bg-surface-container-highest text-on-surface hover:bg-surface-bright"
            }`}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={generating}
          className="px-4 py-2 bg-surface-container-highest hover:bg-surface-bright disabled:opacity-40 text-on-surface text-sm rounded transition-colors"
        >
          {generating ? "Generating..." : "Generate Permanent Link"}
        </button>
      )}
      <p className="text-xs text-on-surface-variant mt-1">This link never expires</p>
    </div>
  );
}

function ExpiringLinkSection({
  serverId,
  accessToken,
  addToast,
}: {
  serverId: string;
  accessToken: string;
  addToast: (msg: string, type?: "info" | "success" | "error") => void;
}) {
  const [duration, setDuration] = useState(24); // hours
  const [maxUses, setMaxUses] = useState(10);
  const [link, setLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const invite = await createInvite(serverId, accessToken, {
        expires_in_hours: duration,
        max_uses: maxUses,
      });
      setLink(`${window.location.origin}?invite=${invite.token}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast("Failed to copy");
    }
  };

  const durations = [
    { label: "1 hour", value: 1 },
    { label: "24 hours", value: 24 },
    { label: "7 days", value: 168 },
  ];

  return (
    <div>
      <h3 className="text-sm font-medium text-on-surface mb-2">Expiring Link</h3>

      {link ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <code className="flex-1 text-xs text-primary bg-surface px-3 py-2 rounded truncate">
              {link}
            </code>
            <button
              onClick={copy}
              className={`px-3 py-2 text-xs rounded transition-colors ${
                copied
                  ? "bg-secondary/10 text-secondary"
                  : "bg-surface-container-highest text-on-surface hover:bg-surface-bright"
              }`}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setLink(null)}
            className="text-xs text-on-surface-variant hover:text-on-surface"
          >
            Generate another
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-on-surface-variant mb-1 block">Duration</label>
            <div className="flex gap-1">
              {durations.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDuration(d.value)}
                  className={`flex-1 py-1.5 text-xs rounded transition-colors ${
                    duration === d.value
                      ? "bg-surface-container-highest text-on-surface"
                      : "bg-surface text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-on-surface-variant mb-1 block">Max Uses</label>
            <input
              type="number"
              value={maxUses}
              onChange={(e) => setMaxUses(Math.max(1, Math.min(1000, Number(e.target.value))))}
              min={1}
              max={1000}
              className="w-24 px-3 py-1.5 bg-surface border border-outline-variant rounded text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>

          <button
            onClick={generate}
            disabled={generating}
            className="px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded transition-colors"
          >
            {generating ? "Generating..." : "Generate Link"}
          </button>
        </div>
      )}
    </div>
  );
}
