import { useState, useEffect } from "react";
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

function TextWithLinks({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const url = match[0];
    const start = match.index!;
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }
    parts.push(
      <a
        key={start}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-400 hover:text-indigo-300 hover:underline break-all"
      >
        {url}
      </a>,
    );
    lastIndex = start + url.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

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
      className="block mt-2 max-w-sm border border-zinc-700 rounded-lg overflow-hidden hover:border-zinc-500 transition-colors bg-zinc-800/50"
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
        <p className="text-sm font-medium text-zinc-100 truncate">{data.title}</p>
        {data.description && (
          <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{data.description}</p>
        )}
        <p className="text-xs text-zinc-500 mt-1 truncate">{new URL(url).hostname}</p>
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
      <span className="text-sm text-zinc-500 italic">[Message deleted]</span>
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
          <p className="text-xs text-zinc-500 mt-1">{body}</p>
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
          <p className="text-xs text-zinc-500 mt-0.5">{formatSize(info.size)}</p>
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
      <div className="mt-1 flex items-center gap-2 px-3 py-2 bg-zinc-800 rounded-lg max-w-sm">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-zinc-400 flex-shrink-0">
          <path d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13z" />
        </svg>
        <div className="min-w-0 flex-1">
          <a
            href={url}
            download={body}
            className="text-sm text-indigo-400 hover:text-indigo-300 truncate block"
          >
            {body}
          </a>
          {info?.size && (
            <span className="text-xs text-zinc-500">{formatSize(info.size)}</span>
          )}
        </div>
      </div>
    );
  }

  // m.text or fallback — render with clickable links and URL previews
  const urls = extractUrls(body);
  return (
    <div className="text-sm text-zinc-200">
      <TextWithLinks text={body} />
      {urls.map((u) => (
        <LinkPreview key={u} url={u} />
      ))}
    </div>
  );
}
