import { useEffect, useState } from "react";
import type { MemberPayload, ServerPayload, TrustInfo } from "@/api/tauri";
import { getPeerTrust } from "@/api/tauri";
import GlassPanel from "@/components/ui/GlassPanel";
import TrustBadge from "@/components/ui/TrustBadge";
import { shortenPeerId } from "@/utils/format";

interface MemberListProps {
  server: ServerPayload;
  members: MemberPayload[];
}

function MemberList({ server, members }: MemberListProps) {
  const owner = members.find((m) => m.peerId === server.ownerId);
  const otherMembers = members.filter((m) => m.peerId !== server.ownerId);
  const [trustMap, setTrustMap] = useState<Record<string, TrustInfo>>({});

  useEffect(() => {
    if (members.length === 0) return;
    Promise.all(
      members.map((m) =>
        getPeerTrust(m.peerId).then((t) => [m.peerId, t] as const).catch(() => null),
      ),
    ).then((results) => {
      const map: Record<string, TrustInfo> = {};
      for (const r of results) {
        if (r) map[r[0]] = r[1];
      }
      setTrustMap(map);
    });
  }, [members]);

  return (
    <GlassPanel className="rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-lg">
            group
          </span>
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
            Members
          </span>
        </div>
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-secondary/15 text-secondary text-[11px] font-label font-semibold">
          {members.length}
        </span>
      </div>

      {/* Owner */}
      {owner && (
        <div>
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant px-1 mb-1 block">
            Owner
          </span>
          <MemberItem member={owner} isOwner trust={trustMap[owner.peerId]} />
        </div>
      )}

      {/* Members */}
      {otherMembers.length > 0 && (
        <div>
          <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant px-1 mb-1 block">
            Members — {otherMembers.length}
          </span>
          <div className="space-y-0.5">
            {otherMembers.map((member) => (
              <MemberItem key={member.peerId} member={member} trust={trustMap[member.peerId]} />
            ))}
          </div>
        </div>
      )}

      {members.length === 0 && (
        <div className="flex flex-col items-center py-4 text-center space-y-2">
          <span className="material-symbols-outlined text-2xl text-on-surface-variant/40">
            person_off
          </span>
          <p className="text-xs text-on-surface-variant font-body">
            No members loaded
          </p>
        </div>
      )}
    </GlassPanel>
  );
}

function MemberItem({
  member,
  isOwner = false,
  trust,
}: {
  member: MemberPayload;
  isOwner?: boolean;
  trust?: TrustInfo;
}) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-container/50 transition-colors">
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 shrink-0">
        <span className="material-symbols-outlined text-primary text-sm">
          {isOwner ? "shield" : "person"}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-label font-medium text-on-surface truncate">
          {shortenPeerId(member.peerId)}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-on-surface-variant font-body capitalize">
            {member.role}
          </span>
          {trust && <TrustBadge level={trust.badge} size="sm" showLabel={false} />}
        </div>
      </div>
      <span className="w-2 h-2 rounded-full bg-secondary shrink-0" />
    </div>
  );
}

export default MemberList;
