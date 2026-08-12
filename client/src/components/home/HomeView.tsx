import type { ReactNode } from "react";
import { BringingUpSplash } from "../BringingUpSplash";
import { ConcordLogo } from "../brand/ConcordLogo";
import {
  ConversationRow,
  type ConversationRowProps,
} from "./ConversationRow";

export type HomeFilter = "all" | "people" | "sources" | "unread";

export interface HomeViewProps {
  conversations: ConversationRowProps[];
  selectedConversationId?: string;
  filter?: HomeFilter;
  query?: string;
  loading?: boolean;
  detail?: ReactNode;
  /** Phone only: when true, the detail pane (e.g. the native chat surface)
   *  takes the full screen and the list is hidden. Desktop always shows
   *  list + detail side by side. */
  phoneDetailActive?: boolean;
  dockerHeader?: {
    title: string;
    subtitle?: string;
    onBackHome: () => void;
  };
  onSelectConversation: (conversation: ConversationRowProps) => void;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: HomeFilter) => void;
  onNewConversation: () => void;
  onAddSource: () => void;
  onOpenSettings?: () => void;
  /** Native only: the active default (mesh) persona's display name, if any.
   *  Undefined = none set yet. Drives the Home-header persona chip. */
  personaLabel?: string;
  /** Native only: open the Identity/persona-management surface. */
  onOpenPersona?: () => void;
  /** Native only: toggle the Home-header overflow menu (mesh map, backup). */
  onOverflow?: () => void;
}

const FILTERS: Array<{ id: HomeFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "people", label: "People" },
  { id: "sources", label: "Sources" },
  { id: "unread", label: "Unread" },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function visibleForFilter(row: ConversationRowProps, filter: HomeFilter) {
  if (filter === "all") return true;
  if (filter === "people") return row.kind === "peer" || row.kind === "dm";
  if (filter === "sources") return row.kind === "docker" || row.kind === "local";
  return (row.unreadCount ?? 0) > 0;
}

function matchesQuery(row: ConversationRowProps, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = [row.name, row.preview].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(normalized);
}

function HomeEmptyState({
  onNewConversation,
  onAddSource,
}: {
  onNewConversation: () => void;
  onAddSource: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <ConcordLogo size={48} />
      <div className="space-y-1">
        <h2 className="font-headline text-base font-semibold text-on-surface">
          No conversations yet
        </h2>
        <p className="max-w-64 font-body text-sm text-on-surface-variant">
          Start a DM, pair a peer, or connect a source.
        </p>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onNewConversation}
          className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 font-label text-sm font-semibold text-on-primary"
        >
          <span className="material-symbols-outlined text-base">edit_square</span>
          New conversation
        </button>
        <button
          type="button"
          onClick={onAddSource}
          className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-surface-container-high px-3 font-label text-sm font-semibold text-on-surface hover:bg-surface-container-highest"
        >
          <span className="material-symbols-outlined text-base">add_link</span>
          Add source
        </button>
      </div>
    </div>
  );
}

function DetailEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <ConcordLogo size={56} />
      <div className="space-y-1">
        <h2 className="font-headline text-lg font-semibold text-on-surface">
          Select a conversation
        </h2>
        <p className="max-w-sm font-body text-sm text-on-surface-variant">
          People, your private space, and connected sources all start from Home.
        </p>
      </div>
    </div>
  );
}

type HomeListPanelProps = Omit<
  HomeViewProps,
  "detail" | "dockerHeader" | "filter" | "query" | "loading"
> & {
  filter: HomeFilter;
  query: string;
  loading: boolean;
};

function HomeListPanel({
  conversations,
  filter,
  query,
  loading,
  selectedConversationId,
  onSelectConversation,
  onQueryChange,
  onFilterChange,
  onNewConversation,
  onAddSource,
  onOpenSettings,
  personaLabel,
  onOpenPersona,
  onOverflow,
}: HomeListPanelProps) {
  const visibleConversations = conversations.filter(
    (row) => visibleForFilter(row, filter) && matchesQuery(row, query),
  );

  return (
    <aside className="flex h-full min-h-0 flex-col bg-surface-container-low text-on-surface md:border-r md:border-outline-variant/10">
      <header className="safe-top flex-shrink-0 border-b border-outline-variant/10 bg-surface-container-low">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ConcordLogo size={28} />
            <h1 className="truncate font-headline text-lg font-bold text-primary">
              Home
            </h1>
          </div>
          {onOpenPersona && (
            <button
              type="button"
              onClick={onOpenPersona}
              aria-label={
                personaLabel
                  ? `Mesh persona: ${personaLabel}. Manage identities`
                  : "Set a mesh persona"
              }
              title={
                personaLabel
                  ? `Mesh persona: ${personaLabel}`
                  : "Set a mesh persona"
              }
              className="btn-press flex h-9 min-w-0 max-w-[7.5rem] items-center gap-1.5 rounded-full bg-surface-container px-2.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface edge-hairline"
            >
              <span className="material-symbols-outlined flex-shrink-0 text-lg text-secondary">
                badge
              </span>
              <span className="truncate font-label text-xs font-semibold">
                {personaLabel ?? "Set persona"}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onNewConversation}
            aria-label="New conversation"
            title="New conversation"
            className="btn-press flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-xl">edit_square</span>
          </button>
          {onOverflow && (
            <button
              type="button"
              onClick={onOverflow}
              aria-label="More options"
              title="More options"
              className="btn-press flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-xl">more_vert</span>
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
              className="btn-press flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-xl">settings</span>
            </button>
          )}
        </div>

        <div className="space-y-2 px-4 pb-3">
          <label className="flex h-10 items-center gap-2 rounded-lg bg-surface-container px-3 text-on-surface edge-hairline">
            <span className="material-symbols-outlined text-lg text-on-surface-variant">
              search
            </span>
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search conversations"
              className="min-w-0 flex-1 bg-transparent font-body text-sm text-on-surface outline-none placeholder:text-on-surface-variant/60"
            />
          </label>

          <div className="flex items-center gap-1 rounded-lg bg-surface-container p-1">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onFilterChange(item.id)}
                className={cx(
                  "btn-press h-8 flex-1 rounded-md px-2 font-label text-xs font-semibold transition-colors",
                  filter === item.id
                    ? "bg-primary/15 text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex h-full items-center justify-center p-8">
            <BringingUpSplash size="compact" status="Loading conversations..." />
          </div>
        ) : visibleConversations.length === 0 ? (
          <HomeEmptyState
            onNewConversation={onNewConversation}
            onAddSource={onAddSource}
          />
        ) : (
          <div className="space-y-0.5">
            {visibleConversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                {...conversation}
                selected={conversation.id === selectedConversationId}
                onClick={() => onSelectConversation(conversation)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function DockerHandoffHeader({
  title,
  subtitle,
  onBackHome,
}: NonNullable<HomeViewProps["dockerHeader"]>) {
  return (
    <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-outline-variant/10 bg-surface-container-low px-3">
      <button
        type="button"
        onClick={onBackHome}
        aria-label="Back to Home"
        title="Back to Home"
        className="btn-press flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-xl">arrow_back</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate font-headline text-sm font-semibold text-on-surface">
          {title}
        </div>
        {subtitle && (
          <div className="truncate font-label text-xs text-on-surface-variant">
            {subtitle}
          </div>
        )}
      </div>
      <span className="text-overline rounded-md bg-secondary/15 px-2 py-1 text-[10px] leading-none text-secondary">
        Source
      </span>
    </div>
  );
}

export function HomeView({
  conversations,
  selectedConversationId,
  filter = "all",
  query = "",
  loading = false,
  detail,
  phoneDetailActive = false,
  dockerHeader,
  onSelectConversation,
  onQueryChange,
  onFilterChange,
  onNewConversation,
  onAddSource,
  onOpenSettings,
  personaLabel,
  onOpenPersona,
  onOverflow,
}: HomeViewProps) {
  const listPanel = (
    <HomeListPanel
      conversations={conversations}
      selectedConversationId={selectedConversationId}
      filter={filter}
      query={query}
      loading={loading}
      onSelectConversation={onSelectConversation}
      onQueryChange={onQueryChange}
      onFilterChange={onFilterChange}
      onNewConversation={onNewConversation}
      onAddSource={onAddSource}
      onOpenSettings={onOpenSettings}
      personaLabel={personaLabel}
      onOpenPersona={onOpenPersona}
      onOverflow={onOverflow}
    />
  );

  return (
    <div className="h-full w-full min-w-0 min-h-0 overflow-hidden bg-surface text-on-surface md:grid md:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
      <div
        className={cx(
          "h-full min-h-0 md:block",
          phoneDetailActive && "hidden",
        )}
      >
        {listPanel}
      </div>
      <main
        className={cx(
          "min-h-0 min-w-0 flex-col bg-surface md:flex",
          phoneDetailActive ? "flex" : "hidden",
        )}
      >
        {dockerHeader && <DockerHandoffHeader {...dockerHeader} />}
        <div className="min-h-0 flex-1">
          {detail ?? <DetailEmptyState />}
        </div>
      </main>
    </div>
  );
}
