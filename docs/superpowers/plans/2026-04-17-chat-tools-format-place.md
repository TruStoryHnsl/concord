# Chat Tools, Format System, and Place Channels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `+` chat tools panel to `MessageInput`, a two-sided format system with a top-bar button, and a new `"place"` channel type with a persistent voice/video pill banner.

**Architecture:** Four loosely coupled layers — (1) a new `useFormatStore` Zustand store that bridges the top-bar format button with `MessageInput` and per-message viewer overrides; (2) a `ChatToolsPanel` component registered via a plain `ChatTool[]` array that `MessageInput` renders above itself; (3) a `PlaceVoiceBanner` rendered at `ChatLayout` level for navigation persistence; (4) `"place"` as a new value in the `Channel.channel_type` union that drives sidebar grouping and banner visibility.

**Tech Stack:** React 18, TypeScript, Zustand (persist middleware), Tailwind CSS, existing `glass-panel` / `btn-press` design tokens, Matrix custom event fields (`x.concord.display`).

---

## File Map

| Status | Path | Responsibility |
|--------|------|----------------|
| **Create** | `client/src/stores/format.ts` | `useFormatStore` — draft format state + viewer overrides |
| **Create** | `client/src/hooks/useResolvedFormat.ts` | Precedence resolution hook |
| **Create** | `client/src/components/chat/ChatToolsPanel.tsx` | Grid pop-up + `ChatTool` registry |
| **Create** | `client/src/components/chat/tools/PollComposer.tsx` | Poll composer sheet |
| **Create** | `client/src/components/chat/tools/HeatmapComposer.tsx` | Heatmap composer sheet |
| **Create** | `client/src/components/chat/tools/TimedComposer.tsx` | Timed-delete composer sheet |
| **Create** | `client/src/components/chat/tools/ScheduledComposer.tsx` | Scheduled-send composer sheet |
| **Create** | `client/src/components/chat/FormatPopover.tsx` | Shared popover UI (alignment, size, color, font) |
| **Create** | `client/src/components/voice/PlaceVoiceBanner.tsx` | Pill-row banner for Place voice |
| **Modify** | `client/src/components/chat/MessageInput.tsx` | Remove old format panel; add `+` tools button |
| **Modify** | `client/src/components/chat/MessageList.tsx` | Add per-message 🖌 hover button wired to `FormatPopover` |
| **Modify** | `client/src/components/layout/ChatLayout.tsx` | Add format 🖌 to top-bar; render `PlaceVoiceBanner`; update `isVoiceChannel` guards |
| **Modify** | `client/src/components/layout/ChannelSidebar.tsx` | Add `"place"` filter + Places sidebar section with `◈` icon |
| **Modify** | `client/src/stores/voice.ts` | Add `channelType: "place" \| "voice" \| null` field |
| **Modify** | `client/src/api/concord.ts` | Narrow `channel_type` to a union type |

---

## Task 1 — `useFormatStore` (format state store)

**Files:**
- Create: `client/src/stores/format.ts`

- [ ] **Step 1: Write the store**

```ts
// client/src/stores/format.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface FormatOverride {
  alignment: "left" | "center" | "right" | "justify";
  fontSize: number;
  color: string;
  fontFamily: string;
}

const DEFAULT_FORMAT: FormatOverride = {
  alignment: "left",
  fontSize: 14,
  color: "",        // empty = theme default
  fontFamily: "system",
};

interface FormatState {
  // Viewer overrides (persisted to localStorage)
  messageFormats: Record<string, FormatOverride>;
  senderFormats: Record<string, FormatOverride>;
  setMessageFormat: (id: string, fmt: Partial<FormatOverride>) => void;
  setSenderFormat: (userId: string, fmt: Partial<FormatOverride>) => void;
  clearMessageFormat: (id: string) => void;
  clearSenderFormat: (userId: string) => void;

  // Pre-send draft (ephemeral — not persisted, resets on send)
  draftFormat: FormatOverride;
  formatPanelOpen: boolean;
  setDraftFormat: (fmt: Partial<FormatOverride>) => void;
  clearDraftFormat: () => void;
  setFormatPanelOpen: (open: boolean) => void;
}

export const useFormatStore = create<FormatState>()(
  persist(
    (set, get) => ({
      messageFormats: {},
      senderFormats: {},
      setMessageFormat: (id, fmt) =>
        set((s) => ({
          messageFormats: {
            ...s.messageFormats,
            [id]: { ...(s.messageFormats[id] ?? DEFAULT_FORMAT), ...fmt },
          },
        })),
      setSenderFormat: (userId, fmt) =>
        set((s) => ({
          senderFormats: {
            ...s.senderFormats,
            [userId]: { ...(s.senderFormats[userId] ?? DEFAULT_FORMAT), ...fmt },
          },
        })),
      clearMessageFormat: (id) =>
        set((s) => {
          const next = { ...s.messageFormats };
          delete next[id];
          return { messageFormats: next };
        }),
      clearSenderFormat: (userId) =>
        set((s) => {
          const next = { ...s.senderFormats };
          delete next[userId];
          return { senderFormats: next };
        }),

      draftFormat: { ...DEFAULT_FORMAT },
      formatPanelOpen: false,
      setDraftFormat: (fmt) =>
        set((s) => ({ draftFormat: { ...s.draftFormat, ...fmt } })),
      clearDraftFormat: () => set({ draftFormat: { ...DEFAULT_FORMAT } }),
      setFormatPanelOpen: (open) => set({ formatPanelOpen: open }),
    }),
    {
      name: "concord_format_overrides",
      // Only persist viewer overrides; draft state is ephemeral.
      partialize: (s) => ({
        messageFormats: s.messageFormats,
        senderFormats: s.senderFormats,
      }),
    },
  ),
);

export { DEFAULT_FORMAT };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors from `stores/format.ts`.

- [ ] **Step 3: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/stores/format.ts
git commit -m "feat(format): add useFormatStore with draft + viewer overrides"
```

---

## Task 2 — `useResolvedFormat` hook

**Files:**
- Create: `client/src/hooks/useResolvedFormat.ts`

- [ ] **Step 1: Write the hook**

```ts
// client/src/hooks/useResolvedFormat.ts
import { useFormatStore, type FormatOverride, DEFAULT_FORMAT } from "../stores/format";
import type { ChatMessage } from "./useMatrix";

// Matrix custom display field type
interface XConcordDisplay {
  alignment?: "left" | "center" | "right" | "justify";
  fontSize?: number;
  color?: string;
  fontFamily?: string;
}

function parseSenderDisplay(msg: ChatMessage): Partial<FormatOverride> {
  // Matrix event content arrives as `content` on the raw event; ChatMessage
  // exposes it as `content` when present. We read x.concord.display from it.
  const raw = (msg as { content?: Record<string, unknown> }).content;
  if (!raw) return {};
  const display = raw["x.concord.display"] as XConcordDisplay | undefined;
  if (!display) return {};
  return {
    ...(display.alignment !== undefined && { alignment: display.alignment }),
    ...(display.fontSize !== undefined && { fontSize: display.fontSize }),
    ...(display.color !== undefined && { color: display.color }),
    ...(display.fontFamily !== undefined && { fontFamily: display.fontFamily }),
  };
}

/** Returns the effective format for a single message applying the
 *  four-level precedence chain:
 *  1. Viewer per-message override
 *  2. Viewer per-sender override
 *  3. Sender's embedded x.concord.display defaults
 *  4. Concord global defaults
 */
export function useResolvedFormat(msg: ChatMessage): FormatOverride {
  const messageFormats = useFormatStore((s) => s.messageFormats);
  const senderFormats = useFormatStore((s) => s.senderFormats);

  const base: FormatOverride = { ...DEFAULT_FORMAT };
  const senderOverride = parseSenderDisplay(msg);
  const senderViewerOverride = senderFormats[msg.sender] ?? {};
  const messageViewerOverride = messageFormats[msg.id] ?? {};

  return {
    ...base,
    ...senderOverride,
    ...senderViewerOverride,
    ...messageViewerOverride,
  };
}
```

- [ ] **Step 2: Check ChatMessage type to confirm `content` field**

```bash
cd /home/corr/projects/concord
grep -n "content" client/src/hooks/useMatrix.ts | head -20
```

If `ChatMessage` already has a `content` field typed differently, adjust the cast in `parseSenderDisplay` accordingly.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/hooks/useResolvedFormat.ts
git commit -m "feat(format): add useResolvedFormat hook with 4-level precedence"
```

---

## Task 3 — `FormatPopover` shared component

**Files:**
- Create: `client/src/components/chat/FormatPopover.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/chat/FormatPopover.tsx
import { useRef, useEffect } from "react";
import type { FormatOverride } from "../../stores/format";

const ALIGNMENT_OPTIONS: { value: FormatOverride["alignment"]; icon: string; label: string }[] = [
  { value: "left", icon: "format_align_left", label: "Left" },
  { value: "center", icon: "format_align_center", label: "Center" },
  { value: "right", icon: "format_align_right", label: "Right" },
  { value: "justify", icon: "format_align_justify", label: "Justify" },
];

const FONT_FAMILIES = ["system", "serif", "mono"] as const;
const FONT_LABELS: Record<string, string> = {
  system: "System",
  serif: "Serif",
  mono: "Monospace",
};

const COLOR_PRESETS = ["", "#e5e7eb", "#7c5cfc", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const COLOR_LABELS: Record<string, string> = {
  "": "Default",
  "#e5e7eb": "Light",
  "#7c5cfc": "Purple",
  "#10b981": "Green",
  "#f59e0b": "Amber",
  "#ef4444": "Red",
  "#3b82f6": "Blue",
};

interface FormatPopoverProps {
  value: FormatOverride;
  onChange: (fmt: Partial<FormatOverride>) => void;
  onClose: () => void;
  /** When present, show scope toggle and reset. For per-message/sender overrides. */
  viewerMode?: {
    scope: "message" | "sender";
    senderName: string;
    onScopeChange: (scope: "message" | "sender") => void;
    onReset: () => void;
  };
  anchorRef?: React.RefObject<HTMLElement>;
}

export function FormatPopover({ value, onChange, onClose, viewerMode }: FormatPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="w-[260px] glass-panel rounded-2xl p-3 space-y-3 shadow-2xl z-50"
    >
      <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-label">
        Message Display
      </p>

      {/* Alignment */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-on-surface-variant w-14">Align</span>
        <div className="flex gap-1">
          {ALIGNMENT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ alignment: opt.value })}
              title={opt.label}
              className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${
                value.alignment === opt.value
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-sm">{opt.icon}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Font size */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-on-surface-variant w-14">Size</span>
        <input
          type="range"
          min={12}
          max={32}
          step={1}
          value={value.fontSize}
          onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
          className="flex-1 accent-primary"
        />
        <span className="text-[10px] text-on-surface-variant w-6 text-right">{value.fontSize}</span>
      </div>

      {/* Text color */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-on-surface-variant w-14">Color</span>
        <div className="flex gap-1.5 flex-wrap">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c || "default"}
              type="button"
              title={COLOR_LABELS[c] ?? c}
              onClick={() => onChange({ color: c })}
              className={`w-4 h-4 rounded-full border transition-all ${
                value.color === c ? "border-white scale-110" : "border-transparent"
              }`}
              style={{
                background: c || "var(--color-on-surface)",
                opacity: c ? 1 : 0.4,
              }}
            />
          ))}
        </div>
      </div>

      {/* Font family */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-on-surface-variant w-14">Font</span>
        <select
          value={value.fontFamily}
          onChange={(e) => onChange({ fontFamily: e.target.value })}
          className="flex-1 bg-surface-container-high rounded-lg px-2 py-1 text-xs text-on-surface border-none outline-none"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>{FONT_LABELS[f]}</option>
          ))}
        </select>
      </div>

      {/* Viewer-mode scope + reset */}
      {viewerMode && (
        <div className="pt-2 border-t border-outline-variant/20 space-y-2">
          <div className="flex rounded-lg overflow-hidden border border-outline-variant/20">
            <button
              type="button"
              onClick={() => viewerMode.onScopeChange("message")}
              className={`flex-1 text-[10px] py-1 transition-colors ${
                viewerMode.scope === "message"
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              }`}
            >
              This message
            </button>
            <button
              type="button"
              onClick={() => viewerMode.onScopeChange("sender")}
              className={`flex-1 text-[10px] py-1 transition-colors ${
                viewerMode.scope === "sender"
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
              }`}
            >
              All from {viewerMode.senderName}
            </button>
          </div>
          <button
            type="button"
            onClick={viewerMode.onReset}
            className="w-full text-[10px] text-error hover:text-error/80 transition-colors text-left"
          >
            Reset to sender default
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/chat/FormatPopover.tsx
git commit -m "feat(format): add FormatPopover shared popover component"
```

---

## Task 4 — Format button in top bar + pre-send panel (ChatLayout)

The `stylus_note` format button moves from `MessageInput` to the desktop channel header and the mobile top bar. The pre-send `FormatPopover` opens from it.

**Files:**
- Modify: `client/src/components/layout/ChatLayout.tsx`

- [ ] **Step 1: Import `useFormatStore` and `FormatPopover` at the top of ChatLayout.tsx**

Find the existing imports block (around line 1–74) and add:

```tsx
import { useFormatStore } from "../../stores/format";
import { FormatPopover } from "../chat/FormatPopover";
```

- [ ] **Step 2: Read the store in the component body**

Inside `ChatLayout` (after other `useXStore` calls), add:

```tsx
const draftFormat = useFormatStore((s) => s.draftFormat);
const formatPanelOpen = useFormatStore((s) => s.formatPanelOpen);
const setDraftFormat = useFormatStore((s) => s.setDraftFormat);
const setFormatPanelOpen = useFormatStore((s) => s.setFormatPanelOpen);
```

- [ ] **Step 3: Derive whether the format button should show**

After computing `isVoiceChannel` and `isAppChannel` (grep the file for these), add:

```tsx
const showFormatButton =
  !dmActive &&
  activeChannel !== null &&
  (activeChannel.channel_type === "text" || activeChannel.channel_type === "place");
```

- [ ] **Step 4: Add the format button to the DESKTOP channel header right cluster**

In the desktop channel header (around line 1607), inside the `<div className="flex items-center gap-0.5 flex-shrink-0">` that holds `HostingStatusButton` and `TopBarMoreMenu`, add the format button BEFORE `TopBarMoreMenu`:

```tsx
{showFormatButton && (
  <div className="relative">
    <TopBarIconButton
      icon="stylus_note"
      label="Format message"
      onClick={() => setFormatPanelOpen(!formatPanelOpen)}
      className={formatPanelOpen ? "bg-primary/20 border border-primary/40" : ""}
    />
    {formatPanelOpen && (
      <div className="absolute right-0 top-full mt-1 z-50">
        <FormatPopover
          value={draftFormat}
          onChange={setDraftFormat}
          onClose={() => setFormatPanelOpen(false)}
        />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Add the format button to the MOBILE top bar right cluster**

In the mobile top bar (around line 1189), inside the `<div className="flex items-center gap-0.5 flex-shrink-0">` that holds `HostingStatusButton` and `TopBarMoreMenu`, add before `TopBarMoreMenu`:

```tsx
{showFormatButton && (
  <div className="relative">
    <TopBarIconButton
      icon="stylus_note"
      label="Format message"
      onClick={() => setFormatPanelOpen(!formatPanelOpen)}
      className={formatPanelOpen ? "bg-primary/20 border border-primary/40" : ""}
    />
    {formatPanelOpen && (
      <div className="absolute right-0 top-full mt-1 z-50">
        <FormatPopover
          value={draftFormat}
          onChange={setDraftFormat}
          onClose={() => setFormatPanelOpen(false)}
        />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 6: Verify `TopBarIconButton` accepts a `className` prop**

```bash
cd /home/corr/projects/concord
grep -n "TopBarIconButton" client/src/components/layout/ChatLayout.tsx | head -5
grep -n "function TopBarIconButton" client/src/components/layout/ChatLayout.tsx
```

Read the `TopBarIconButton` function signature. If it doesn't accept `className`, add it:

```tsx
function TopBarIconButton({
  icon,
  label,
  onClick,
  className = "",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`btn-press w-9 h-9 flex items-center justify-center rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors ${className}`}
    >
      <span className="material-symbols-outlined text-xl">{icon}</span>
    </button>
  );
}
```

- [ ] **Step 7: Verify TypeScript compiles and dev server starts**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 8: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/layout/ChatLayout.tsx
git commit -m "feat(format): add format 🖌 button to top bar (desktop + mobile)"
```

---

## Task 5 — Remove old format panel from MessageInput; add `+` tools button placeholder

This task strips the old snippet panel from `MessageInput` and adds a `+` button that will wire to `ChatToolsPanel` in Task 6.

**Files:**
- Modify: `client/src/components/chat/MessageInput.tsx`

- [ ] **Step 1: Remove snippet constants and state**

Delete or comment out lines 22–48 (the three `ComposerSnippet` arrays and type) and the `formattingOpen` state on line 66. Also remove `insertSnippet` (lines 226–243).

Specifically, remove:
```tsx
type ComposerSnippet = { ... };
const MARKDOWN_SNIPPETS: ComposerSnippet[] = [...];
const LAYOUT_SNIPPETS: ComposerSnippet[] = [...];
const WIDGET_SNIPPETS: ComposerSnippet[] = [...];
```
and:
```tsx
const [formattingOpen, setFormattingOpen] = useState(false);
```
and:
```tsx
const insertSnippet = useCallback(...);
```

- [ ] **Step 2: Remove the format button + panel from the JSX**

Remove the entire `<div className="absolute right-4 bottom-[78px] ...">` block (lines 256–315) that contains the `formattingOpen` panel and the `stylus_note` button.

- [ ] **Step 3: Add the `+` tools button and `toolsPanelOpen` state**

At the top of the component (where `formattingOpen` was), add:
```tsx
const [toolsPanelOpen, setToolsPanelOpen] = useState(false);
```

In the input row JSX, before the `{onSendFile && ...}` attach button block, add the `+` button:

```tsx
<button
  type="button"
  onClick={() => setToolsPanelOpen((o) => !o)}
  className="btn-press p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center text-primary hover:text-primary/80 transition-colors flex-shrink-0 rounded-xl font-bold text-lg"
  title="Chat tools"
>
  +
</button>
```

- [ ] **Step 4: Wire `clearDraftFormat` on send**

Import the store:
```tsx
import { useFormatStore } from "../../stores/format";
```

Inside the component body:
```tsx
const clearDraftFormat = useFormatStore((s) => s.clearDraftFormat);
const draftFormat = useFormatStore((s) => s.draftFormat);
```

In `handleSubmit`, after `setText("")`, add:
```tsx
clearDraftFormat();
```

The `draftFormat` value will be used in Task 6 when `onSend` is extended to serialize `x.concord.display` into the outgoing message.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/chat/MessageInput.tsx
git commit -m "feat(format): remove old snippet panel from MessageInput; add + tools button"
```

---

## Task 6 — `ChatToolsPanel` component + tool registry

**Files:**
- Create: `client/src/components/chat/ChatToolsPanel.tsx`

- [ ] **Step 1: Write the `ChatTool` interface and registry**

```tsx
// client/src/components/chat/ChatToolsPanel.tsx
import { useRef, useEffect } from "react";

export interface ComposerProps {
  onSend: (text: string) => Promise<void>;
  onClose: () => void;
}

export interface ChatTool {
  id: string;
  label: string;
  icon: string; // emoji or material symbol name
  composer: React.ComponentType<ComposerProps> | null; // null = send immediately
}

// Tool registry — import composers lazily to avoid top-level circular refs
// (composers are added in Task 7; placeholders here)
export const CHAT_TOOLS: ChatTool[] = [
  { id: "poll", label: "Poll", icon: "📊", composer: null },         // Task 7
  { id: "heatmap", label: "Heatmap", icon: "🔥", composer: null },   // Task 7
  { id: "gallery", label: "Gallery", icon: "🖼️", composer: null },
  { id: "timed", label: "Timed", icon: "⏱️", composer: null },       // Task 7
  { id: "scheduled", label: "Scheduled", icon: "📨", composer: null }, // Task 7
  { id: "gif", label: "GIF", icon: "🎞️", composer: null },
  { id: "more", label: "More", icon: "➕", composer: null },
];
```

- [ ] **Step 2: Write the panel component**

```tsx
interface ChatToolsPanelProps {
  onSelectTool: (tool: ChatTool) => void;
  onClose: () => void;
}

export function ChatToolsPanel({ onSelectTool, onClose }: ChatToolsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="glass-panel rounded-2xl p-3 shadow-2xl z-50"
      style={{ width: "256px" }}
    >
      <div className="grid grid-cols-4 gap-2">
        {CHAT_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => {
              onSelectTool(tool);
              if (!tool.composer) onClose();
            }}
            className="btn-press flex flex-col items-center justify-center gap-1 p-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest transition-colors min-h-[48px] min-w-[48px]"
            title={tool.label}
          >
            <span className="text-2xl leading-none">{tool.icon}</span>
            <span className="text-[9px] text-on-surface-variant font-label truncate w-full text-center">
              {tool.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the panel into MessageInput**

In `MessageInput.tsx`, import the panel and active composer state:

```tsx
import { ChatToolsPanel, type ChatTool } from "./ChatToolsPanel";
```

Add to the component body:
```tsx
const [activeTool, setActiveTool] = useState<ChatTool | null>(null);
```

Handle tool selection:
```tsx
const handleToolSelect = (tool: ChatTool) => {
  if (tool.composer) {
    setActiveTool(tool);
    setToolsPanelOpen(false);
  }
  // Tools with composer=null (GIF, Gallery, More) are no-ops for now
};
```

In JSX, above the `<form>` return, show the composer sheet when active:
```tsx
{activeTool?.composer && (
  <div className="absolute bottom-full left-0 right-0 z-50 px-4 pb-2">
    <activeTool.composer
      onSend={async (text) => {
        await onSend(text);
        setActiveTool(null);
      }}
      onClose={() => setActiveTool(null)}
    />
  </div>
)}
```

Show the tools panel above the `+` button:
```tsx
{toolsPanelOpen && (
  <div className="absolute bottom-full left-4 mb-2 z-50">
    <ChatToolsPanel
      onSelectTool={handleToolSelect}
      onClose={() => setToolsPanelOpen(false)}
    />
  </div>
)}
```

The tools panel is anchored to the form container, so position the `<form>` as `relative`:
- It already has `className="relative bg-surface-container-low flex-shrink-0"` ✓

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/chat/ChatToolsPanel.tsx client/src/components/chat/MessageInput.tsx
git commit -m "feat(tools): add ChatToolsPanel grid pop-up + wire to MessageInput"
```

---

## Task 7 — Tool composer sheets (Poll, Heatmap, Timed, Scheduled)

**Files:**
- Create: `client/src/components/chat/tools/PollComposer.tsx`
- Create: `client/src/components/chat/tools/HeatmapComposer.tsx`
- Create: `client/src/components/chat/tools/TimedComposer.tsx`
- Create: `client/src/components/chat/tools/ScheduledComposer.tsx`
- Modify: `client/src/components/chat/ChatToolsPanel.tsx` (register composers)

- [ ] **Step 1: Write PollComposer**

```tsx
// client/src/components/chat/tools/PollComposer.tsx
import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

export function PollComposer({ onSend, onClose }: ComposerProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);

  const addOption = () => setOptions((o) => [...o, ""]);
  const setOption = (i: number, val: string) =>
    setOptions((o) => o.map((v, idx) => (idx === i ? val : v)));

  const handleSend = async () => {
    if (!question.trim()) return;
    const validOpts = options.filter((o) => o.trim());
    if (validOpts.length < 2) return;
    const text = `/poll ${question.trim()} | ${validOpts.join(" | ")}`;
    await onSend(text);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Poll</p>
      <input
        autoFocus
        type="text"
        placeholder="Question..."
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none"
      />
      <div className="space-y-2">
        {options.map((opt, i) => (
          <input
            key={i}
            type="text"
            placeholder={`Option ${i + 1}`}
            value={opt}
            onChange={(e) => setOption(i, e.target.value)}
            className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none"
          />
        ))}
      </div>
      <button
        type="button"
        onClick={addOption}
        className="text-xs text-primary hover:text-primary/80 transition-colors"
      >
        + Add option
      </button>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button type="button" onClick={handleSend} disabled={!question.trim() || options.filter((o) => o.trim()).length < 2} className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity">
          Send Poll
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write HeatmapComposer**

```tsx
// client/src/components/chat/tools/HeatmapComposer.tsx
import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

export function HeatmapComposer({ onSend, onClose }: ComposerProps) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [granularity, setGranularity] = useState<"day" | "hour">("day");

  const handleSend = async () => {
    if (!title.trim() || !startDate || !endDate) return;
    const text = `/heatmap ${title.trim()} | ${startDate} | ${endDate} | ${granularity}`;
    await onSend(text);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Availability Heatmap</p>
      <input
        autoFocus
        type="text"
        placeholder="Event title..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none"
      />
      <div className="flex gap-2">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="flex-1 bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface outline-none"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="flex-1 bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface outline-none"
        />
      </div>
      <div className="flex rounded-xl overflow-hidden border border-outline-variant/20">
        <button
          type="button"
          onClick={() => setGranularity("day")}
          className={`flex-1 py-1.5 text-xs transition-colors ${granularity === "day" ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
        >
          Full day
        </button>
        <button
          type="button"
          onClick={() => setGranularity("hour")}
          className={`flex-1 py-1.5 text-xs transition-colors ${granularity === "hour" ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
        >
          Hourly
        </button>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button type="button" onClick={handleSend} disabled={!title.trim() || !startDate || !endDate} className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity">
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write TimedComposer**

```tsx
// client/src/components/chat/tools/TimedComposer.tsx
import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

const DURATION_PRESETS = [
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "1 hr", value: 3600 },
  { label: "1 day", value: 86400 },
];

export function TimedComposer({ onSend, onClose }: ComposerProps) {
  const [messageText, setMessageText] = useState("");
  const [seconds, setSeconds] = useState(300);

  const handleSend = async () => {
    if (!messageText.trim()) return;
    const text = `/timed ${seconds} | ${messageText.trim()}`;
    await onSend(text);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Timed Message</p>
      <textarea
        autoFocus
        rows={3}
        placeholder="Message that will auto-delete..."
        value={messageText}
        onChange={(e) => setMessageText(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none resize-none"
      />
      <div className="flex gap-1.5">
        {DURATION_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setSeconds(p.value)}
            className={`flex-1 py-1.5 rounded-lg text-xs transition-colors ${seconds === p.value ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button type="button" onClick={handleSend} disabled={!messageText.trim()} className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity">
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write ScheduledComposer**

```tsx
// client/src/components/chat/tools/ScheduledComposer.tsx
import { useState } from "react";
import type { ComposerProps } from "../ChatToolsPanel";

export function ScheduledComposer({ onSend, onClose }: ComposerProps) {
  const [messageText, setMessageText] = useState("");
  const [deliverAt, setDeliverAt] = useState("");

  const handleSend = async () => {
    if (!messageText.trim() || !deliverAt) return;
    const text = `/scheduled ${deliverAt} | ${messageText.trim()}`;
    await onSend(text);
    onClose();
  };

  return (
    <div className="glass-panel rounded-2xl p-4 space-y-3">
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Scheduled Message</p>
      <textarea
        autoFocus
        rows={3}
        placeholder="Message to send later..."
        value={messageText}
        onChange={(e) => setMessageText(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/50 outline-none resize-none"
      />
      <input
        type="datetime-local"
        value={deliverAt}
        onChange={(e) => setDeliverAt(e.target.value)}
        className="w-full bg-surface-container-high rounded-xl px-3 py-2 text-sm text-on-surface outline-none"
      />
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="flex-1 btn-press rounded-xl py-2 text-sm bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors">
          Cancel
        </button>
        <button type="button" onClick={handleSend} disabled={!messageText.trim() || !deliverAt} className="flex-1 btn-press rounded-xl py-2 text-sm bg-primary text-on-primary disabled:opacity-40 transition-opacity">
          Schedule
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Register composers in ChatToolsPanel.tsx**

In `ChatToolsPanel.tsx`, import the composers and wire them:

```tsx
import { PollComposer } from "./tools/PollComposer";
import { HeatmapComposer } from "./tools/HeatmapComposer";
import { TimedComposer } from "./tools/TimedComposer";
import { ScheduledComposer } from "./tools/ScheduledComposer";

export const CHAT_TOOLS: ChatTool[] = [
  { id: "poll", label: "Poll", icon: "📊", composer: PollComposer },
  { id: "heatmap", label: "Heatmap", icon: "🔥", composer: HeatmapComposer },
  { id: "gallery", label: "Gallery", icon: "🖼️", composer: null },
  { id: "timed", label: "Timed", icon: "⏱️", composer: TimedComposer },
  { id: "scheduled", label: "Scheduled", icon: "📨", composer: ScheduledComposer },
  { id: "gif", label: "GIF", icon: "🎞️", composer: null },
  { id: "more", label: "More", icon: "➕", composer: null },
];
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/chat/tools/ client/src/components/chat/ChatToolsPanel.tsx
git commit -m "feat(tools): add Poll, Heatmap, Timed, and Scheduled composer sheets"
```

---

## Task 8 — Per-message format brush in MessageList

The 🖌 icon appears in each message header row on hover (desktop) or long-press (mobile). Tapping opens `FormatPopover` in viewer mode.

**Files:**
- Modify: `client/src/components/chat/MessageList.tsx`

- [ ] **Step 1: Import the required hooks and components**

At the top of `MessageList.tsx`, add:
```tsx
import { useState } from "react";
import { useFormatStore } from "../../stores/format";
import { FormatPopover } from "./FormatPopover";
import { useResolvedFormat } from "../../hooks/useResolvedFormat";
import { useDisplayName } from "../../hooks/useDisplayName";
```

Note: `useDisplayName` may already be imported — check before adding.

- [ ] **Step 2: Add per-message format state inside MessageList**

Inside the `MessageList` component body (after `hoveredId` and `reactingId`), add:
```tsx
const [formatOpenId, setFormatOpenId] = useState<string | null>(null);
const [formatScope, setFormatScope] = useState<"message" | "sender">("message");
const setMessageFormat = useFormatStore((s) => s.setMessageFormat);
const setSenderFormat = useFormatStore((s) => s.setSenderFormat);
const clearMessageFormat = useFormatStore((s) => s.clearMessageFormat);
const clearSenderFormat = useFormatStore((s) => s.clearSenderFormat);
const messageFormats = useFormatStore((s) => s.messageFormats);
const senderFormats = useFormatStore((s) => s.senderFormats);
```

- [ ] **Step 3: Add the brush icon to the message header row**

Inside the `messages.map` loop, find the `showHeader` block that renders the username and timestamp. After the timestamp `<span>`, add:

```tsx
{showHeader && (
  <button
    type="button"
    className={`ml-1 w-4 h-4 flex items-center justify-center rounded transition-opacity text-on-surface-variant hover:text-on-surface ${
      isHovered || formatOpenId === msg.id ? "opacity-100" : "opacity-0"
    }`}
    onClick={() => {
      setFormatOpenId(formatOpenId === msg.id ? null : msg.id);
      setFormatScope("message");
    }}
    title="Format this message"
  >
    🖌
  </button>
)}
```

The format button ONLY renders when `showHeader` is true (first message from a sender in a group). This is the same condition that shows the username.

- [ ] **Step 4: Render the FormatPopover per message**

Inside the message `<div key={msg.id}>` block, after the action bar and after the hover brush button is in place, add the popover. Create a small inline component to get the resolved format (since hooks can't be called conditionally):

```tsx
{formatOpenId === msg.id && (
  <FormatMessageEntry
    msg={msg}
    scope={formatScope}
    onScopeChange={setFormatScope}
    onClose={() => setFormatOpenId(null)}
    messageFormats={messageFormats}
    senderFormats={senderFormats}
    setMessageFormat={setMessageFormat}
    setSenderFormat={setSenderFormat}
    clearMessageFormat={clearMessageFormat}
    clearSenderFormat={clearSenderFormat}
  />
)}
```

Write `FormatMessageEntry` as a small component at the bottom of `MessageList.tsx` (outside the main component) that calls `useResolvedFormat`:

```tsx
function FormatMessageEntry({
  msg,
  scope,
  onScopeChange,
  onClose,
  messageFormats,
  senderFormats,
  setMessageFormat,
  setSenderFormat,
  clearMessageFormat,
  clearSenderFormat,
}: {
  msg: ChatMessage;
  scope: "message" | "sender";
  onScopeChange: (s: "message" | "sender") => void;
  onClose: () => void;
  messageFormats: Record<string, import("../../stores/format").FormatOverride>;
  senderFormats: Record<string, import("../../stores/format").FormatOverride>;
  setMessageFormat: (id: string, fmt: Partial<import("../../stores/format").FormatOverride>) => void;
  setSenderFormat: (userId: string, fmt: Partial<import("../../stores/format").FormatOverride>) => void;
  clearMessageFormat: (id: string) => void;
  clearSenderFormat: (userId: string) => void;
}) {
  const resolved = useResolvedFormat(msg);
  const senderName = useDisplayName(msg.sender);

  const currentValue =
    scope === "message"
      ? (messageFormats[msg.id] ?? resolved)
      : (senderFormats[msg.sender] ?? resolved);

  const handleChange = (fmt: Partial<import("../../stores/format").FormatOverride>) => {
    if (scope === "message") {
      setMessageFormat(msg.id, fmt);
    } else {
      setSenderFormat(msg.sender, fmt);
    }
  };

  const handleReset = () => {
    if (scope === "message") clearMessageFormat(msg.id);
    else clearSenderFormat(msg.sender);
  };

  return (
    <div className="absolute left-10 top-0 z-30">
      <FormatPopover
        value={currentValue}
        onChange={handleChange}
        onClose={onClose}
        viewerMode={{
          scope,
          senderName,
          onScopeChange,
          onReset: handleReset,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/chat/MessageList.tsx
git commit -m "feat(format): add per-message 🖌 brush icon with FormatPopover in viewer mode"
```

---

## Task 9 — Add `"place"` to Channel type + voice store

**Files:**
- Modify: `client/src/api/concord.ts`
- Modify: `client/src/stores/voice.ts`

- [ ] **Step 1: Narrow `channel_type` in concord.ts**

In `client/src/api/concord.ts`, change the `Channel` interface:

```ts
// Before:
channel_type: string;

// After:
channel_type: "text" | "voice" | "app" | "place";
```

- [ ] **Step 2: Add `channelType` field to VoiceState**

In `client/src/stores/voice.ts`, add to the `VoiceState` interface:

```ts
channelType: "place" | "voice" | null;
```

Add to the `connect` params:
```ts
connect: (params: {
  ...existing fields...
  channelType?: "place" | "voice";
}) => void;
```

In the store initial state:
```ts
channelType: null,
```

In the `connect` action:
```ts
set({
  ...existing fields...
  channelType: params.channelType ?? "voice",
});
```

In the `disconnect` action (find it and add):
```ts
channelType: null,
```

- [ ] **Step 3: Check for TypeScript errors from the channel_type narrowing**

The narrowing may break places that pass `channel_type` as an arbitrary `string`. Run:

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | grep "channel_type" | head -20
```

For any error site that creates a channel with a dynamic type, cast as needed or add `"place"` to the union. The primary callsite is `createChannel` in `server.ts` — check if its `channelType` parameter needs updating.

```bash
grep -n "channelType" client/src/stores/server.ts | head -20
```

Update the `createChannel` call signature to include `"place"` if needed.

- [ ] **Step 4: Verify full TypeScript compile**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/api/concord.ts client/src/stores/voice.ts
git commit -m "feat(place): add 'place' to channel_type union; add channelType to VoiceState"
```

---

## Task 10 — Places section in ChannelSidebar

**Files:**
- Modify: `client/src/components/layout/ChannelSidebar.tsx`

- [ ] **Step 1: Add `placeChannels` filter**

In `ChannelSidebar`, the channel lists are built around line 169:

```tsx
const textChannels = server.channels.filter((c) => c.channel_type === "text");
const voiceChannels = server.channels.filter((c) => c.channel_type === "voice");
const appChannels = server.channels.filter((c) => c.channel_type === "app");
```

Add:
```tsx
const placeChannels = server.channels.filter((c) => c.channel_type === "place");
```

- [ ] **Step 2: Render the Places section**

Find where the voice channels section is rendered (search for `voiceChannels.length > 0` or the "Voice" section header). After the voice channels section and before the app channels section, add:

```tsx
{placeChannels.length > 0 && (
  <>
    <div className="px-3 pt-3 pb-1">
      <span className="text-[10px] font-label text-on-surface-variant uppercase tracking-wider">Places</span>
    </div>
    {placeChannels.map((channel) => (
      <ChannelRow
        key={channel.id}
        channel={channel}
        isActive={activeChannelId === channel.matrix_room_id}
        unread={unreadCounts[channel.matrix_room_id] ?? 0}
        prefixIcon="◈"
        onSelect={() => {
          setActiveChannel(channel.matrix_room_id);
          onChannelSelect?.(channel.matrix_room_id);
        }}
        onSettings={isOwner ? () => {} : undefined}
        onDelete={isOwner ? () => setConfirmDeleteChannelId(channel.id) : undefined}
        onRename={isOwner ? () => { setRenamingChannelId(channel.id); setRenameValue(channel.name); } : undefined}
        showAdminControls={showAdminControls}
      />
    ))}
  </>
)}
```

The `prefixIcon` prop on `ChannelRow` — check if it exists:

```bash
grep -n "prefixIcon\|prefix_icon\|icon" client/src/components/layout/ChannelSidebar.tsx | head -20
```

If `ChannelRow` (or the equivalent inline channel button) doesn't accept a `prefixIcon` prop, use the simpler approach of rendering the `◈` inline:

```tsx
{placeChannels.map((channel) => (
  <button
    key={channel.id}
    onClick={() => { setActiveChannel(channel.matrix_room_id); onChannelSelect?.(channel.matrix_room_id); }}
    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-body transition-colors ${
      activeChannelId === channel.matrix_room_id
        ? "bg-primary/10 text-primary"
        : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
    }`}
  >
    <span className="text-primary/70 flex-shrink-0">◈</span>
    <span className="truncate">{channel.name}</span>
    {(unreadCounts[channel.matrix_room_id] ?? 0) > 0 && (
      <span className="ml-auto text-[10px] font-label bg-primary/15 text-primary rounded-full px-1.5 py-0.5">
        {unreadCounts[channel.matrix_room_id]}
      </span>
    )}
  </button>
))}
```

- [ ] **Step 3: Add "Place" to the new channel type dropdown**

In the new channel form (`showNewChannel` state section), find where `channelType` is set and the `<select>` or radio buttons are rendered. Add `"place"` as an option:

```tsx
<option value="place">◈ Place (text + voice)</option>
```

Also update the local `channelType` state type if needed:
```tsx
const [channelType, setChannelType] = useState<"text" | "voice" | "app" | "place">("text");
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/layout/ChannelSidebar.tsx
git commit -m "feat(place): add Places section with ◈ icon to ChannelSidebar"
```

---

## Task 11 — `PlaceVoiceBanner` component

**Files:**
- Create: `client/src/components/voice/PlaceVoiceBanner.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/voice/PlaceVoiceBanner.tsx
import { memo, useState } from "react";
import { useVoiceStore } from "../../stores/voice";
import { Avatar } from "../ui/Avatar";

interface Participant {
  userId: string;
  isSpeaking: boolean;
  isMuted: boolean;
  hasVideo: boolean;
  videoTrack?: MediaStreamTrack;
}

interface PlaceVoiceBannerProps {
  participants: Participant[];
  onLeave: () => void;
  onMute: () => void;
  onToggleCamera: () => void;
  onVideoClick: (userId: string) => void;
  hidden: boolean;
  onRestore: () => void;
}

export const PlaceVoiceBanner = memo(function PlaceVoiceBanner({
  participants,
  onLeave,
  onMute,
  onToggleCamera,
  onVideoClick,
  hidden,
  onRestore,
}: PlaceVoiceBannerProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const channelName = useVoiceStore((s) => s.channelName);

  if (hidden) return null;

  const hasVideo = participants.some((p) => p.hasVideo);

  return (
    <div className={`flex-shrink-0 border-b border-outline-variant/20 bg-surface-container-low ${hasVideo ? "" : "py-1.5"} px-3 flex items-${hasVideo ? "stretch" : "center"} gap-2`}>

      {/* Participant pills */}
      <div className="flex-1 flex gap-2 overflow-x-auto min-w-0">
        {participants.map((p) => (
          <PlacePill key={p.userId} participant={p} onVideoClick={onVideoClick} />
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Overflow ⋯ */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOverflowOpen((v) => !v)}
            className="btn-press w-7 h-7 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-lg leading-none"
            title="Voice options"
          >
            ⋯
          </button>
          {overflowOpen && (
            <div className="absolute right-0 bottom-full mb-1 glass-panel rounded-xl p-1 shadow-xl z-50 min-w-[140px]">
              <button type="button" onClick={() => { onMute(); setOverflowOpen(false); }}
                className="w-full px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
                Mute mic
              </button>
              <button type="button" onClick={() => { onToggleCamera(); setOverflowOpen(false); }}
                className="w-full px-3 py-2 text-left text-sm text-on-surface hover:bg-surface-container-high rounded-lg transition-colors">
                Toggle camera
              </button>
              <button type="button" onClick={() => { onLeave(); setOverflowOpen(false); }}
                className="w-full px-3 py-2 text-left text-sm text-error hover:bg-error/10 rounded-lg transition-colors">
                Leave
              </button>
            </div>
          )}
        </div>

        {/* Collapse */}
        <button
          type="button"
          onClick={onRestore}
          className="btn-press w-7 h-7 flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          title="Collapse banner"
        >
          <span className="material-symbols-outlined text-sm">expand_less</span>
        </button>
      </div>
    </div>
  );
});

function PlacePill({ participant, onVideoClick }: { participant: Participant; onVideoClick: (userId: string) => void }) {
  if (participant.hasVideo) {
    // Square video pill — 1:1 aspect ratio driven by flex basis
    return (
      <button
        type="button"
        onClick={() => onVideoClick(participant.userId)}
        className="btn-press flex-none flex flex-col rounded-xl overflow-hidden bg-surface-container-high cursor-pointer"
        style={{ width: "120px" }}
      >
        {/* Video area — 1:1 */}
        <div className="w-full" style={{ aspectRatio: "1/1", background: "#0f2027", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Avatar userId={participant.userId} size={40} />
          <span className="absolute top-1 right-1 material-symbols-outlined text-white/70 text-xs bg-black/40 rounded p-0.5">open_in_full</span>
        </div>
        {/* Name strip */}
        <div className="flex items-center justify-between px-1.5 py-0.5">
          <ParticipantName userId={participant.userId} />
          <span className="text-[9px] text-error">● cam</span>
        </div>
      </button>
    );
  }

  // Thin audio-only pill
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-container-high flex-none max-w-[120px]">
      <Avatar userId={participant.userId} size={20} />
      <ParticipantName userId={participant.userId} truncate />
      {participant.isSpeaking ? (
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse ml-auto flex-shrink-0" />
      ) : participant.isMuted ? (
        <span className="material-symbols-outlined text-on-surface-variant flex-shrink-0" style={{ fontSize: "10px" }}>mic_off</span>
      ) : null}
    </div>
  );
}

function ParticipantName({ userId, truncate = false }: { userId: string; truncate?: boolean }) {
  // Simple fallback — real name resolution would use useDisplayName but hooks can't be in
  // a conditional render path easily. Display the Matrix local part as fallback.
  const localPart = userId.split(":")[0]?.replace("@", "") ?? userId;
  return (
    <span className={`text-[10px] text-on-surface-variant font-label ${truncate ? "truncate max-w-[60px]" : ""}`}>
      {localPart}
    </span>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/voice/PlaceVoiceBanner.tsx
git commit -m "feat(place): add PlaceVoiceBanner with audio-only and video pill states"
```

---

## Task 12 — Wire PlaceVoiceBanner into ChatLayout

**Files:**
- Modify: `client/src/components/layout/ChatLayout.tsx`

- [ ] **Step 1: Import PlaceVoiceBanner**

Add to imports:
```tsx
import { PlaceVoiceBanner } from "../voice/PlaceVoiceBanner";
```

- [ ] **Step 2: Read `channelType` from voice store**

In the component body where other voice store reads are (search for `voiceConnected`), add:
```tsx
const voiceChannelType = useVoiceStore((s) => s.channelType);
```

- [ ] **Step 3: Add banner dismissed state**

```tsx
const [placeBannerDismissed, setPlaceBannerDismissed] = useState(false);
```

Reset on connect/disconnect by adding an effect near the voice connection effects:
```tsx
useEffect(() => {
  if (!voiceConnected) setPlaceBannerDismissed(false);
}, [voiceConnected]);
```

- [ ] **Step 4: Derive banner visibility condition**

```tsx
const showPlaceBanner = voiceConnected && voiceChannelType === "place" && !placeBannerDismissed;
```

- [ ] **Step 5: Render the banner at the ChatLayout level**

The banner must sit BELOW the top bar and ABOVE the channel content. In the desktop layout, find the desktop main column `<div>` that contains the channel header and the `renderChatContent()` call. Insert the banner between the channel header and content:

```tsx
{showPlaceBanner && (
  <PlaceVoiceBanner
    participants={[]}      // TODO: wire real participants from LiveKit room
    onLeave={() => { /* call voice disconnect */ }}
    onMute={() => {}}
    onToggleCamera={() => {}}
    onVideoClick={() => {}}
    hidden={false}
    onRestore={() => setPlaceBannerDismissed(false)}
  />
)}
```

Do the same in the mobile layout content area (search for `{renderChatContent()}` on mobile and add the banner above it).

- [ ] **Step 6: Add dismissed-banner top-bar indicator**

When the banner is dismissed (connected to Place but banner hidden), show a `◈ ●` indicator in the channel header left section:

In the desktop channel header, after the `<h2>` channel name, conditionally add:
```tsx
{voiceConnected && voiceChannelType === "place" && placeBannerDismissed && (
  <button
    type="button"
    onClick={() => setPlaceBannerDismissed(false)}
    className="flex items-center gap-0.5 text-primary text-xs px-1.5 py-0.5 rounded-lg bg-primary/15 hover:bg-primary/25 transition-colors"
    title="Restore voice banner"
  >
    <span>◈</span>
    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
  </button>
)}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /home/corr/projects/concord/client
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 8: Commit**

```bash
cd /home/corr/projects/concord
git add client/src/components/layout/ChatLayout.tsx
git commit -m "feat(place): render PlaceVoiceBanner at ChatLayout level with dismiss/restore"
```

---

## Task 13 — Manual verification pass

- [ ] **Step 1: Start dev server**

```bash
cd /home/corr/projects/concord/client
npm run dev 2>&1 &
```

Wait ~5 seconds, then open the app in the browser.

- [ ] **Step 2: Verify format top-bar button**

1. Navigate to a text channel.
2. Confirm 🖌 button appears in the top bar right cluster (both mobile and desktop viewport).
3. Click it — `FormatPopover` should open below the button with alignment, size, color, font controls.
4. Press Escape — popover closes.
5. Navigate to a voice channel — confirm 🖌 button is NOT shown.
6. Navigate to DMs — confirm 🖌 button is NOT shown.

- [ ] **Step 3: Verify input area**

1. In a text channel, confirm input toolbar is: `[+]` · `[attach]` · `[textarea]` · `[send]` — no old format button.
2. Click `+` — ChatToolsPanel grid opens above the button.
3. Click Poll tool — PollComposer sheet slides up above the input.
4. Fill question + 2 options, click Send Poll — message sent with `/poll` prefix.
5. Press Escape with panel open — panel closes.

- [ ] **Step 4: Verify per-message format brush**

1. Hover over a message header row (username line) — 🖌 appears next to the username.
2. Click 🖌 — FormatPopover opens in viewer mode with scope toggle ("This message" / "All from sender").
3. Change alignment to center — message text re-aligns immediately.
4. Switch scope to "All from sender" — all messages from that sender align to center.
5. Click "Reset to sender default" — override clears.

- [ ] **Step 5: Verify Place channel sidebar entry**

1. Confirm the new channel creation form shows `◈ Place` as a type option.
2. If the test server allows it, create a Place channel.
3. Confirm it appears under a "Places" section in the sidebar with `◈` prefix.

- [ ] **Step 6: Final commit if any fixes needed**

```bash
cd /home/corr/projects/concord
git add -p  # stage only verified fixes
git commit -m "fix: manual verification fixes for chat-tools/format/place"
```

- [ ] **Step 7: Push the branch**

```bash
cd /home/corr/projects/concord
git push -u origin fix/test-suite-repair
```

---

## Out of scope (tracked separately)

- `x.concord.display` serialization into outgoing Matrix messages (MessageInput `onSend` wiring) — requires Matrix SDK send API changes; separate task
- LiveKit participant list wiring into `PlaceVoiceBanner` — depends on LiveKit room hooks; separate task
- `BroadcastView` full-screen single-feed view — referenced in spec; deferred
- Server-side delivery of scheduled messages — backend work
- GIF provider integration — API key management decision pending
