import type { ForumPost } from "@/api/tauri";
import { formatRelativeTime } from "@/utils/format";

interface ForumPostCardProps {
  post: ForumPost;
}

function ForumPostCard({ post }: ForumPostCardProps) {
  const initials = post.aliasName
    ? post.aliasName.slice(0, 2).toUpperCase()
    : post.authorId.slice(0, 2).toUpperCase();

  const isLocal = post.forumScope === "local";
  const borderColor = isLocal
    ? "border-l-secondary"
    : "border-l-primary";
  const scopeBadgeBg = isLocal
    ? "bg-secondary/10 text-secondary"
    : "bg-primary/10 text-primary";

  return (
    <div
      className={`glass-panel rounded-xl p-4 border-l-2 ${borderColor}`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 shrink-0">
          <span className="text-xs font-bold text-primary">{initials}</span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Author row */}
          <div className="flex items-center gap-2 mb-1">
            <span className="font-label font-semibold text-sm text-on-surface truncate">
              {post.aliasName ?? `Peer ${post.authorId.slice(0, 8)}`}
            </span>
          </div>

          {/* Post text */}
          <p className="font-body text-sm text-on-surface leading-relaxed break-words">
            {post.content}
          </p>

          {/* Footer */}
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            <span className="text-[10px] text-on-surface-variant font-body">
              {formatRelativeTime(post.timestamp)}
            </span>

            {/* Hop count pill */}
            {post.hopCount > 0 && (
              <span className="bg-surface-container-high text-on-surface-variant text-[10px] rounded-full px-2 py-0.5 font-label">
                {post.hopCount} hop{post.hopCount !== 1 ? "s" : ""} away
              </span>
            )}
            {post.hopCount === 0 && (
              <span className="bg-surface-container-high text-on-surface-variant text-[10px] rounded-full px-2 py-0.5 font-label">
                your node
              </span>
            )}

            {/* Scope badge */}
            <span
              className={`text-[10px] rounded-full px-2 py-0.5 font-label font-medium ${scopeBadgeBg}`}
            >
              {isLocal ? "Local" : "Global"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ForumPostCard;
