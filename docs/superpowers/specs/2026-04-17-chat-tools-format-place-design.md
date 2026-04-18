# Design Spec: Chat Tools, Format System, and Place Channels

**Date:** 2026-04-17  
**Status:** Approved  
**Scope:** Four interconnected frontend features for Concord

---

## Overview

This spec covers four features designed together because they share surface area in the message input, top bar, and channel type system:

1. **Chat Tools Panel** — `+` button next to attach opens a grid of composable message tools
2. **Format System** — two-sided formatting: sender sets display defaults pre-send; viewer can override per-message or per-sender
3. **Format Button Relocation** — moves from input area to channel top bar; input area simplified
4. **Place Channel Type** — new `"place"` channel combining text chat with a persistent voice/video pill banner

---

## 1. Chat Tools Panel

### Trigger & Layout

A `+` button is added to `MessageInput.tsx` to the left of the existing attach icon. Clicking it toggles a **grid pop-up panel** anchored above the button — a floating 4-column icon grid with glass-panel styling (`rounded-2xl`, `backdrop-blur`, `border`), consistent with existing Concord panels.

The panel closes on tool selection, on Escape, or on click-outside. On mobile the grid uses 64px touch targets; on desktop 48px.

### Initial Tool Set

| Tool | Icon | What it produces |
|------|------|-----------------|
| Poll | 📊 | `/poll` widget (migrated from old snippet system) |
| Heatmap | 🔥 | Calendar availability widget — users mark slots, algo surfaces hottest date + 2 alternatives for group vote |
| Gallery | 🖼️ | Media collection message (photo/video/GIF browser) |
| Timed | ⏱️ | Message that auto-deletes after a configured duration |
| Scheduled | 📨 | Message held server-side and delivered at a future datetime |
| GIF | 🎞️ | Inline GIF picker, sends immediately on selection |
| More | ➕ | Overflow entry point for user-added or future tools |

### Composer Flow

Tools that require configuration (Poll, Heatmap, Timed, Scheduled) open a **composer sheet** that slides up above the input — not a new page. The user fills in options and hits Send. Simple tools (GIF, Gallery on single selection) send immediately.

### Extensibility

The tool registry is a plain array of `ChatTool` entries:
```ts
interface ChatTool {
  id: string;
  label: string;
  icon: string; // emoji or material symbol name
  composer: React.ComponentType<ComposerProps> | null; // null = send immediately
}
```
The `More` slot navigates to a full tool browser. User-installable tools register into this array via the extension system.

### Heatmap Tool Detail

1. Sender opens the Heatmap composer, selects a date range and time granularity (full-day or hourly slots)
2. Message is sent as a widget with an empty response grid
3. Recipients tap their available slots directly in the message widget
4. The widget re-renders live as responses arrive, highlighting the hottest slot(s) in a heat gradient
5. When the sender closes voting, the widget locks and displays: **recommended date** (highest score) + **2 runner-up alternatives** with vote counts

---

## 2. Format System

### Data Model

A message's display intent is embedded as a custom field in the Matrix message content:

```json
{
  "msgtype": "m.text",
  "body": "...",
  "x.concord.display": {
    "alignment": "left" | "center" | "right" | "justify",
    "fontSize": 14,
    "color": "#e5e7eb",
    "fontFamily": "system" | "serif" | "mono" | string
  }
}
```

This field is ignored by non-Concord Matrix clients. Omitting it is equivalent to all defaults.

### Sender Side — Pre-Send Format Panel

The 🖌 button in the channel top bar (see Section 3) opens a compact popover with four controls:

- **Alignment** — four-button toggle: Left / Center / Right / Justify
- **Font size** — slider, range 12–32px, default 14px
- **Text color** — swatch palette (6 presets) + custom color picker
- **Font family** — dropdown: System Default, Serif, Monospace, + user-installable entries

The panel's state is held in a `draftFormat` field on `useFormatStore` (not local component state) so the top-bar button and `MessageInput` can both access it without prop-drilling through `ChatLayout`. On send, `MessageInput` reads `draftFormat`, serialises it into `x.concord.display`, and calls `clearDraftFormat()`. State resets to defaults after send. The button highlights with the primary accent when `formatPanelOpen` (also on the store) is true.

### Viewer Side — Per-Message Override

A 🖌 brush icon appears in the message header row (alongside username and timestamp) on hover (desktop) or long-press (mobile). Tapping opens an **inline popover** (Option A from design session) pre-filled with the sender's `x.concord.display` values — or Concord defaults if none were set.

The viewer adjusts controls and applies at one of two scopes via segmented button at the bottom of the popover:

- **This message** — stored as `messageFormats[messageId]`
- **All messages from [sender]** — stored as `senderFormats[userId]`

A **"Reset to sender default"** button clears the viewer's override for the active scope.

### Client-Side Override Store

New `useFormatStore` Zustand store, persisted to localStorage:

```ts
interface FormatOverride {
  alignment: "left" | "center" | "right" | "justify";
  fontSize: number;
  color: string;
  fontFamily: string;
}

interface FormatState {
  // Viewer overrides (persisted)
  messageFormats: Record<string, FormatOverride>; // keyed by Matrix event ID
  senderFormats: Record<string, FormatOverride>;  // keyed by Matrix user ID
  setMessageFormat: (id: string, fmt: Partial<FormatOverride>) => void;
  setSenderFormat: (userId: string, fmt: Partial<FormatOverride>) => void;
  clearMessageFormat: (id: string) => void;
  clearSenderFormat: (userId: string) => void;
  // Pre-send draft (ephemeral, not persisted)
  draftFormat: FormatOverride;
  formatPanelOpen: boolean;
  setDraftFormat: (fmt: Partial<FormatOverride>) => void;
  clearDraftFormat: () => void;
  setFormatPanelOpen: (open: boolean) => void;
}
```

Nothing is sent to the server. Format overrides are local to the device.

### Render Precedence (highest wins)

1. Viewer's per-message override (`messageFormats[id]`)
2. Viewer's per-sender override (`senderFormats[userId]`)
3. Sender's embedded `x.concord.display` defaults
4. Concord global defaults (14px, system font, left-aligned, theme text color)

`MessageContent` reads resolved format from a `useResolvedFormat(message)` hook that applies this precedence.

---

## 3. Format Button Relocation

### Removed from `MessageInput.tsx`

- `stylus_note` button and its click handler
- `formattingOpen` state
- `insertSnippet()` function
- The three-category snippet panel (Markdown / Layout / Pinned Widgets)

The Poll and Checklist widgets previously accessible via snippets migrate to the Chat Tools Panel (Section 1). The Status snippet is deprecated.

The input toolbar after removal: `[+]` · `[attach]` · `[textarea]` · `[send]`

### Added to Top Bar

The 🖌 (`stylus_note`) icon is added to the right-side button cluster in the channel top bar in `ChatLayout.tsx`. Render conditions:

- Active view is a `"text"` or `"place"` channel
- No overlay active (settings, DMs, sources browser)

On **mobile**: sits in the top bar right cluster, left of the wrench/account buttons.  
On **desktop**: sits in the channel header right cluster, left of the notifications bell.

The button is icon-only (no label). When the pre-send format panel is open it receives the `bg-primary/20 border-primary/40` highlight treatment matching other active-state toolbar buttons.

The pre-send format panel is a `glass-panel` popover anchored below the button, `w-[260px]`, closes on send / Escape / click-outside.

---

## 4. Place Channel Type

### Channel Definition

New value `"place"` added to `channel_type` in the `Channel` API type and the channel creation payload. Place channels appear in the channel sidebar under a new **"Places"** section header, using the `◈` icon.

Backend: the existing channel creation endpoint accepts `channel_type: "place"`. The channel participates in both the Matrix text room (for chat history) and the LiveKit voice infrastructure (for audio/video). No new backend voice protocol is required.

### PlaceVoiceBanner Component

Rendered at the `ChatLayout` level — **above** the channel view, **below** the top bar — so it persists as the user navigates between channels, DMs, or settings while connected to a Place voice session.

The banner renders when `voiceStore.connected === true && voiceStore.channelType === "place"`.

The voice store gains one new field: `channelType: "place" | "voice" | null`.

#### Banner States

**Absent:** Not connected to any Place.

**Thin strip (~48px) — audio-only:**  
Pills share banner width equally. Each pill contains: avatar circle, display name, speaking indicator (green pulse) or mute icon.

**Expanded — one or more video feeds:**  
Audio-only pills remain thin in the vertical axis. Video pills expand: width = equal share of banner; height = width (square 1:1 viewport). If the total pill width would exceed the viewport, pills overflow into a horizontal scroll with a fade mask. The banner height is driven by the tallest pill (the first video feed's square dimension).

**Dismissed:**  
Banner hidden. Top bar background shifts to `bg-primary/15` as a persistent signal. A small `◈ ●` indicator in the top bar left section (next to the channel name) restores the banner on tap.

#### Pill Design

```
┌─────────────────────────────┐  ← audio-only pill (thin)
│ ● [Avatar]  username    🔇  │
└─────────────────────────────┘

┌──────────────┐  ← video pill (square)
│              │
│  [camera]    │
│    feed      │
│              │
└──────────────┘
│ ● alice  📷  │  ← name strip below video
└──────────────┘
```

Clicking a video pill navigates to `BroadcastView`.

#### BroadcastView

Full-screen dedicated view, one feed at a time:
- Full-viewport video with user name overlay
- Prev / Next controls to move between all active video feeds in the Place
- Back button returns to the Place channel
- Accessible only while connected to a Place session

#### Voice Controls

The banner has a `⋯` overflow button exposing: Mute mic, Toggle camera, Leave. Full audio settings remain in the existing voice settings flow.

### Place as a Text Channel

Below the banner the Place renders identically to a `"text"` channel: full `MessageList`, `MessageInput` with `+` tools and attach, all format features. The chat and voice coexist in the same channel view.

---

## File Impact Summary

| File | Change |
|------|--------|
| `components/chat/MessageInput.tsx` | Remove format button/panel/snippets; add `+` tools button |
| `components/chat/ChatToolsPanel.tsx` | **New** — grid pop-up + tool registry |
| `components/chat/tools/` | **New dir** — one file per tool composer (PollComposer, HeatmapComposer, etc.) |
| `components/chat/MessageList.tsx` | Add per-message 🖌 brush icon; wire `useResolvedFormat` |
| `components/chat/FormatPopover.tsx` | **New** — shared popover UI for both pre-send and per-message format |
| `components/layout/ChatLayout.tsx` | Add 🖌 to top bar; add `PlaceVoiceBanner`; add `BroadcastView` route |
| `components/voice/PlaceVoiceBanner.tsx` | **New** — pill banner component |
| `components/voice/BroadcastView.tsx` | **New** — full-screen single-feed view |
| `stores/format.ts` | **New** — `useFormatStore` with message/sender overrides |
| `stores/voice.ts` | Add `channelType` field |
| `hooks/useResolvedFormat.ts` | **New** — precedence resolution hook |
| `api/concord.ts` | Add `"place"` to `Channel.channel_type` union |
| `components/layout/ChannelSidebar.tsx` | Add Places section with `◈` icon |

---

## Out of Scope

- Server-side delivery of scheduled messages (backend work, separate spec)
- GIF provider integration (API key management, separate infra decision)
- User-installable font management UI
- BroadcastView "related streams" navigation (referenced in brief; deferred to follow-on)
