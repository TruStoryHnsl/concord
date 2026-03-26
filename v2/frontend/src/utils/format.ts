/**
 * Shorten a peer ID to first 8 chars + ellipsis.
 */
export function shortenPeerId(peerId: string): string {
  if (peerId.length <= 10) return peerId;
  return `${peerId.slice(0, 8)}...`;
}

/**
 * Format a Unix timestamp (seconds or millis) as a relative time string.
 */
export function formatRelativeTime(timestamp: number): string {
  // Normalize to milliseconds
  const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const now = Date.now();
  const diff = now - ms;

  if (diff < 0) return "just now";

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const date = new Date(ms);
  return date.toLocaleDateString();
}
