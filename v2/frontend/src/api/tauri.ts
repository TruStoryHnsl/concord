/* ── Browser mock layer ──────────────────────────────────────
   When running in a browser (npm run dev) without the Tauri shell,
   __TAURI_INTERNALS__ doesn't exist. We provide mock implementations
   so the UI is fully navigable for design iteration.
   ──────────────────────────────────────────────────────────── */

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    console.warn(`[mock] invoke("${cmd}") — not in Tauri shell`);
    return (MOCK_RESPONSES[cmd]?.(args) as T) ?? ({} as T);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

type UnlistenFn = () => void;

async function safeListen<T>(
  event: string,
  callback: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauri) {
    console.warn(`[mock] listen("${event}") — not in Tauri shell`);
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => callback(e.payload));
}

/* ── Mock data for browser preview ───────────────────────── */

const MOCK_PEER_ID = "12D3KooW" + "MockNode00000000000000000000000000";

const MOCK_ALIASES: AliasPayload[] = [
  { id: "alias-main", displayName: "Node-preview", isActive: true, createdAt: Date.now() - 86400000 * 30 },
  { id: "alias-alt", displayName: "Shadow Runner", isActive: false, createdAt: Date.now() - 86400000 * 7 },
  { id: "alias-anon", displayName: "Anonymous", isActive: false, createdAt: Date.now() - 86400000 * 2 },
];

const MOCK_RESPONSES: Record<string, (args?: Record<string, unknown>) => unknown> = {
  get_identity: () => ({ peerId: MOCK_PEER_ID, displayName: "Node-preview", activeAlias: MOCK_ALIASES[0] }),
  get_node_status: () => ({ isOnline: true, connectedPeers: 3, peerId: MOCK_PEER_ID }),
  get_nearby_peers: () => [
    { peerId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", addresses: ["/ip4/192.168.1.10/udp/4001"], displayName: "Alice" },
    { peerId: "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", addresses: ["/ip4/192.168.1.11/udp/4001"], displayName: "Bob" },
    { peerId: "12D3KooWPeer3CCCCxxxxxxxxxxxxxx", addresses: ["/ip4/192.168.1.12/udp/4001"] },
  ],
  get_messages: () => [
    { id: "m1", channelId: "general", senderId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", content: "hey everyone!", timestamp: Date.now() - 120000, aliasId: "alice-main", aliasName: "Alice" },
    { id: "m2", channelId: "general", senderId: MOCK_PEER_ID, content: "welcome to the mesh", timestamp: Date.now() - 60000, aliasId: "alias-main", aliasName: "Node-preview" },
    { id: "m3", channelId: "general", senderId: "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", content: "this is pretty cool", timestamp: Date.now() - 30000, aliasId: null, aliasName: null },
  ],
  send_message: (args) => ({
    id: "m-" + Date.now(),
    channelId: args?.channelId ?? "general",
    senderId: MOCK_PEER_ID,
    content: args?.content ?? "",
    timestamp: Date.now(),
  }),
  get_servers: () => [
    {
      id: "srv-demo-1", name: "Neural Nexus", ownerId: MOCK_PEER_ID,
      visibility: "public", memberCount: 12, inviteCode: "nexus-42",
      channels: [
        { id: "ch1", serverId: "srv-demo-1", name: "general", channelType: "text" },
        { id: "ch2", serverId: "srv-demo-1", name: "random", channelType: "text" },
        { id: "ch3", serverId: "srv-demo-1", name: "voice-lobby", channelType: "voice" },
      ],
    },
    {
      id: "srv-demo-2", name: "The Ether Vault", ownerId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx",
      visibility: "private", memberCount: 5, channels: [
        { id: "ch4", serverId: "srv-demo-2", name: "general", channelType: "text" },
        { id: "ch5", serverId: "srv-demo-2", name: "trading", channelType: "text" },
      ],
    },
  ],
  get_server: (args) => ({
    id: args?.serverId ?? "srv-demo-1", name: "Neural Nexus", ownerId: MOCK_PEER_ID,
    visibility: "public", memberCount: 12, inviteCode: "nexus-42",
    channels: [
      { id: "ch1", serverId: args?.serverId ?? "srv-demo-1", name: "general", channelType: "text" },
      { id: "ch2", serverId: args?.serverId ?? "srv-demo-1", name: "random", channelType: "text" },
      { id: "ch3", serverId: args?.serverId ?? "srv-demo-1", name: "voice-lobby", channelType: "voice" },
    ],
  }),
  get_channels: (args) => [
    { id: "ch1", serverId: args?.serverId, name: "general", channelType: "text" },
    { id: "ch2", serverId: args?.serverId, name: "random", channelType: "text" },
    { id: "ch3", serverId: args?.serverId, name: "voice-lobby", channelType: "voice" },
  ],
  create_server: (args) => ({
    id: "srv-" + Date.now(), name: args?.name ?? "New Server", ownerId: MOCK_PEER_ID,
    visibility: args?.visibility ?? "private", memberCount: 1, inviteCode: "inv-" + Math.random().toString(36).slice(2, 10),
    channels: [
      { id: "ch-" + Date.now(), serverId: "srv-" + Date.now(), name: "general", channelType: "text" },
      { id: "ch-" + (Date.now() + 1), serverId: "srv-" + Date.now(), name: "voice-lobby", channelType: "voice" },
    ],
  }),
  join_server: () => ({
    id: "srv-joined", name: "Joined Server", ownerId: "someone",
    visibility: "private", memberCount: 8, channels: [
      { id: "chj1", serverId: "srv-joined", name: "general", channelType: "text" },
    ],
  }),
  create_invite: (args) => ({ code: Math.random().toString(36).slice(2, 10), serverId: args?.serverId }),
  get_server_members: () => [
    { peerId: MOCK_PEER_ID, role: "owner", joinedAt: Date.now() - 86400000 },
    { peerId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", role: "member", joinedAt: Date.now() - 3600000 },
    { peerId: "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", role: "member", joinedAt: Date.now() - 1800000 },
  ],
  get_tunnels: () => [
    { peerId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", connectionType: "local", remoteAddress: "/ip4/192.168.1.10/udp/4001/quic-v1", establishedAt: Date.now() - 300000, rttMs: 2 },
    { peerId: "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", connectionType: "direct", remoteAddress: "/ip4/73.42.18.201/udp/4001/quic-v1", establishedAt: Date.now() - 600000, rttMs: 24 },
    { peerId: "12D3KooWPeer3CCCCxxxxxxxxxxxxxx", connectionType: "relayed", remoteAddress: "/p2p-circuit/p2p/12D3KooWRelay.../p2p/...", establishedAt: Date.now() - 120000, rttMs: 85 },
    { peerId: "12D3KooWPeer4DDDDxxxxxxxxxxxxxx", connectionType: "direct", remoteAddress: "/ip4/45.33.32.156/udp/4001/quic-v1", establishedAt: Date.now() - 900000, rttMs: 42 },
  ],
  get_peer_trust: (args) => {
    const pid = (args?.peerId as string) ?? "";
    if (pid === MOCK_PEER_ID) return { peerId: pid, score: 0.85, attestationCount: 12, positiveCount: 12, negativeCount: 0, badge: "trusted", identityAgeDays: 180 };
    if (pid.includes("Peer1")) return { peerId: pid, score: 0.62, attestationCount: 6, positiveCount: 5, negativeCount: 1, badge: "established", identityAgeDays: 90 };
    if (pid.includes("Peer2")) return { peerId: pid, score: 0.35, attestationCount: 2, positiveCount: 2, negativeCount: 0, badge: "recognized", identityAgeDays: 30 };
    if (pid.includes("Peer4")) return { peerId: pid, score: -0.45, attestationCount: 4, positiveCount: 1, negativeCount: 3, badge: "flagged", identityAgeDays: 60 };
    return { peerId: pid, score: 0.0, attestationCount: 0, positiveCount: 0, negativeCount: 0, badge: "unverified", identityAgeDays: 5 };
  },
  get_attestations: () => [
    { attesterId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", subjectId: MOCK_PEER_ID, attestationType: "Positive", sinceTimestamp: Date.now() - 86400000 * 30 },
    { attesterId: "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", subjectId: MOCK_PEER_ID, attestationType: "Positive", sinceTimestamp: Date.now() - 86400000 * 14 },
  ],
  attest_peer: () => undefined,
  report_peer: () => undefined,
  get_aliases: () => MOCK_ALIASES,
  create_alias: (args) => ({
    id: "alias-" + Date.now(),
    displayName: (args?.displayName as string) ?? "New Alias",
    isActive: false,
    createdAt: Date.now(),
  }),
  switch_alias: (args) => {
    const id = (args?.aliasId as string) ?? "";
    const found = MOCK_ALIASES.find((a) => a.id === id);
    return found ?? MOCK_ALIASES[0];
  },
  update_alias: () => undefined,
  delete_alias: () => undefined,
  // Forum commands
  get_forum_posts: (args) => {
    const scope = (args?.scope as string) ?? "local";
    if (scope === "local") {
      return [
        { id: "fp-l1", authorId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", aliasName: "Alice", content: "Anyone else noticing faster mesh sync today? My node is flying.", timestamp: Date.now() - 120000, hopCount: 1, maxHops: 3, forumScope: "local" },
        { id: "fp-l2", authorId: "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", aliasName: "Bob", content: "New to the mesh. Running on a Raspberry Pi 5 — works great over BLE.", timestamp: Date.now() - 300000, hopCount: 2, maxHops: 3, forumScope: "local" },
        { id: "fp-l3", authorId: "12D3KooWPeer3CCCCxxxxxxxxxxxxxx", aliasName: null, content: "Testing WiFi Direct throughput between two nodes in my apartment. Getting ~180Mbps.", timestamp: Date.now() - 600000, hopCount: 1, maxHops: 5, forumScope: "local" },
        { id: "fp-l4", authorId: MOCK_PEER_ID, aliasName: "Node-preview", content: "Just set up a new relay node in my garage. Should help coverage for the block.", timestamp: Date.now() - 900000, hopCount: 0, maxHops: 3, forumScope: "local" },
        { id: "fp-l5", authorId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", aliasName: "Alice", content: "Pro tip: keep your DHT bootstrap interval under 30s for faster peer discovery.", timestamp: Date.now() - 1800000, hopCount: 1, maxHops: 3, forumScope: "local" },
      ];
    }
    return [
      { id: "fp-g1", authorId: "12D3KooWGlobal1xxxxxxxxxxxxxxxx", aliasName: "MeshOps", content: "Global mesh uptime hit 99.7% this week. New record for the network!", timestamp: Date.now() - 60000, hopCount: 8, maxHops: 0, forumScope: "global" },
      { id: "fp-g2", authorId: "12D3KooWGlobal2xxxxxxxxxxxxxxxx", aliasName: "NetRunner", content: "Running a backbone node in Berlin. Happy to peer with anyone in EU.", timestamp: Date.now() - 180000, hopCount: 12, maxHops: 0, forumScope: "global" },
      { id: "fp-g3", authorId: "12D3KooWGlobal3xxxxxxxxxxxxxxxx", aliasName: null, content: "Just published a guide on setting up mesh nodes behind CGNAT. Link in my profile.", timestamp: Date.now() - 360000, hopCount: 15, maxHops: 0, forumScope: "global" },
      { id: "fp-g4", authorId: "12D3KooWGlobal4xxxxxxxxxxxxxxxx", aliasName: "Cipher", content: "The new QUIC tunnel handshake is significantly faster. Great work on v2.", timestamp: Date.now() - 720000, hopCount: 6, maxHops: 0, forumScope: "global" },
      { id: "fp-g5", authorId: MOCK_PEER_ID, aliasName: "Node-preview", content: "Hosting a public voice server this weekend for the mesh community meetup.", timestamp: Date.now() - 1200000, hopCount: 0, maxHops: 0, forumScope: "global" },
    ];
  },
  post_to_local_forum: (args) => ({
    id: "fp-" + Date.now(), authorId: MOCK_PEER_ID, aliasName: "Node-preview",
    content: (args?.content as string) ?? "", timestamp: Date.now(),
    hopCount: 0, maxHops: (args?.maxHops as number) ?? 3, forumScope: "local",
  }),
  post_to_global_forum: (args) => ({
    id: "fp-" + Date.now(), authorId: MOCK_PEER_ID, aliasName: "Node-preview",
    content: (args?.content as string) ?? "", timestamp: Date.now(),
    hopCount: 0, maxHops: 0, forumScope: "global",
  }),
  set_local_forum_range: () => undefined,

  // Friend commands (v2)
  get_friends: () => [
    { peerId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", displayName: "Alice", aliasName: "Alice", addedAt: Date.now() - 86400000 * 30, isMutual: true, lastOnline: Date.now() - 60000, presenceStatus: "online" },
    { peerId: "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", displayName: "Bob", aliasName: "Bob", addedAt: Date.now() - 86400000 * 14, isMutual: true, lastOnline: Date.now() - 300000, presenceStatus: "away" },
    { peerId: "12D3KooWPeer3CCCCxxxxxxxxxxxxxx", displayName: null, aliasName: null, addedAt: Date.now() - 86400000 * 7, isMutual: true, lastOnline: Date.now() - 7200000, presenceStatus: "dnd" },
    { peerId: "12D3KooWPeer4DDDDxxxxxxxxxxxxxx", displayName: "Delta Node", aliasName: "Delta", addedAt: Date.now() - 86400000 * 3, isMutual: false, lastOnline: null, presenceStatus: "offline" },
    { peerId: "12D3KooWPeer5EEEExxxxxxxxxxxxxx", displayName: "Echo", aliasName: "Echo", addedAt: Date.now() - 86400000, isMutual: true, lastOnline: Date.now() - 120000, presenceStatus: "online" },
  ],
  send_friend_request: () => undefined,
  accept_friend_request: () => undefined,
  remove_friend: () => undefined,
  set_presence: () => undefined,
  set_presence_visible: () => undefined,

  // Conversation commands
  get_conversations: () => [
    { id: "conv-1", participants: ["12D3KooWPeer1AAAAxxxxxxxxxxxxxx"], createdAt: Date.now() - 86400000 * 7, isGroup: false, name: null, lastMessageAt: Date.now() - 120000 },
    { id: "conv-2", participants: ["12D3KooWPeer2BBBBxxxxxxxxxxxxxx"], createdAt: Date.now() - 86400000 * 3, isGroup: false, name: null, lastMessageAt: Date.now() - 3600000 },
    { id: "conv-3", participants: ["12D3KooWPeer1AAAAxxxxxxxxxxxxxx", "12D3KooWPeer2BBBBxxxxxxxxxxxxxx", "12D3KooWPeer5EEEExxxxxxxxxxxxxx"], createdAt: Date.now() - 86400000, isGroup: true, name: "Mesh Builders", lastMessageAt: Date.now() - 600000 },
  ],
  create_group_conversation: (args) => ({
    id: "conv-" + Date.now(),
    participants: (args?.peerIds as string[]) ?? [],
    createdAt: Date.now(),
    isGroup: true,
    name: (args?.name as string) ?? null,
    lastMessageAt: null,
  }),
  add_to_conversation: () => undefined,

  get_dm_history: () => [
    { id: "dm1", fromPeer: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", toPeer: MOCK_PEER_ID, content: "Hey, are you online?", timestamp: Date.now() - 300000 },
    { id: "dm2", fromPeer: MOCK_PEER_ID, toPeer: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", content: "Yeah, just connected to the mesh!", timestamp: Date.now() - 240000 },
    { id: "dm3", fromPeer: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", toPeer: MOCK_PEER_ID, content: "Nice. Want to join the Neural Nexus server?", timestamp: Date.now() - 180000 },
    { id: "dm4", fromPeer: MOCK_PEER_ID, toPeer: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", content: "Sure, send me an invite!", timestamp: Date.now() - 120000 },
  ],
  send_dm: (args) => ({
    id: "dm-" + Date.now(),
    fromPeer: MOCK_PEER_ID,
    toPeer: args?.peerId ?? "",
    content: args?.content ?? "",
    timestamp: Date.now(),
  }),
  initiate_dm_session: () => undefined,
  setup_totp: () => ({ secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Concord:Node-preview?secret=JBSWY3DPEHPK3PXP&issuer=Concord" }),
  verify_totp: () => true,
  enable_totp: () => undefined,
  disable_totp: () => undefined,
  is_totp_enabled: () => false,
  dial_peer: () => undefined,
  bootstrap_dht: () => undefined,
  subscribe_channel: () => undefined,
  leave_server: () => undefined,
  create_webhook: (args) => ({
    id: "wh-" + Date.now(),
    serverId: (args?.serverId as string) ?? "srv-demo-1",
    channelId: (args?.channelId as string) ?? "ch1",
    name: (args?.name as string) ?? "New Webhook",
    token: "Wk" + Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 14),
    webhookUrl: `http://localhost:8080/api/webhook/Wk${Math.random().toString(36).slice(2, 14)}`,
    messageCount: 0,
    createdAt: Date.now(),
    lastUsed: null,
  }),
  get_webhooks: () => [
    {
      id: "wh-mock-1", serverId: "srv-demo-1", channelId: "ch1",
      name: "GitHub CI", token: "WkA1b2C3d4E5f6G7h8I9j0K1l2M3n4",
      webhookUrl: "http://localhost:8080/api/webhook/WkA1b2C3d4E5f6G7h8I9j0K1l2M3n4",
      messageCount: 142, createdAt: Date.now() - 86400000 * 14, lastUsed: Date.now() - 3600000,
    },
    {
      id: "wh-mock-2", serverId: "srv-demo-1", channelId: "ch2",
      name: "Uptime Monitor", token: "WkX9y8Z7a6B5c4D3e2F1g0H9i8J7k6",
      webhookUrl: "http://localhost:8080/api/webhook/WkX9y8Z7a6B5c4D3e2F1g0H9i8J7k6",
      messageCount: 47, createdAt: Date.now() - 86400000 * 7, lastUsed: Date.now() - 600000,
    },
  ],
  delete_webhook: () => undefined,
  join_voice: (args) => ({
    isInVoice: true,
    channelId: args?.channelId ?? "voice-lobby",
    serverId: args?.serverId ?? "srv-demo-1",
    isMuted: false,
    isDeafened: false,
    participants: [
      { peerId: MOCK_PEER_ID, isMuted: false, isSpeaking: false },
      { peerId: "12D3KooWPeer1AAAAxxxxxxxxxxxxxx", isMuted: false, isSpeaking: true },
    ],
  }),
  leave_voice: () => undefined,
  toggle_mute: () => true,
  toggle_deafen: () => false,
  get_voice_state: () => ({
    isInVoice: false, channelId: null, serverId: null,
    isMuted: false, isDeafened: false, participants: [],
  }),
  get_system_health: () => {
    const jitter = (base: number, range: number) =>
      +(base + (Math.random() - 0.5) * range).toFixed(1);

    const bandwidthIn: number[] = [];
    const bandwidthOut: number[] = [];
    for (let i = 0; i < 14; i++) {
      bandwidthIn.push(Math.round(300 + Math.random() * 500));
      bandwidthOut.push(Math.round(200 + Math.random() * 600));
    }

    const events: { timestamp: string; level: string; message: string }[] = [
      { timestamp: "14:22:01", level: "OK", message: "Protocol handshake successful: peer_id=8x2f1..." },
      { timestamp: "14:21:44", level: "INFO", message: "Updating local ledger shards (delta 0.04s)" },
      { timestamp: "14:21:30", level: "OK", message: "Broadcasted 14 encrypted packets to swarm" },
      { timestamp: "14:20:55", level: "WARN", message: "Latency spike detected in Frankfurt relay node" },
      { timestamp: "14:20:12", level: "OK", message: "Heartbeat signal acknowledged by gateway" },
      { timestamp: "14:19:40", level: "INFO", message: "DHT route table optimized (7 new nodes added)" },
      { timestamp: "14:18:55", level: "OK", message: "TLS certificate rotation completed" },
      { timestamp: "14:18:10", level: "INFO", message: "Peer discovery sweep complete (3 new peers)" },
    ];

    return {
      stabilityIndex: jitter(99.4, 0.6),
      bandwidthIn,
      bandwidthOut,
      latencyMs: Math.round(jitter(24, 10)),
      activePeers: Math.round(jitter(1402, 50)),
      cpuPercent: jitter(12.4, 5),
      ramUsedGb: jitter(4.2, 0.6),
      ramTotalGb: 16,
      diskIoMbps: jitter(0.8, 0.4),
      uptime: "342d 12h",
      encryptedTrafficTb: jitter(4.2, 0.1),
      reputation: "A++",
      events,
    };
  },
  start_webhost: () => ({
    url: "http://192.168.1.152:8080",
    pin: "482917",
    port: 8080,
    activeGuests: 0,
  }),
  stop_webhost: () => undefined,
  get_webhost_status: () => null,
};

/* ── Alias Types ─────────────────────────────────────────────── */

export interface AliasPayload {
  id: string;
  displayName: string;
  isActive: boolean;
  createdAt: number;
}

/* ── Trust Types ─────────────────────────────────────────────── */

export type TrustLevel =
  | "unverified"
  | "recognized"
  | "established"
  | "trusted"
  | "backbone"
  | "flagged";

export interface TrustInfo {
  peerId: string;
  score: number;
  attestationCount: number;
  positiveCount: number;
  negativeCount: number;
  badge: TrustLevel;
  identityAgeDays: number;
}

export interface Attestation {
  attesterId: string;
  subjectId: string;
  attestationType: string;
  sinceTimestamp: number;
  reason?: string;
}

/* ── Forum Types ──────────────────────────────────────────────── */

export interface ForumPost {
  id: string;
  authorId: string;
  aliasName: string | null;
  content: string;
  timestamp: number;
  hopCount: number;
  maxHops: number;
  forumScope: "local" | "global";
}

/* ── Friend Types (v2) ────────────────────────────────────────── */

export type PresenceStatus = "online" | "away" | "dnd" | "offline";

export interface FriendPayload {
  peerId: string;
  displayName: string | null;
  aliasName: string | null;
  addedAt: number;
  isMutual: boolean;
  lastOnline: number | null;
  presenceStatus: PresenceStatus;
}

/* ── Conversation Types ───────────────────────────────────────── */

export interface ConversationPayload {
  id: string;
  participants: string[];
  createdAt: number;
  isGroup: boolean;
  name: string | null;
  lastMessageAt: number | null;
}

/* ── DM Types ───────────────────────────────────────────────── */

export interface DmMessage {
  id: string;
  fromPeer: string;
  toPeer: string;
  content: string;
  timestamp: number;
}

/* ── TOTP Types ─────────────────────────────────────────────── */

export interface TotpSetup {
  secret: string;
  uri: string;
}

/* ── Tunnel Types ────────────────────────────────────────────── */

export interface TunnelInfo {
  peerId: string;
  connectionType: "direct" | "relayed" | "local";
  remoteAddress: string;
  establishedAt: number;
  rttMs: number | null;
}

/* ── Voice Types ─────────────────────────────────────────────── */

export interface VoiceState {
  isInVoice: boolean;
  channelId: string | null;
  serverId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  participants: VoiceParticipant[];
}

export interface VoiceParticipant {
  peerId: string;
  isMuted: boolean;
  isSpeaking: boolean;
}

/* ── Types ───────────────────────────────────────────────────── */

export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  content: string;
  timestamp: number;
  aliasId?: string | null;
  aliasName?: string | null;
}

export interface PeerInfo {
  peerId: string;
  addresses: string[];
  displayName?: string;
}

export interface NodeStatus {
  isOnline: boolean;
  connectedPeers: number;
  peerId: string;
}

export type VerificationState = "verified" | "stale" | "speculative";

export interface MeshNode {
  peerId: string;
  displayName?: string;
  addresses: string[];
  verificationState: VerificationState;
  remainingTtl: number;
  lastConfirmedAt: number | null;
  receivedComputeWeight: number;
  connectionType: "local" | "direct" | "relayed" | null;
  rttMs: number | null;
  lastSeen: number;
}

export interface ComputePriorityEntry {
  peerId: string;
  priority: number;
  displayName?: string;
  share: number;
}

export interface Identity {
  peerId: string;
  displayName: string;
  activeAlias?: AliasPayload | null;
}

export interface ChannelPayload {
  id: string;
  serverId: string;
  name: string;
  channelType: "text" | "voice" | "video";
}

export interface ServerPayload {
  id: string;
  name: string;
  ownerId: string;
  visibility: "public" | "private" | "federated";
  channels: ChannelPayload[];
  memberCount: number;
  inviteCode?: string;
}

export interface InvitePayload {
  code: string;
  serverId: string;
}

export interface MemberPayload {
  peerId: string;
  role: string;
  joinedAt: number;
}

/* ── Tauri Command Wrappers ───────────────────────────────────── */

export async function getIdentity(): Promise<Identity> {
  return safeInvoke<Identity>("get_identity");
}

export async function sendMessage(
  channelId: string,
  content: string,
  serverId?: string,
): Promise<Message> {
  return safeInvoke<Message>("send_message", { channelId, content, serverId });
}

export async function getMessages(
  channelId: string,
  limit?: number,
  before?: string,
): Promise<Message[]> {
  return safeInvoke<Message[]>("get_messages", { channelId, limit, before });
}

export async function getNearbyPeers(): Promise<PeerInfo[]> {
  return safeInvoke<PeerInfo[]>("get_nearby_peers");
}

export async function getNodeStatus(): Promise<NodeStatus> {
  return safeInvoke<NodeStatus>("get_node_status");
}

export async function subscribeChannel(topic: string): Promise<void> {
  return safeInvoke<void>("subscribe_channel", { topic });
}

export async function getMeshNodes(): Promise<MeshNode[]> {
  return safeInvoke<MeshNode[]>("get_mesh_nodes");
}

export async function setComputePriorities(entries: ComputePriorityEntry[]): Promise<void> {
  return safeInvoke<void>("set_compute_priorities", { entries });
}

export async function getComputePriorities(): Promise<ComputePriorityEntry[]> {
  return safeInvoke<ComputePriorityEntry[]>("get_compute_priorities");
}

/* ── Server Management ──────────────────────────────────────── */

export async function createServer(
  name: string,
  visibility: "public" | "private" | "federated",
  channels?: { name: string; channelType: string }[],
): Promise<ServerPayload> {
  return safeInvoke<ServerPayload>("create_server", { name, visibility, channels });
}

export async function getServers(): Promise<ServerPayload[]> {
  return safeInvoke<ServerPayload[]>("get_servers");
}

export async function getServer(serverId: string): Promise<ServerPayload> {
  return safeInvoke<ServerPayload>("get_server", { serverId });
}

export async function getChannels(serverId: string): Promise<ChannelPayload[]> {
  return safeInvoke<ChannelPayload[]>("get_channels", { serverId });
}

export async function joinServer(inviteCode: string): Promise<ServerPayload> {
  return safeInvoke<ServerPayload>("join_server", { inviteCode });
}

export async function createInvite(serverId: string): Promise<InvitePayload> {
  return safeInvoke<InvitePayload>("create_invite", { serverId });
}

export async function leaveServer(serverId: string): Promise<void> {
  return safeInvoke<void>("leave_server", { serverId });
}

export async function getServerMembers(
  serverId: string,
): Promise<MemberPayload[]> {
  return safeInvoke<MemberPayload[]>("get_server_members", { serverId });
}

/* ── Voice Commands ──────────────────────────────────────────── */

export async function joinVoice(
  serverId: string,
  channelId: string,
): Promise<VoiceState> {
  return safeInvoke<VoiceState>("join_voice", { serverId, channelId });
}

export async function leaveVoice(): Promise<void> {
  return safeInvoke<void>("leave_voice");
}

export async function toggleMute(): Promise<boolean> {
  return safeInvoke<boolean>("toggle_mute");
}

export async function toggleDeafen(): Promise<boolean> {
  return safeInvoke<boolean>("toggle_deafen");
}

export async function getVoiceState(): Promise<VoiceState> {
  return safeInvoke<VoiceState>("get_voice_state");
}

/* ── Tunnel Commands ──────────────────────────────────────────── */

export async function getTunnels(): Promise<TunnelInfo[]> {
  return safeInvoke<TunnelInfo[]>("get_tunnels");
}

export async function dialPeer(peerId: string, address: string): Promise<void> {
  return safeInvoke<void>("dial_peer", { peerId, address });
}

export async function bootstrapDht(): Promise<void> {
  return safeInvoke<void>("bootstrap_dht");
}

/* ── Trust Commands ───────────────────────────────────────────── */

export async function getPeerTrust(peerId: string): Promise<TrustInfo> {
  return safeInvoke<TrustInfo>("get_peer_trust", { peerId });
}

export async function attestPeer(peerId: string): Promise<void> {
  return safeInvoke<void>("attest_peer", { peerId });
}

export async function reportPeer(peerId: string, reason?: string): Promise<void> {
  return safeInvoke<void>("report_peer", { peerId, reason });
}

export async function getAttestations(peerId: string): Promise<Attestation[]> {
  return safeInvoke<Attestation[]>("get_attestations", { peerId });
}

/* ── Alias Commands ──────────────────────────────────────────── */

export async function getAliases(): Promise<AliasPayload[]> {
  return safeInvoke<AliasPayload[]>("get_aliases");
}

export async function createAlias(displayName: string): Promise<AliasPayload> {
  return safeInvoke<AliasPayload>("create_alias", { displayName });
}

export async function switchAlias(aliasId: string): Promise<AliasPayload> {
  return safeInvoke<AliasPayload>("switch_alias", { aliasId });
}

export async function updateAlias(aliasId: string, displayName: string): Promise<void> {
  return safeInvoke<void>("update_alias", { aliasId, displayName });
}

export async function deleteAlias(aliasId: string): Promise<void> {
  return safeInvoke<void>("delete_alias", { aliasId });
}

/* ── Forum Commands ──────────────────────────────────────────── */

export async function getForumPosts(
  scope: "local" | "global",
  limit?: number,
  before?: string,
): Promise<ForumPost[]> {
  return safeInvoke<ForumPost[]>("get_forum_posts", { scope, limit, before });
}

export async function postToLocalForum(
  content: string,
  maxHops?: number,
): Promise<ForumPost> {
  return safeInvoke<ForumPost>("post_to_local_forum", { content, maxHops });
}

export async function postToGlobalForum(content: string): Promise<ForumPost> {
  return safeInvoke<ForumPost>("post_to_global_forum", { content });
}

export async function setLocalForumRange(maxHops: number): Promise<void> {
  return safeInvoke<void>("set_local_forum_range", { maxHops });
}

/* ── Friend Commands (v2) ────────────────────────────────────── */

export async function getFriends(): Promise<FriendPayload[]> {
  return safeInvoke<FriendPayload[]>("get_friends");
}

export async function sendFriendRequest(peerId: string): Promise<void> {
  return safeInvoke<void>("send_friend_request", { peerId });
}

export async function acceptFriendRequest(peerId: string): Promise<void> {
  return safeInvoke<void>("accept_friend_request", { peerId });
}

export async function removeFriend(peerId: string): Promise<void> {
  return safeInvoke<void>("remove_friend", { peerId });
}

export async function setPresence(status: PresenceStatus): Promise<void> {
  return safeInvoke<void>("set_presence", { status });
}

export async function setPresenceVisible(visible: boolean): Promise<void> {
  return safeInvoke<void>("set_presence_visible", { visible });
}

/* ── Conversation Commands ───────────────────────────────────── */

export async function getConversations(): Promise<ConversationPayload[]> {
  return safeInvoke<ConversationPayload[]>("get_conversations");
}

export async function createGroupConversation(
  peerIds: string[],
  name?: string,
): Promise<ConversationPayload> {
  return safeInvoke<ConversationPayload>("create_group_conversation", { peerIds, name });
}

export async function addToConversation(
  conversationId: string,
  peerId: string,
): Promise<void> {
  return safeInvoke<void>("add_to_conversation", { conversationId, peerId });
}

/* ── DM Commands ─────────────────────────────────────────────── */

export async function sendDm(
  peerId: string,
  content: string,
): Promise<DmMessage> {
  return safeInvoke<DmMessage>("send_dm", { peerId, content });
}

export async function getDmHistory(
  peerId: string,
  limit?: number,
): Promise<DmMessage[]> {
  return safeInvoke<DmMessage[]>("get_dm_history", { peerId, limit });
}

export async function initiateDmSession(peerId: string): Promise<void> {
  return safeInvoke<void>("initiate_dm_session", { peerId });
}

/* ── TOTP Commands ───────────────────────────────────────────── */

export async function setupTotp(): Promise<TotpSetup> {
  return safeInvoke<TotpSetup>("setup_totp");
}

export async function verifyTotp(code: string): Promise<boolean> {
  return safeInvoke<boolean>("verify_totp", { code });
}

export async function enableTotp(code: string): Promise<void> {
  return safeInvoke<void>("enable_totp", { code });
}

export async function disableTotp(code: string): Promise<void> {
  return safeInvoke<void>("disable_totp", { code });
}

export async function isTotpEnabled(): Promise<boolean> {
  return safeInvoke<boolean>("is_totp_enabled");
}

/* ── Webhook Types ───────────────────────────────────────────── */

export interface WebhookPayload {
  id: string;
  serverId: string;
  channelId: string;
  name: string;
  token: string;
  webhookUrl: string;
  messageCount: number;
  createdAt: number;
  lastUsed: number | null;
}

/* ── System Health Types ─────────────────────────────────────── */

export interface HealthEvent {
  timestamp: string;
  level: "OK" | "INFO" | "WARN";
  message: string;
}

export interface SystemHealth {
  stabilityIndex: number;
  bandwidthIn: number[];
  bandwidthOut: number[];
  latencyMs: number;
  activePeers: number;
  cpuPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskIoMbps: number;
  uptime: string;
  encryptedTrafficTb: number;
  reputation: string;
  events: HealthEvent[];
}

/* ── Webhost Types ───────────────────────────────────────────── */

export interface WebhostInfo {
  url: string;
  pin: string;
  port: number;
  activeGuests: number;
}

/* ── Webhost Commands ────────────────────────────────────────── */

export async function startWebhost(port?: number): Promise<WebhostInfo> {
  return safeInvoke<WebhostInfo>("start_webhost", { port });
}

export async function stopWebhost(): Promise<void> {
  return safeInvoke<void>("stop_webhost");
}

export async function getWebhostStatus(): Promise<WebhostInfo | null> {
  return safeInvoke<WebhostInfo | null>("get_webhost_status");
}

/* ── Webhook Commands ────────────────────────────────────────── */

export async function createWebhook(
  serverId: string,
  channelId: string,
  name: string,
): Promise<WebhookPayload> {
  return safeInvoke<WebhookPayload>("create_webhook", {
    serverId,
    channelId,
    name,
  });
}

export async function getWebhooks(
  serverId: string,
): Promise<WebhookPayload[]> {
  return safeInvoke<WebhookPayload[]>("get_webhooks", { serverId });
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  return safeInvoke<void>("delete_webhook", { webhookId });
}

/* ── System Health Commands ──────────────────────────────────── */

export async function getSystemHealth(): Promise<SystemHealth> {
  return safeInvoke<SystemHealth>("get_system_health");
}

/* ── Event Listener ───────────────────────────────────────────── */

export function onEvent<T>(
  event: string,
  callback: (payload: T) => void,
): Promise<UnlistenFn> {
  return safeListen<T>(event, callback);
}
