/**
 * messengerSync — the superuser roaming bridge (client half).
 *
 * NATIVE (push): the device is the source of truth for the p2p
 * messenger (libp2p + WireGuard social inbox). This module periodically
 * pushes the device's conversations, message history, learned peers,
 * and personalization prefs into the user's account on the docker
 * portal (`/api/me/sync/*`, see server/routers/user_sync.py), so the
 * SAME user opening the BROWSER at the instance domain finds their chat
 * history, connections, and personalizations intact.
 *
 * WEB (hydrate): applies roamed personalization prefs after login. The
 * roamed history itself renders in the peer messenger surface via
 * WebPeerHistory (read-only — the device holds the p2p keys; the web
 * view is a faithful mirror, not a second sender).
 *
 * Everything is best-effort and throttled: sync must never break the
 * messenger. All pushes are strictly account-scoped server-side.
 */

import { isTauri } from "../api/servitude";
import { getApiBase } from "../api/serverUrl";
import { useAuthStore } from "../stores/auth";
import { useSettingsStore } from "../stores/settings";

const PUSH_INTERVAL_MS = 60_000;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const DEVICE_ID_KEY = "concord.device_id";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

interface SyncItem {
  key: string;
  data: Record<string, unknown>;
  deleted?: boolean;
}

/**
 * Stable per-install id for roaming attribution (X2/N5). Lets the portal
 * show, in Settings→Devices, which install last wrote each synced row —
 * and gives the last-writer-wins-per-kind conflict policy a name to
 * attribute the winner to. Persisted in localStorage; regenerated only if
 * cleared. Never a superuser key — purely an attribution tag.
 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}

async function putSync(kind: string, items: SyncItem[]): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  if (!token || items.length === 0) return;
  const dev = encodeURIComponent(getDeviceId());
  await fetch(`${getApiBase()}/me/sync/${kind}?device_id=${dev}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(items),
  });
}

async function getSync(kind: string): Promise<Array<{ key: string; data: Record<string, unknown> }>> {
  const token = useAuthStore.getState().accessToken;
  if (!token) return [];
  const res = await fetch(`${getApiBase()}/me/sync/${kind}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    key: string;
    data: Record<string, unknown>;
    deleted: boolean;
  }>;
  return rows.filter((r) => !r.deleted);
}

async function pushOnce(): Promise<void> {
  if (!isTauri()) return;
  const token = useAuthStore.getState().accessToken;
  if (!token) return;
  try {
    const { socialInboxList, socialInboxGetMessages } = await import(
      "../api/social/inbox"
    );
    const { socialPeersList } = await import("../api/social/peers");

    const conversations = await socialInboxList();
    await putSync(
      "conversation",
      conversations.slice(0, 500).map((c) => ({
        key: c.peerId,
        data: {
          peerId: c.peerId,
          lastMessageAt: c.lastMessageAt ?? null,
          lastPreview: c.lastPreview ?? null,
          isGroup: c.isGroup ?? false,
          groupName: c.groupName ?? null,
        },
      })),
    );

    for (const c of conversations.slice(0, 50)) {
      try {
        const msgs = await socialInboxGetMessages(c.peerId);
        await putSync(
          "message",
          msgs.slice(-MAX_MESSAGES_PER_CONVERSATION).map((m) => ({
            key: m.id,
            data: {
              conversation: c.peerId,
              direction: m.direction,
              body: m.body,
              sentAt: m.sentAt,
              edited: m.edited ?? false,
            },
          })),
        );
      } catch {
        /* one conversation failing must not stop the rest */
      }
    }

    try {
      const peers = await socialPeersList();
      await putSync(
        "contact",
        peers.slice(0, 500).map((p: { peerId: string; label?: string | null; trust?: string | null }) => ({
          key: p.peerId,
          data: {
            peerId: p.peerId,
            label: p.label ?? null,
            trust: p.trust ?? null,
          },
        })),
      );
    } catch {
      /* peers registry unavailable */
    }

    const s = useSettingsStore.getState();
    await putSync("prefs", [
      { key: "prefs", data: { themePreset: s.themePreset } },
    ]);
  } catch {
    /* sync is best-effort — never surface an error into the messenger */
  }
}

/** Native: start the periodic device→portal push. Idempotent. */
export function startMessengerSync(): void {
  if (started || !isTauri()) return;
  started = true;
  void pushOnce();
  timer = setInterval(() => void pushOnce(), PUSH_INTERVAL_MS);
}

export function stopMessengerSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

/** Web: apply roamed personalization prefs after login (theme etc.). */
export async function hydrateRoamingPrefs(): Promise<void> {
  if (isTauri()) return;
  try {
    const rows = await getSync("prefs");
    const prefs = rows.find((r) => r.key === "prefs")?.data;
    const theme = prefs?.themePreset;
    if (typeof theme === "string" && theme) {
      useSettingsStore.getState().setThemePreset(theme as never);
    }
  } catch {
    /* best-effort */
  }
}

/** Web: roamed conversations + messages for the read-only history view. */
export async function fetchRoamedHistory(): Promise<{
  conversations: Array<{ key: string; data: Record<string, unknown> }>;
  messages: Array<{ key: string; data: Record<string, unknown> }>;
  contacts: Array<{ key: string; data: Record<string, unknown> }>;
}> {
  const [conversations, messages, contacts] = await Promise.all([
    getSync("conversation"),
    getSync("message"),
    getSync("contact"),
  ]);
  return { conversations, messages, contacts };
}
