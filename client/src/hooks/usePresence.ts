import { useEffect, useState, useCallback } from "react";
import { UserEvent } from "matrix-js-sdk";
import { useAuthStore } from "../stores/auth";

// Module-level cache: mxc:// → HTTP URL. Avatars rarely change,
// so a simple Map avoids redundant mxcUrlToHttp() calls and re-renders.
// Capped at 200 entries to prevent unbounded memory growth.
const AVATAR_CACHE_MAX = 200;
const avatarCache = new Map<string, string | null>();

function avatarCacheSet(key: string, value: string | null) {
  if (avatarCache.size >= AVATAR_CACHE_MAX && !avatarCache.has(key)) {
    // Evict oldest entry (first inserted — Maps iterate in insertion order)
    const first = avatarCache.keys().next().value;
    if (first !== undefined) avatarCache.delete(first);
  }
  avatarCache.set(key, value);
}

export function useAvatarUrl(userId: string | null): string | null {
  const client = useAuthStore((s) => s.client);
  const [url, setUrl] = useState<string | null>(() => {
    if (!userId) return null;
    return avatarCache.get(userId) ?? null;
  });

  useEffect(() => {
    if (!client || !userId) {
      setUrl(null);
      return;
    }

    const resolve = () => {
      const user = client.getUser(userId);
      const mxcUrl = user?.avatarUrl;
      if (!mxcUrl) {
        avatarCacheSet(userId, null);
        setUrl(null);
        return;
      }
      const cached = avatarCache.get(userId);
      if (cached) {
        setUrl(cached);
        return;
      }
      const httpUrl = client.mxcUrlToHttp(mxcUrl, 96, 96, "crop") ?? null;
      avatarCacheSet(userId, httpUrl);
      setUrl(httpUrl);
    };

    resolve();

    // Re-resolve if the user's avatar changes
    const onMembership = () => {
      avatarCache.delete(userId);
      resolve();
    };

    // Listen to user presence events (which also fire on profile updates)
    const user = client.getUser(userId);
    user?.on(UserEvent.AvatarUrl, onMembership);

    return () => {
      user?.removeListener(UserEvent.AvatarUrl, onMembership);
    };
  }, [client, userId]);

  return url;
}

export type PresenceState = "online" | "unavailable" | "offline";

export function usePresence(userId: string | null): PresenceState {
  const client = useAuthStore((s) => s.client);
  const [presence, setPresence] = useState<PresenceState>("offline");

  useEffect(() => {
    if (!client || !userId) {
      setPresence("offline");
      return;
    }

    const resolve = () => {
      const user = client.getUser(userId);
      const p = user?.presence;
      if (p === "online" || p === "unavailable") {
        setPresence(p);
      } else {
        setPresence("offline");
      }
    };

    resolve();

    const user = client.getUser(userId);
    const onPresence = () => resolve();
    user?.on(UserEvent.Presence, onPresence);

    return () => {
      user?.removeListener(UserEvent.Presence, onPresence);
    };
  }, [client, userId]);

  return presence;
}

export function usePresenceMap(
  userIds: string[],
): Map<string, PresenceState> {
  const client = useAuthStore((s) => s.client);
  const [presenceMap, setPresenceMap] = useState<Map<string, PresenceState>>(
    new Map(),
  );

  const resolveAll = useCallback(() => {
    if (!client) return;
    const map = new Map<string, PresenceState>();
    for (const uid of userIds) {
      const user = client.getUser(uid);
      const p = user?.presence;
      if (p === "online" || p === "unavailable") {
        map.set(uid, p);
      } else {
        map.set(uid, "offline");
      }
    }
    setPresenceMap(map);
  }, [client, userIds]);

  useEffect(() => {
    if (!client || userIds.length === 0) {
      setPresenceMap(new Map());
      return;
    }

    resolveAll();

    const handlers = new Map<string, () => void>();
    for (const uid of userIds) {
      const user = client.getUser(uid);
      if (user) {
        const handler = () => resolveAll();
        user.on(UserEvent.Presence, handler);
        handlers.set(uid, handler);
      }
    }

    return () => {
      for (const uid of userIds) {
        const handler = handlers.get(uid);
        const user = client.getUser(uid);
        if (user && handler) {
          user.removeListener(UserEvent.Presence, handler);
        }
      }
    };
  }, [client, userIds, resolveAll]);

  return presenceMap;
}
