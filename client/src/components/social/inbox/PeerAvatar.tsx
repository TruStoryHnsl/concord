/**
 * Component: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * A self-contained avatar for a libp2p peer. The Matrix-coupled
 * `components/ui/Avatar` resolves presence/avatars from the homeserver; a
 * p2p peer has neither, so this derives a deterministic color + initials
 * from the base58 peer id alone. Keeps the inbox surface independent of the
 * Matrix identity stack.
 */

const COLORS = [
  "bg-primary",
  "bg-secondary-container",
  "bg-tertiary",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-violet-600",
  "bg-orange-600",
  "bg-teal-600",
] as const;

function hashIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % COLORS.length;
}

/** First two visually-distinct chars of a label/peer id, upper-cased. */
function initials(label: string, peerId: string): string {
  const source = label.trim() || peerId;
  // For a base58 peer id (no label) the leading chars are a constant
  // multihash prefix, so sample from the tail for more visual spread.
  const basis = label.trim() ? source : source.slice(-2);
  return basis.slice(0, 2).toUpperCase();
}

interface Props {
  peerId: string;
  label?: string | null;
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "w-6 h-6 text-[10px]",
  md: "w-9 h-9 text-xs",
  lg: "w-12 h-12 text-sm",
} as const;

export function PeerAvatar({ peerId, label, size = "md" }: Props) {
  const color = COLORS[hashIndex(peerId)];
  return (
    <div
      className={`${sizeClasses[size]} ${color} rounded-full flex items-center justify-center font-label font-semibold text-on-primary shrink-0`}
      title={label || peerId}
    >
      {initials(label ?? "", peerId)}
    </div>
  );
}
