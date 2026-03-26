import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";
import TrustBadge from "@/components/ui/TrustBadge";
import { useAuthStore } from "@/stores/auth";
import { getPeerTrust } from "@/api/tauri";
import type { TrustInfo } from "@/api/tauri";


function ProfilePage() {
  const peerId = useAuthStore((s) => s.peerId);
  const displayName = useAuthStore((s) => s.displayName);
  const [trustInfo, setTrustInfo] = useState<TrustInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!peerId) return;
    void getPeerTrust(peerId).then(setTrustInfo).catch(() => {});
  }, [peerId]);

  const copyDid = useCallback(() => {
    if (!peerId) return;
    void navigator.clipboard.writeText(peerId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [peerId]);

  return (
    <div className="mesh-background min-h-full p-6">
      <div className="relative z-10 max-w-4xl mx-auto space-y-6">
        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Left column — Identity card */}
          <div className="space-y-5">
            <GlassPanel className="p-6 flex flex-col items-center space-y-4">
              {/* Avatar with gradient border */}
              <div className="relative">
                <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-primary to-secondary p-[3px]">
                  <div className="w-full h-full rounded-full bg-surface-container-highest flex items-center justify-center">
                    <span className="material-symbols-outlined text-5xl text-on-surface-variant">
                      account_circle
                    </span>
                  </div>
                </div>
                {/* Online indicator */}
                <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-secondary border-2 border-surface" />
              </div>

              {/* Display name */}
              <div className="text-center space-y-1.5">
                <h1 className="font-headline font-bold text-2xl text-on-surface">
                  {displayName ?? "Anonymous Node"}
                </h1>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm text-on-surface-variant font-body">
                    Node Operator
                  </span>
                  {trustInfo && (
                    <TrustBadge level={trustInfo.badge} size="sm" />
                  )}
                </div>
              </div>

              {/* DID / Peer ID display */}
              <button
                onClick={copyDid}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors group"
              >
                <span className="material-symbols-outlined text-sm text-on-surface-variant">
                  fingerprint
                </span>
                <span className="flex-1 text-left font-mono text-xs text-on-surface-variant truncate">
                  {peerId ?? "No identity"}
                </span>
                <span className="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-primary transition-colors">
                  {copied ? "check" : "content_copy"}
                </span>
              </button>

              {/* Action buttons */}
              <div className="flex items-center gap-3 w-full">
                <Button variant="primary" className="flex-1">
                  <span className="material-symbols-outlined text-lg">edit</span>
                  Edit Profile
                </Button>
                <Link to="/settings">
                  <button className="flex items-center justify-center w-11 h-11 rounded-xl border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors">
                    <span className="material-symbols-outlined text-xl">
                      settings
                    </span>
                  </button>
                </Link>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 w-full pt-2">
                <div className="text-center p-3 rounded-lg bg-surface-container">
                  <span className="material-symbols-outlined text-lg text-primary mb-1 block">
                    dns
                  </span>
                  <p className="font-headline font-bold text-xl text-on-surface">
                    14
                  </p>
                  <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">
                    Nodes Hosted
                  </p>
                </div>
                <div className="text-center p-3 rounded-lg bg-surface-container">
                  <span className="material-symbols-outlined text-lg text-secondary mb-1 block">
                    group
                  </span>
                  <p className="font-headline font-bold text-xl text-on-surface">
                    128
                  </p>
                  <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">
                    Servers Joined
                  </p>
                </div>
              </div>
            </GlassPanel>
          </div>

          {/* Right column — Details */}
          <div className="space-y-5">
            {/* Bio section */}
            <GlassPanel className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">
                  description
                </span>
                <h2 className="font-headline font-semibold text-lg text-on-surface">
                  Node Identity & Bio
                </h2>
              </div>
              <p className="text-sm text-on-surface-variant font-body leading-relaxed">
                Architect of decentralized systems and privacy-first
                communications. Currently maintaining the #open-mesh
                backbone.
              </p>
              {/* Interest tags */}
              <div className="flex flex-wrap gap-2">
                {["P2P Networks", "Cryptography", "Mesh Routing", "Privacy"].map(
                  (tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-label font-medium"
                    >
                      {tag}
                    </span>
                  ),
                )}
              </div>
            </GlassPanel>

            {/* Authorized Nodes & Devices */}
            <GlassPanel className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-lg">
                  devices
                </span>
                <h2 className="font-headline font-semibold text-lg text-on-surface">
                  Authorized Nodes & Devices
                </h2>
              </div>
              <div className="space-y-2">
                <DeviceRow
                  icon="desktop_windows"
                  name="Workstation Pro"
                  detail="Linux x86_64"
                  status="online"
                />
                <DeviceRow
                  icon="phone_android"
                  name="Mobile Node 01"
                  detail="Android 14"
                  status="online"
                />
                <DeviceRow
                  icon="laptop"
                  name="Laptop Relay"
                  detail="macOS ARM"
                  status="offline"
                />
              </div>
            </GlassPanel>

            {/* Security section */}
            <GlassPanel className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">
                  shield
                </span>
                <h2 className="font-headline font-semibold text-lg text-on-surface">
                  Security
                </h2>
              </div>

              {/* Trust level display */}
              {trustInfo && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-surface-container">
                  <div className="space-y-0.5">
                    <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">
                      Trust Level
                    </p>
                    <div className="flex items-center gap-2">
                      <TrustBadge level={trustInfo.badge} size="md" />
                      <span className="text-sm text-on-surface-variant font-body">
                        Score: {trustInfo.score}
                      </span>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-sm font-headline font-semibold text-on-surface">
                      {trustInfo.attestationCount}
                    </p>
                    <p className="text-[10px] text-on-surface-variant font-label">
                      Attestations
                    </p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1">
                  <span className="material-symbols-outlined text-lg">key</span>
                  Manage Keys
                </Button>
                <Button variant="secondary" className="flex-1">
                  <span className="material-symbols-outlined text-lg">
                    history
                  </span>
                  Audit Logs
                </Button>
              </div>
            </GlassPanel>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Device Row ───────────────────────────────────────────── */

function DeviceRow({
  icon,
  name,
  detail,
  status,
}: {
  icon: string;
  name: string;
  detail: string;
  status: "online" | "offline";
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-container/50 hover:bg-surface-container-high/50 transition-colors">
      <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-surface-container-high">
        <span className="material-symbols-outlined text-on-surface-variant text-lg">
          {icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-label font-medium text-on-surface truncate">
          {name}
        </p>
        <p className="text-[11px] text-on-surface-variant font-body">
          {detail}
        </p>
      </div>
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${status === "online" ? "bg-secondary" : "bg-on-surface-variant/40"}`}
      />
    </div>
  );
}

export default ProfilePage;
