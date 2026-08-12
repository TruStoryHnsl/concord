import type { CSSProperties, ReactNode } from "react";
import { ConcordLogo } from "../brand/ConcordLogo";
import { SourceBrandIcon, inferSourceBrand } from "../sources/sourceBrand";
import type { ConcordSource } from "../../stores/sources";

type PresenceState = "online" | "away" | "offline";

type BaseConversationRow = {
  id: string;
  name: string;
  preview?: string;
  timestamp?: string;
  unreadCount?: number;
  selected?: boolean;
  muted?: boolean;
  pinned?: boolean;
  onClick: () => void;
};

export type PeerConversationRow = BaseConversationRow & {
  kind: "peer" | "dm";
  userId?: string;
  avatarUrl?: string;
  presence?: PresenceState;
  federationLabel?: string;
};

export type DockerConversationRow = BaseConversationRow & {
  kind: "docker";
  source: Pick<
    ConcordSource,
    "host" | "instanceName" | "serverName" | "platform" | "status" | "branding"
  >;
};

export type LocalConversationRow = BaseConversationRow & {
  kind: "local";
  localLabel?: string;
};

export type ConversationRowProps =
  | PeerConversationRow
  | DockerConversationRow
  | LocalConversationRow;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? words[1]?.[0] : undefined;
  return `${first}${second ?? ""}`.toUpperCase();
}

function unreadLabel(count: number) {
  return count > 99 ? "99+" : String(count);
}

function presenceClass(presence?: PresenceState) {
  if (presence === "online") return "bg-secondary";
  if (presence === "away") return "bg-primary";
  return "bg-on-surface-variant/50";
}

function AvatarFrame({
  children,
  badge,
  className,
  style,
}: {
  children: ReactNode;
  badge?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className="relative inline-flex h-11 w-11 flex-shrink-0" style={style}>
      <span
        className={cx(
          "flex h-11 w-11 items-center justify-center overflow-hidden rounded-full",
          "ring-1 ring-[var(--edge-subtle)]",
          className,
        )}
      >
        {children}
      </span>
      {badge}
    </span>
  );
}

function PeerAvatar({
  name,
  avatarUrl,
  presence,
}: {
  name: string;
  avatarUrl?: string;
  presence?: PresenceState;
}) {
  return (
    <AvatarFrame
      className={cx(
        avatarUrl ? "bg-surface-container" : "bg-primary text-on-primary",
      )}
      badge={
        presence ? (
          <span
            className={cx(
              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-[1.5px] border-surface",
              presenceClass(presence),
            )}
          />
        ) : undefined
      }
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-label text-sm font-bold">{initials(name)}</span>
      )}
    </AvatarFrame>
  );
}

function LocalAvatar() {
  return (
    <AvatarFrame className="bg-secondary/10 ring-secondary/25">
      <ConcordLogo size={30} />
    </AvatarFrame>
  );
}

function DockerAvatar({ source }: { source: DockerConversationRow["source"] }) {
  const brand = inferSourceBrand(source);
  const primary = source.branding?.primaryColor ?? "var(--color-primary)";
  const accent = source.branding?.accentColor ?? "var(--color-secondary)";
  const ringStyle = {
    "--home-row-primary": primary,
    "--home-row-accent": accent,
    boxShadow:
      "0 0 0 2px color-mix(in srgb, var(--home-row-accent) 72%, transparent), 0 0 0 5px color-mix(in srgb, var(--home-row-accent) 16%, transparent)",
  } as CSSProperties;

  return (
    <AvatarFrame
      className="bg-[color-mix(in_srgb,var(--home-row-primary)_18%,var(--color-surface-container-high))]"
      style={ringStyle}
      badge={
        <span className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full border border-surface bg-surface-container-highest text-[13px] text-secondary shadow-sm">
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 13, lineHeight: 1 }}
            aria-hidden="true"
          >
            domain
          </span>
        </span>
      }
    >
      {source.branding?.logoUrl ? (
        <img
          src={source.branding.logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-7 w-7 rounded-full object-cover"
        />
      ) : (
        <SourceBrandIcon
          brand={brand}
          size={28}
          color={source.branding?.accentColor}
        />
      )}
    </AvatarFrame>
  );
}

function RowAvatar(props: ConversationRowProps) {
  if (props.kind === "docker") return <DockerAvatar source={props.source} />;
  if (props.kind === "local") return <LocalAvatar />;
  return (
    <PeerAvatar
      name={props.name}
      avatarUrl={props.avatarUrl}
      presence={props.presence}
    />
  );
}

function rowMeta(props: ConversationRowProps) {
  if (props.kind === "docker") {
    if (props.source.status === "connected") return "SOURCE";
    return props.source.status.toUpperCase();
  }
  if (props.kind === "local") return props.localLabel ?? "LOCAL";
  if (props.federationLabel) return props.federationLabel;
  return undefined;
}

export function ConversationRow(props: ConversationRowProps) {
  const unreadCount = props.unreadCount ?? 0;
  const hasUnread = unreadCount > 0;
  const meta = rowMeta(props);

  return (
    <button
      type="button"
      onClick={props.onClick}
      data-conversation-kind={props.kind}
      className={cx(
        "btn-press group grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all",
        props.selected
          ? "bg-primary/10 text-primary shadow-[inset_3px_0_0_color-mix(in_srgb,var(--color-primary)_75%,transparent)]"
          : "text-on-surface hover:bg-surface-container-high",
        props.kind === "docker" &&
          !props.selected &&
          "hover:bg-[color-mix(in_srgb,var(--color-secondary)_10%,var(--color-surface-container-high))]",
      )}
    >
      <RowAvatar {...props} />

      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-label text-sm font-semibold">
            {props.name}
          </span>
          {props.pinned && (
            <span
              className="material-symbols-outlined flex-shrink-0 text-[14px] text-on-surface-variant/70"
              aria-label="Pinned"
              title="Pinned"
            >
              push_pin
            </span>
          )}
          {meta && (
            <span className="text-overline flex-shrink-0 text-[10px] leading-none text-on-surface-variant/70">
              {meta}
            </span>
          )}
        </span>
        <span
          className={cx(
            "mt-0.5 block truncate font-body text-xs",
            hasUnread && !props.selected
              ? "font-semibold text-on-surface"
              : "text-on-surface-variant",
            props.muted && "text-on-surface-variant/60",
          )}
        >
          {props.preview ?? "No messages yet"}
        </span>
      </span>

      <span className="flex min-w-[2.75rem] flex-col items-end gap-1 self-stretch py-0.5">
        {props.timestamp && (
          <time className="font-label text-[11px] text-on-surface-variant tabular-nums">
            {props.timestamp}
          </time>
        )}
        {hasUnread && !props.selected && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-label text-[11px] font-bold leading-none text-on-primary tabular-nums">
            {unreadLabel(unreadCount)}
          </span>
        )}
        {props.muted && !hasUnread && (
          <span
            className="material-symbols-outlined text-[14px] text-on-surface-variant/60"
            aria-label="Muted"
            title="Muted"
          >
            notifications_off
          </span>
        )}
      </span>
    </button>
  );
}
