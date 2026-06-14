import { useAvatarUrl, usePresence } from "../../hooks/usePresence";
import type { PresenceState } from "../../hooks/usePresence";
import { useTOTPUsers } from "../../hooks/useTOTPUsers";

// Deterministic fallback color from userId hash
const COLORS = [
  "bg-primary",
  "bg-secondary-container",
  "bg-tertiary",
  "bg-rose-600",
  "bg-cyan-600",
  "bg-violet-600",
  "bg-orange-600",
  "bg-teal-600",
];

function hashColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

const sizeClasses = {
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-16 h-16 text-xl",
} as const;

const dotSizes = {
  sm: "w-2 h-2 border",
  md: "w-2.5 h-2.5 border-[1.5px]",
  lg: "w-4 h-4 border-2",
} as const;

const presenceColors: Record<PresenceState, string> = {
  online: "bg-secondary",
  unavailable: "bg-primary",
  offline: "bg-on-surface-variant/50",
};

interface AvatarProps {
  userId: string;
  size?: "sm" | "md" | "lg";
  showPresence?: boolean;
}

export function Avatar({ userId, size = "md", showPresence = false }: AvatarProps) {
  const avatarUrl = useAvatarUrl(userId);
  const presence = usePresence(showPresence ? userId : null);
  const totpUsers = useTOTPUsers();
  const initial = (userId.split(":")[0].replace("@", "") || "?")
    .charAt(0)
    .toUpperCase();

  // TOTP-authorized users get their dot on the left side
  const isAuthorized = totpUsers.has(userId);
  const dotPosition = isAuthorized
    ? "-bottom-0.5 -left-0.5"
    : "-bottom-0.5 -right-0.5";

  return (
    <div className="relative inline-flex flex-shrink-0">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          className={`${sizeClasses[size]} rounded-full object-cover`}
        />
      ) : (
        <div
          className={`${sizeClasses[size]} ${hashColor(userId)} rounded-full flex items-center justify-center font-bold text-on-surface`}
        >
          {initial}
        </div>
      )}
      {showPresence && (
        <div
          className={`absolute ${dotPosition} ${dotSizes[size]} ${presenceColors[presence]} rounded-full border-surface`}
        />
      )}
    </div>
  );
}
