import { useState, useEffect } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { ChatMessage } from "../../hooks/useMatrix";
import { useAuthStore } from "../../stores/auth";

interface MessageContentProps {
  message: ChatMessage;
}

interface PreviewData {
  title: string;
  description: string | null;
  image: string | null;
  url: string;
}

// Module-level cache so the same URL isn't fetched multiple times across renders
const previewCache = new Map<string, PreviewData | null>();

const URL_REGEX = /https?:\/\/[^\s<>"]+[^\s<>"',;)]+/g;

function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_REGEX) ?? [])].slice(0, 3);
}

/**
 * Sanitize schema for chat-message markdown.
 *
 * Extends rehype-sanitize's defaultSchema to:
 *  - Drop dangerous tags (script, iframe, style, object, embed) — these are
 *    not in defaultSchema's allow-list, so dropping is implicit, but we list
 *    them explicitly via tagNames filter as a defensive measure.
 *  - Strip every `on*` event-handler attribute from every tag.
 *  - Restrict `href` URLs to http, https, and mailto protocols.
 *  - Allow `className` on the common content tags so the Tailwind classes
 *    injected by our `components` map survive sanitization.
 */
const FORBIDDEN_TAGS = new Set([
  "script",
  "iframe",
  "style",
  "object",
  "embed",
]);

const CLASSNAME_TAGS = [
  "a",
  "p",
  "code",
  "pre",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "strong",
  "em",
  "span",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) => !FORBIDDEN_TAGS.has(t),
  ),
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    // Allow className on the tags our components map styles
    ...Object.fromEntries(
      CLASSNAME_TAGS.map((tag) => {
        const existing = (defaultSchema.attributes?.[tag] ?? []) as Array<
          string | [string, ...unknown[]]
        >;
        return [tag, [...existing, "className"]];
      }),
    ),
    // Ensure anchor attributes are allowed and safe
    a: [
      ...((defaultSchema.attributes?.a ?? []) as Array<
        string | [string, ...unknown[]]
      >),
      "className",
      "target",
      "rel",
    ],
  },
} as typeof defaultSchema;

/**
 * Components map: applies Tailwind utility classes to rendered markdown
 * elements so they match the rest of the chat surface tokens.
 */
const markdownComponents: Components = {
  p: ({ children, ...props }) => (
    <p className="mb-1 last:mb-0" {...props}>
      {children}
    </p>
  ),
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline break-all"
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    // react-markdown v9 no longer passes `inline`; detect fenced blocks via
    // the language-* className that GFM/markdown adds, and let the `pre`
    // renderer handle the block wrapper. Inline code = no className.
    const isBlock = typeof className === "string" && /language-/.test(className);
    if (isBlock) {
      return (
        <code
          className={`block bg-surface-container-high text-on-surface p-3 rounded overflow-x-auto text-sm font-mono ${className ?? ""}`}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className="bg-surface-container-high text-on-surface px-1 py-0.5 rounded text-sm font-mono"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => (
    <pre className="my-1" {...props}>
      {children}
    </pre>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-inside" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-inside" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => <li {...props}>{children}</li>,
  h1: ({ children, ...props }) => (
    <h1 className="text-xl font-bold font-headline mt-1 mb-1" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-lg font-bold font-headline mt-1 mb-1" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-base font-bold font-headline mt-1 mb-1" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="text-sm font-bold font-headline mt-1 mb-1" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5 className="text-xs font-bold font-headline mt-1 mb-1" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6 className="text-xs font-semibold font-headline mt-1 mb-1" {...props}>
      {children}
    </h6>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="border-l-4 border-primary pl-3 text-on-surface-variant"
      {...props}
    >
      {children}
    </blockquote>
  ),
  strong: ({ children, ...props }) => <strong {...props}>{children}</strong>,
  em: ({ children, ...props }) => <em {...props}>{children}</em>,
};

function LinkPreview({ url }: { url: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [data, setData] = useState<PreviewData | null | undefined>(
    previewCache.has(url) ? previewCache.get(url) : undefined,
  );

  useEffect(() => {
    if (!accessToken || previewCache.has(url)) return;

    fetch(`/api/preview?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PreviewData | null) => {
        previewCache.set(url, d);
        setData(d);
      })
      .catch(() => {
        previewCache.set(url, null);
        setData(null);
      });
  }, [url, accessToken]);

  if (!data) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-2 max-w-sm border border-outline-variant/15 rounded-lg overflow-hidden hover:border-outline-variant transition-colors bg-surface-container"
    >
      {data.image && (
        <img
          src={data.image}
          alt=""
          className="w-full h-32 object-cover"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="p-3">
        <p className="text-sm font-medium text-on-surface truncate">{data.title}</p>
        {data.description && (
          <p className="text-xs text-on-surface-variant mt-1 line-clamp-2">{data.description}</p>
        )}
        <p className="text-xs text-on-surface-variant mt-1 truncate">{new URL(url).hostname}</p>
      </div>
    </a>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageContent({ message }: MessageContentProps) {
  if (message.redacted) {
    return (
      <span className="text-sm text-on-surface-variant italic">[Message deleted]</span>
    );
  }

  const { msgtype, body, url, info } = message;

  if (msgtype === "m.image" && url) {
    return (
      <div className="mt-1">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img
            src={url}
            alt={body}
            className="max-w-sm max-h-80 rounded-lg object-contain"
            style={
              info?.w && info?.h
                ? {
                    aspectRatio: `${info.w} / ${info.h}`,
                    maxWidth: Math.min(info.w, 384),
                  }
                : undefined
            }
            loading="lazy"
          />
        </a>
        {body && body !== "image" && (
          <p className="text-xs text-on-surface-variant mt-1">{body}</p>
        )}
      </div>
    );
  }

  if (msgtype === "m.audio" && url) {
    return (
      <div className="mt-1">
        <audio controls src={url} className="max-w-sm" preload="none">
          <a href={url}>{body}</a>
        </audio>
        {info?.size && (
          <p className="text-xs text-on-surface-variant mt-0.5">{formatSize(info.size)}</p>
        )}
      </div>
    );
  }

  if (msgtype === "m.video" && url) {
    return (
      <div className="mt-1">
        <video
          controls
          src={url}
          className="max-w-sm max-h-80 rounded-lg"
          preload="none"
        >
          <a href={url}>{body}</a>
        </video>
      </div>
    );
  }

  if (msgtype === "m.file" && url) {
    return (
      <div className="mt-1 flex items-center gap-2 px-3 py-2 bg-surface-container rounded-lg max-w-sm">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-on-surface-variant flex-shrink-0">
          <path d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13z" />
        </svg>
        <div className="min-w-0 flex-1">
          <a
            href={url}
            download={body}
            className="text-sm text-primary hover:text-primary truncate block"
          >
            {body}
          </a>
          {info?.size && (
            <span className="text-xs text-on-surface-variant">{formatSize(info.size)}</span>
          )}
        </div>
      </div>
    );
  }

  // m.text or fallback — render markdown (sanitized) with URL previews.
  // URL extraction runs on the RAW body so previews work even when the URL
  // is wrapped in markdown link syntax.
  const urls = extractUrls(body);
  return (
    <div className="text-sm text-on-surface markdown-content concord-message-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={markdownComponents}
      >
        {body}
      </ReactMarkdown>
      {urls.map((u) => (
        <LinkPreview key={u} url={u} />
      ))}
    </div>
  );
}
