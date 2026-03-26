import type { TrustLevel } from "@/api/tauri";

interface TrustBadgeProps {
  level: TrustLevel;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

const BADGE_CONFIG: Record<
  TrustLevel,
  { icon: string; label: string; color: string; bg: string; glow?: string }
> = {
  unverified: {
    icon: "help_outline",
    label: "Unverified",
    color: "text-on-surface-variant",
    bg: "bg-surface-container-high border-outline-variant/30",
  },
  recognized: {
    icon: "check_circle",
    label: "Recognized",
    color: "text-secondary/60",
    bg: "bg-secondary/5 border-secondary/20",
  },
  established: {
    icon: "verified",
    label: "Established",
    color: "text-secondary",
    bg: "bg-secondary/10 border-secondary/25",
  },
  trusted: {
    icon: "shield",
    label: "Trusted",
    color: "text-primary",
    bg: "bg-primary/10 border-primary/25",
  },
  backbone: {
    icon: "star",
    label: "Backbone",
    color: "text-primary",
    bg: "bg-primary/15 border-primary/30",
    glow: "shadow-[0_0_8px_rgba(164,165,255,0.4)]",
  },
};

const SIZE_CONFIG = {
  sm: { chip: "px-2 py-0.5 gap-1", icon: "text-xs", text: "text-[10px]" },
  md: { chip: "px-3 py-1 gap-1.5", icon: "text-sm", text: "text-xs" },
  lg: { chip: "px-4 py-1.5 gap-2", icon: "text-base", text: "text-sm" },
};

function TrustBadge({ level, size = "md", showLabel = true }: TrustBadgeProps) {
  const config = BADGE_CONFIG[level];
  const sizeConfig = SIZE_CONFIG[size];

  return (
    <span
      className={`inline-flex items-center rounded-full border font-label font-medium ${sizeConfig.chip} ${config.bg} ${config.color} ${config.glow ?? ""}`}
    >
      <span className={`material-symbols-outlined ${sizeConfig.icon}`}>
        {config.icon}
      </span>
      {showLabel && <span className={sizeConfig.text}>{config.label}</span>}
    </span>
  );
}

export default TrustBadge;
