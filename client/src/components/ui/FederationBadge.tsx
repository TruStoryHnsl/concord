import { getServerFromUserId } from "../../hooks/useFederation";

interface FederationBadgeProps {
  userId: string;
  localServer: string;
  compact?: boolean; // true = small dot only, false = full server name
}

/**
 * Shows a visual badge for users from federated (remote) Concord instances.
 * Returns null for local users — no visual noise.
 */
export function FederationBadge({ userId, localServer, compact = false }: FederationBadgeProps) {
  const userServer = getServerFromUserId(userId);
  if (!localServer || !userServer || userServer === localServer) return null;

  if (compact) {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-tertiary/70 flex-shrink-0"
        title={`Federated: ${userServer}`}
      />
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-tertiary/10 text-tertiary text-[10px] font-label font-medium flex-shrink-0"
      title={`This user is from ${userServer}`}
    >
      <span className="material-symbols-outlined" style={{ fontSize: "11px" }}>
        language
      </span>
      {userServer}
    </span>
  );
}
