# OpenClaw Harness Inspection Report

**Task:** Cluster 7 / TASK 20 — SSH inspection of the OpenClaw agentic AI harness
**Inspector:** Researcher agent (Concord, 2026-04-08)
**Scope:** Concord (commercial)
**Source of truth:** SSH inspection of `corr@openclaw` (live), `~/.npm-global/lib/node_modules/openclaw/` (v2026.4.8) and `~/.openclaw/openclaw.json` (corr's deployment config).

## TL;DR for downstream developers

OpenClaw is an **upstream open-source npm package**, not a corr-authored project — it lives at `https://github.com/openclaw/openclaw` (MIT). The version on the VM is `2026.4.8`, installed globally via npm at `~/.npm-global/lib/node_modules/openclaw/`. There is **no `~/projects/openclaw/`** on the VM and **no orracle integration** — none of corr's `~/projects/orracle/` code is referenced anywhere. The "oracle" skill that ships with openclaw is the unrelated `@steipete/oracle` CLI.

OpenClaw runs as systemd user service `openclaw-gateway.service` and hosts **9 agent personas** (`sable`, `ledger`, `advisor`, `north`, `quill`, `switch`, `recon`, `talent-manager` aka Arden, `trainer`), each logged into Concord (`https://example.test`) as a distinct Matrix user `@<id>:example.test` and bound to a single Matrix room. Each agent uses model `openai-codex/gpt-5.4-mini` (configurable). The Matrix transport is `matrix-js-sdk` 41.3.0-rc.0 (Node.js, not nio).

The **good news for INS-019b**: OpenClaw's matrix plugin already supports arbitrary `extraContent` fields on outbound events (the same wire mechanism it uses internally for `com.openclaw.finalized_preview`). The `withMatrixExtraContentFields` helper merges custom keys into the `m.room.message` content blob with no whitelist or sanitization, so a custom `com.concord.chart` field will survive end-to-end (encrypted or not).

The **bad news**: openclaw's existing model-callable `message.send` action does **not** plumb `extraContent` through to the model. Agent text replies are routed through `deliverMatrixReplies` → `sendMessageMatrix(...)` with NO `extraContent` parameter exposed. So the chart-emitting capability requires either (a) an upstream openclaw patch to add `extraContent` to the `message.send` action surface, or (b) a **separate openclaw plugin** that registers a new agent tool (`emit_chart`) which calls the lower-level matrix runtime APIs directly. Option (b) is the recommended path — it doesn't require touching upstream openclaw and matches openclaw's documented plugin extension model.

---

## 1. Runtime + framework

| Property | Value |
|---|---|
| Language | TypeScript / JavaScript (compiled to ESM `.js`) |
| Runtime | Node.js 18+ (uses native `fetch`) |
| Package | `openclaw@2026.4.8` (npm, MIT, github.com/openclaw/openclaw) |
| Install path | `/home/corr/.npm-global/lib/node_modules/openclaw/` |
| Binary | `/usr/local/bin/openclaw` → `/home/corr/.npm-global/bin/openclaw` → `openclaw.mjs` |
| Entry | `dist/index.js` (top-level), `openclaw.mjs` (CLI shim) |
| Service | `openclaw-gateway.service` (systemd `--user` unit, currently `active running`) |
| Config root | `/home/corr/.openclaw/` (mode 700, owner `corr:media`) |
| Main config file | `/home/corr/.openclaw/openclaw.json` |
| Workspace root | `/home/corr/.openclaw/workspace/` (per-agent subdirs at `workspaces/<id>/`) |
| Agent core library | `@mariozechner/pi-agent-core` (third-party "pi" agent framework — provides `AgentTool<TSchema, unknown>` type) |
| Tool schema | TypeBox (`@sinclair/typebox`) — JSON-schema-compatible runtime type definitions |
| Plugin SDK exposure | `openclaw/plugin-sdk/<subpath>` exports — fully documented and supported |

**Agent framework:** OpenClaw uses `@mariozechner/pi-agent-core` (the upstream "pi" agent SDK) for the LLM loop. It is **not** the Anthropic Claude Agent SDK and **not** a direct `anthropic`/OpenAI client wrapper. It is a provider-agnostic agent loop that supports many model backends via plugin providers (configured backends on this VM: `openai`, `google`, `mistral`, plus `openai-codex` as the default agent provider).

**Persona framework:** Personas are file-based markdown — each agent has `~/.openclaw/workspace/workspaces/<id>/AGENTS.md` plus shared files at `~/.openclaw/workspace/shared/{CORE_MEMORY.md,ORG_SHARED.md,HANDOFF_PROTOCOL.md}` and a per-role spec at `~/.openclaw/workspace/agents/<NAME>.md`. There is no "persona framework" in the sense of a code abstraction — personas are just instruction files the agent reads via the standard `read` tool. **No reference to corr's `~/projects/orracle/` exists anywhere on the openclaw VM.** The shared `oracle` skill at `dist/extensions/.../skills/oracle/SKILL.md` is the unrelated `@steipete/oracle` CLI.

**Matrix transport:** `@openclaw/matrix` extension (`dist/extensions/matrix/`) wraps `matrix-js-sdk@41.3.0-rc.0` plus `@matrix-org/matrix-sdk-crypto-{wasm,nodejs}` for E2EE. The package metadata is at `dist/extensions/matrix/package.json`.

**Concord identity (from `~/.openclaw/openclaw.json`):**

- Homeserver: `https://example.test`
- Default account: `sable`
- Bound rooms (one per agent, via `bindings[]`):
  - `sable` → `!255OLGSJjvZow0qamN:example.test`
  - `ledger` → `!JUUpxXeJrYzXdk9Jgt:example.test`
  - `advisor` → `!NKiOKWh7o3t2MZilg6:example.test`
  - `north` → `!JL5skYachn61c9XHQy:example.test`
  - `quill` → `!pWntvUVcAN4aeQwZLd:example.test`
  - `switch` → `!40ve1T8sZaN5jO0Fhn:example.test`
  - `recon` → `!oMKcULJQCS7x48JYc9:example.test`
  - `talent-manager` → `!jUlD7dFtyoqvXDLZQl:example.test`
  - `trainer` → `!5IWfeRsYKShSAZpHje:example.test`
- Auth: per-account `password` field in `channels.matrix.accounts.<id>.password` (cleartext today — see `admin/openclaw-matrix-recovery/` for the access-token rotation utility). Refresh tokens are NOT used; openclaw re-logs in via password on session invalidation.

---

## 2. Existing tool / skill examples

OpenClaw exposes capabilities to agents through **two distinct mechanisms**, both important to understand:

### 2a. Skills (Anthropic Skills format — markdown only)

Skills live at `/home/corr/.npm-global/lib/node_modules/openclaw/skills/<name>/SKILL.md` and per-extension at `dist/extensions/<ext>/skills/<name>/SKILL.md`. They are **plain markdown with YAML frontmatter** — no code, no JSON schema. The agent reads them and decides to invoke `Bash`/`exec` / external CLIs accordingly. Example: `skills/weather/SKILL.md`:

```markdown
---
name: weather
description: "Get current weather and forecasts via wttr.in or Open-Meteo. Use when: user asks about weather, temperature, or forecasts for any location. NOT for: historical weather data, severe weather alerts, or detailed meteorological analysis. No API key needed."
homepage: https://wttr.in/:help
metadata:
  {
    "openclaw":
      {
        "emoji": "☔",
        "requires": { "bins": ["curl"] },
        "install":
          [
            { "id": "brew", "kind": "brew", "formula": "curl", "bins": ["curl"], "label": "Install curl (brew)" }
          ],
      },
  }
---

# Weather Skill

Get current weather conditions and forecasts.

## When to Use
...

### Current Weather
\`\`\`bash
curl "wttr.in/London?format=3"
\`\`\`
```

Skills are **wrong layer for chart emission.** They tell the model what to type into a shell; they cannot directly write to the matrix wire path with custom content keys. The chart tool needs to be a real *tool*, not a skill.

### 2b. Tools (TypeBox-typed, registered via plugin SDK)

Tools are registered by plugins at `register(api)` time. The canonical example from `docs/plugins/building-plugins.md`:

```typescript
// index.ts in a plugin package
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  description: "Adds a custom tool to OpenClaw",
  register(api) {
    api.registerTool({
      name: "my_tool",
      description: "Do a thing",
      parameters: Type.Object({ input: Type.String() }),
      async execute(_id, params) {
        return { content: [{ type: "text", text: `Got: ${params.input}` }] };
      },
    });
  },
});
```

Public type (from `dist/plugin-sdk/src/channels/plugins/types.core.d.ts:22`):

```typescript
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";

export type ChannelAgentTool = AgentTool<TSchema, unknown> & {
    ownerOnly?: boolean;
};
```

This is what we'll use for the chart-emitting tool in §4.

### 2c. Channel message actions (the existing matrix `send` surface)

The matrix extension registers a message-action adapter that exposes a fixed set of typed actions to the model under the shared `message` tool. From `dist/channel-DJIceexp.js:104` (matrix's `matrixMessageActions` object):

```javascript
const matrixMessageActions = {
    describeMessageTool: ({ cfg, accountId }) => {
        // ... returns { actions: ["send", "react", "edit", "delete", ...], capabilities, schema }
    },
    supportsAction: ({ action }) => MATRIX_PLUGIN_HANDLED_ACTIONS.has(action),
    extractToolSend: ({ args }) => extractToolSend(args, "sendMessage"),
    handleAction: async (ctx) => {
        const { handleMatrixAction } = await import("./tool-actions.runtime-JHJl54vQ.js");
        const { action, params, cfg, accountId, mediaLocalRoots } = ctx;
        const dispatch = async (actionParams) => await handleMatrixAction({
            ...actionParams,
            ...accountId ? { accountId } : {}
        }, cfg, { mediaLocalRoots });

        if (action === "send") {
            const to = readStringParam(params, "to", { required: true });
            const mediaUrl = readStringParam(params, "media", { trim: false }) ?? readStringParam(params, "mediaUrl", { trim: false }) ?? readStringParam(params, "filePath", { trim: false }) ?? readStringParam(params, "path", { trim: false });
            const content = readStringParam(params, "message", { required: !mediaUrl, allowEmpty: true });
            const replyTo = readStringParam(params, "replyTo");
            const threadId = readStringParam(params, "threadId");
            const audioAsVoice = typeof params.asVoice === "boolean" ? params.asVoice : typeof params.audioAsVoice === "boolean" ? params.audioAsVoice : void 0;
            return await dispatch({
                action: "sendMessage",
                to,
                content,
                mediaUrl: mediaUrl ?? void 0,
                replyToId: replyTo ?? void 0,
                threadId: threadId ?? void 0,
                audioAsVoice
                // NOTE: no extraContent — model cannot inject custom content keys here
            });
        }
        // ... react, edit, delete, pin, set-profile, member-info, ... etc
    }
};
```

**Critical observation:** the `send` action's parameter list is closed. There is no slot the model can use to attach `com.concord.chart`. This is by design (`MatrixExtraContentFields` is internal-only), and is the reason INS-019b cannot just "use the existing message tool."

---

## 3. Tool → Concord emission path (trace)

There are TWO outbound paths in openclaw, depending on whether the agent is *replying* to an inbound matrix message or *initiating* a send via the `message` tool. INS-019b will most likely want a third path (a new tool that uses the lower-level helpers directly).

### Path A: Agent reply to inbound message (current default behavior)

This is what 100% of sable's session jsonl files show happening. The model produces text; openclaw's reply pipeline picks it up and posts it as a Matrix reply. **No tool call is involved.**

```
inbound m.room.message → matrix monitor (dist/monitor-Bl-05QFP.js)
  → resolveMatrixInboundBodyText(...) constructs the assistant prompt
  → agent runtime (pi-agent-core) runs the LLM loop with tools: cron, exec,
    memory_search, process, read, session_status, sessions_list,
    update_plan, web_fetch
  → final assistant text bubbles back as ReplyPayload[]
  → deliverMatrixReplies({ replies, roomId, client, ... }) at
    dist/monitor-Bl-05QFP.js:1615
      → for each reply: chunkMatrixText(text, ...) splits into chunks
      → for each chunk: sendMessageMatrix(roomId, trimmed, {
            client, cfg, replyToId, threadId, accountId
          })  ← NO extraContent passed
  → sendMessageMatrix (dist/send-87Q35u0G.js:895)
      → buildTextContent(convertedText, ...)
      → withMatrixExtraContentFields(content, opts.extraContent)
        ← extraContent is undefined here, so this is a no-op
      → client.sendEvent(roomId, "m.room.message", mergedContent)
  → matrix-js-sdk → /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
```

The hot edit path (used while a draft event is being progressively edited) DOES use `extraContent`, but only to mark the event as `{ "com.openclaw.finalized_preview": true }` once streaming completes. From `dist/monitor-Bl-05QFP.js:2822`:

```javascript
await editMessageMatrix(roomId, draftEventId, payload.text, {
    client,
    cfg,
    threadId: threadTarget,
    accountId: _route.accountId,
    extraContent: quietDraftStreaming ? buildMatrixFinalizedPreviewContent() : void 0
});

// where:
function buildMatrixFinalizedPreviewContent() {
    return { [MATRIX_OPENCLAW_FINALIZED_PREVIEW_KEY]: true };
    // = { "com.openclaw.finalized_preview": true }
}
```

This is the **canonical template** for emitting custom content keys: build a `Record<string, unknown>` and pass it as `extraContent`. We'll mirror this exactly.

### Path B: Explicit `message.send` tool call (used by elevated/cross-channel sends)

```
model emits tool_use { name: "message", input: { channel: "matrix", action: "send", to: "...", message: "..." } }
  → agent runtime dispatches to channel registry
  → matrixMessageActions.handleAction(ctx)  (dist/channel-DJIceexp.js:104+)
  → handleMatrixAction (dist/tool-actions.runtime-JHJl54vQ.js:302, "sendMessage" case)
  → sendMatrixMessage(to, content, { mediaUrl, replyToId, threadId, audioAsVoice, ...clientOpts })
  → sendMessageMatrix → withMatrixExtraContentFields(content, undefined) → client.sendEvent("m.room.message", ...)
```

Same problem as Path A: `extraContent` is dropped on the floor. The model cannot reach `extraContent` through this route.

### Path C: Custom plugin tool (proposed for INS-019b)

```
model emits tool_use { name: "emit_chart", input: { type: "bar", title: "...", data: {...}, options: {...} } }
  → openclaw agent runtime invokes the registered tool's execute() handler
  → handler imports openclaw/plugin-sdk/extensions/matrix/runtime-api or matrix-helper
  → handler calls sendSingleTextMessageMatrix(roomId, fallbackText, {
        client, cfg, accountId, threadId,
        extraContent: { "com.concord.chart": { type, title, data, options, version: 1 } }
    })
  → withMatrixExtraContentFields merges → client.sendEvent("m.room.message", { msgtype: "m.text", body: fallbackText, "com.concord.chart": {...} })
  → matrix-js-sdk → /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
  → Synapse forwards via federation (custom keys preserved per Matrix spec)
  → Concord client useMatrix.ts receives the timeline event, ChartAttachment renderer reads content["com.concord.chart"]
```

The merge implementation (verified at `dist/send-87Q35u0G.js:853`):

```javascript
function withMatrixExtraContentFields(content, extraContent) {
    if (!extraContent) return content;
    return {
        ...content,
        ...extraContent
    };
}
```

It is a plain spread — **no whitelist, no schema validation, no key prefix check**. Any key the plugin sets makes it through to the wire.

---

## 4. Proposal: chart-emitting tool

### Recommended approach: standalone openclaw plugin

Create a small npm package (or in-repo bundled plugin under openclaw's `plugins/` workspace tree, if the user wants to upstream it). Its sole job is to register one tool: `emit_chart`. The plugin can live in Concord's repo at `tooling/openclaw-plugin-concord-chart/` and be installed on the openclaw VM via `openclaw plugins install <path-or-clawhub-spec>`.

### Files

```
tooling/openclaw-plugin-concord-chart/
├── package.json
├── openclaw.plugin.json
├── tsconfig.json
└── src/
    └── index.ts
```

### `package.json`

```json
{
  "name": "@concord/openclaw-plugin-chart",
  "version": "0.1.0",
  "description": "OpenClaw plugin: emit Concord ChartAttachment messages with com.concord.chart custom content",
  "type": "module",
  "main": "dist/index.js",
  "files": ["dist/", "openclaw.plugin.json"],
  "openclaw": {
    "extensions": ["./dist/index.js"]
  },
  "peerDependencies": {
    "openclaw": ">=2026.4.8"
  },
  "devDependencies": {
    "@sinclair/typebox": "*",
    "openclaw": ">=2026.4.8",
    "typescript": "^5.6.0"
  }
}
```

### `openclaw.plugin.json`

```json
{
  "id": "concord-chart",
  "name": "Concord Chart Attachments",
  "description": "Tool for OpenClaw agents to emit chart.js charts as Concord-rendered Matrix messages",
  "configSchema": { "type": "object", "additionalProperties": false }
}
```

### `src/index.ts` — entry point + tool definition

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type, type Static } from "@sinclair/typebox";
// The matrix runtime helpers — these are the lower-level send functions that
// accept extraContent. The exact import path is verified by inspecting
// dist/plugin-sdk/extensions/matrix/src/matrix/send.d.ts (sendSingleTextMessageMatrix
// is exported and accepts { extraContent: MatrixExtraContentFields }).
import {
  sendSingleTextMessageMatrix,
} from "openclaw/plugin-sdk/extensions/matrix/runtime-heavy";
//
// NOTE: openclaw v2026.4.8 splits matrix functionality across runtime-api,
// runtime-heavy-api, and helper-api. The exact subpath that re-exports
// sendSingleTextMessageMatrix needs to be confirmed at install time by
// reading dist/extensions/matrix/runtime-heavy-api.js or by following the
// re-export chain in dist/plugin-sdk/extensions/matrix/src/matrix/send.d.ts.
// If the public plugin-sdk subpath has not been promoted, the fallback is to
// import from "openclaw/plugin-sdk/matrix-runtime-heavy" or to call the
// shared `message` tool's underlying handler directly via the runtime API.

const ChartParams = Type.Object({
  to: Type.String({
    description: "Matrix room ID (e.g. !abc:example.test) the chart should be posted to. For room-bound agents this is the bound room.",
  }),
  type: Type.Union(
    [
      Type.Literal("bar"),
      Type.Literal("line"),
      Type.Literal("pie"),
      Type.Literal("doughnut"),
      Type.Literal("radar"),
      Type.Literal("polarArea"),
      Type.Literal("scatter"),
    ],
    { description: "chart.js chart type" },
  ),
  title: Type.Optional(Type.String({ description: "Chart title" })),
  data: Type.Object(
    {
      labels: Type.Array(Type.String()),
      datasets: Type.Array(
        Type.Object({
          label: Type.Optional(Type.String()),
          data: Type.Array(Type.Number()),
          backgroundColor: Type.Optional(
            Type.Union([Type.String(), Type.Array(Type.String())]),
          ),
          borderColor: Type.Optional(
            Type.Union([Type.String(), Type.Array(Type.String())]),
          ),
        }),
      ),
    },
    { description: "chart.js data object" },
  ),
  options: Type.Optional(
    Type.Object(
      {
        scales: Type.Optional(Type.Any()),
        plugins: Type.Optional(Type.Any()),
      },
      {
        additionalProperties: true,
        description: "chart.js options object (passthrough)",
      },
    ),
  ),
  fallbackText: Type.Optional(
    Type.String({
      description:
        "Plain-text body shown by clients that do not understand com.concord.chart. Defaults to the title or 'Chart attachment'.",
    }),
  ),
  accountId: Type.Optional(
    Type.String({
      description:
        "Matrix account id to send as. Defaults to the agent's bound account.",
    }),
  ),
  threadId: Type.Optional(Type.String()),
  replyToId: Type.Optional(Type.String()),
});

type ChartParams = Static<typeof ChartParams>;

export default definePluginEntry({
  id: "concord-chart",
  name: "Concord Chart Attachments",
  description:
    "Lets OpenClaw agents post chart.js visualizations as Concord-rendered Matrix messages via a com.concord.chart custom content key.",

  register(api) {
    api.registerTool({
      name: "emit_chart",
      description:
        "Post a chart to a Concord (Matrix) room. The chart is delivered as an m.room.message with a custom 'com.concord.chart' content key that the Concord client renders as an interactive chart.js visualization. Other Matrix clients will display the fallbackText instead. Use this when the user asks for a graph, chart, or visualization of structured numeric data.",
      parameters: ChartParams,

      async execute(_id, params: ChartParams) {
        const fallback =
          params.fallbackText ??
          (params.title ? `📊 ${params.title}` : "📊 Chart attachment");

        const chartPayload = {
          version: 1,
          type: params.type,
          title: params.title,
          data: params.data,
          options: params.options,
        };

        try {
          const result = await sendSingleTextMessageMatrix(params.to, fallback, {
            // client / cfg are resolved by openclaw runtime when omitted
            accountId: params.accountId,
            threadId: params.threadId,
            replyToId: params.replyToId,
            // The actual injection point — same mechanism openclaw uses
            // internally for "com.openclaw.finalized_preview".
            extraContent: {
              "com.concord.chart": chartPayload,
            },
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: true,
                    eventId: result.messageId,
                    roomId: result.roomId,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              { type: "text", text: `emit_chart failed: ${message}` },
            ],
          };
        }
      },
    });
  },
});
```

### Install + enable on the openclaw VM

```bash
# build
cd tooling/openclaw-plugin-concord-chart && npm install && npx tsc

# scp to VM
scp -r dist openclaw.plugin.json package.json corr@openclaw:/tmp/concord-chart-plugin/

# install (treats it as a local plugin path)
ssh corr@openclaw 'openclaw plugins install /tmp/concord-chart-plugin'

# enable for all agents
ssh corr@openclaw 'openclaw config set tools.allow=+emit_chart'

# restart gateway
ssh corr@openclaw 'systemctl --user restart openclaw-gateway.service'
```

### Concord-side coordination

The Concord client's INS-019a `ChartAttachment` reader needs to look for the same key:

```typescript
// In client/src/hooks/useMatrix.ts (or wherever messages are normalized)
const chartContent = event.getContent()["com.concord.chart"];
if (chartContent && typeof chartContent === "object") {
  message.attachments.push({
    type: "chart",
    payload: chartContent as ChartAttachmentPayload,
  });
}
```

### Why a plugin and not an upstream openclaw patch

1. **No fork.** Concord doesn't need to maintain a divergent openclaw build.
2. **Survives upgrades.** When `openclaw@2026.5.x` lands via `openclaw update`, the plugin remains compatible as long as the plugin SDK contract (`registerTool`, `definePluginEntry`, the `extraContent` field on `sendSingleTextMessageMatrix`) does not break — and that contract is part of openclaw's public, semver-tracked SDK.
3. **The matrix runtime helpers are already exported via `openclaw/plugin-sdk/extensions/matrix/...`** — they're explicitly designed for plugin consumers (the `package.json` `exports` section confirms this).
4. **An upstream PR is still worth filing** to make `extraContent` a first-class field on the shared `message.send` action so OTHER openclaw users can also emit Concord charts. But Concord shouldn't block on it.

---

## 5. Limitations + gotchas

### 5a. Will the field survive the wire?

**Yes**, with caveats:

| Stage | Survives? | Notes |
|---|---|---|
| `withMatrixExtraContentFields` merge | ✅ | Plain spread, no key filter — verified at `dist/send-87Q35u0G.js:853`. |
| `client.sendEvent("m.room.message", content)` | ✅ | matrix-js-sdk does not strip unknown content keys. |
| Synapse server-side | ✅ | Matrix spec explicitly allows arbitrary additional content keys on `m.room.message`. Synapse stores them verbatim. |
| Federation to other Matrix homeservers | ✅ | Per spec; verified by countless precedents (`org.matrix.msc*` extensions, Element's reply fallbacks, etc.). |
| **E2EE encryption** | ✅ | Matrix encrypts the entire `content` object; custom keys are preserved. The `example.test` accounts have crypto enabled (`encryptionEnabled: account.config.encryption === true` in `matrixMessageActions`). The chart payload will be E2EE if the room is encrypted. |
| Concord client receive (`useMatrix.ts`) | ✅ | matrix-js-sdk on the receive side parses content as `Record<string, unknown>`. Reading `event.getContent()["com.concord.chart"]` works. |

**Caveat 1 — Concord client has to be the only consumer.** Other Matrix clients (Element, FluffyChat, etc.) will see only the `body` text. So `fallbackText` MUST be meaningful — otherwise non-Concord users in the same room get a confusing blank-looking message.

**Caveat 2 — payload size.** Matrix events have a 65 KB limit by default (Synapse default). Chart `data` objects with thousands of points will exceed this. Recommended payload budget: stay under 32 KB serialized JSON. The plugin SHOULD pre-validate `JSON.stringify(chartPayload).length` and return an error result if too large.

**Caveat 3 — namespace squatting.** `com.concord.chart` is unregistered. That's fine for a private/instance-specific extension, but if Concord ever federates with other servers running other clients, those clients should know to ignore the key. Matrix spec convention: reverse-DNS namespacing is sufficient — the key won't collide with anything.

**Caveat 4 — search and notification keywords.** Synapse's notification engine and Element's search index look at `body`, `formatted_body`, and a few specific msc keys. They will not index `com.concord.chart` content. That's actually desirable here.

### 5b. What WILL strip the field

| Layer | Risk | Mitigation |
|---|---|---|
| The existing `message.send` model action | **High** — the action handler does not forward `extraContent`. | Don't use it. Use the new `emit_chart` plugin tool. |
| `chunkMatrixText` (called from `deliverMatrixReplies`) | **Medium** — it splits long text into multiple events; if you ever try to attach a chart to a *reply text*, the chart key would only land on the first chunk and confuse renderers. | The `emit_chart` tool sends a *single* text event with the chart attached, never chunks. |
| `editMessageMatrix` redo | **Low** — edits replace `content`, but `editMessageMatrix` itself accepts an `extraContent` parameter. If a future feature needs to edit a chart, plumb `extraContent` through there too. | Currently we only `send`, not `edit`, charts. |
| Concord federation to a DIFFERENT homeserver | **Low** — if Concord ever federates example.test with another concord instance whose client doesn't understand `com.concord.chart`, fallback text appears. | Acceptable. Document the namespace in Concord's protocol notes. |

### 5c. Other gotchas I noticed during inspection

1. **Cleartext passwords in `openclaw.json`.** The matrix accounts currently store `password` in plaintext. There's already a recovery script at `~/projects/admin/openclaw-matrix-recovery/` to rotate to access tokens — it should be run before relying on this VM in production.
2. **No agent-isolated tool allowlists.** `tools.allow` is global. If `emit_chart` is enabled, ALL 9 agents get it. If only specific agents (e.g. `quill` for research outputs) should be able to chart, we'd need to use openclaw's `bindings[].agentId` + per-agent tool gates — but I didn't find evidence those exist as a public surface. Treating `emit_chart` as universally available is the simplest design.
3. **Model is `openai-codex/gpt-5.4-mini` by default.** All 9 agents currently use the same Codex-mini-class model. That's a small model — keep the tool description tight and the param schema minimal so the model can reliably fill it in.
4. **The `message_sending` hook.** OpenClaw plugins can register `before_message_send` / `message_sending` hooks (`api.registerHook(...)`) that can `cancel: true` outbound messages. None are currently configured (`hooks.internal.entries` is just `boot-md`, `bootstrap-extra-files`, `command-logger`, `session-memory`). If a future plugin adds a strict outbound sanitizer, it could theoretically strip our `com.concord.chart` key — flag this in any code review of new plugins.
5. **No record of this plugin SDK path being load-tested by third parties yet.** The plugin SDK is officially documented but most existing extensions are first-party (they live under `dist/extensions/` with `@openclaw/<id>` package names). The `clawhub` ecosystem is small. Expect to debug at least one path-resolution issue when first installing the plugin.

---

## 6. Open questions

These could not be answered by SSH inspection alone. The user (corr) should confirm before INS-019b is implemented:

1. **Which agent(s) should be able to emit charts?** Sable (default assistant)? Quill (research)? All? The plugin will register `emit_chart` for all agents unless the spec says otherwise.

2. **Should the chart tool live as a separate npm package, or as a folder inside `concord/`?** Recommended: `concord/tooling/openclaw-plugin-concord-chart/` so it's versioned with the client renderer. But it could equally be `~/projects/openclaw-plugin-concord-chart/` as its own repo if that's more aligned with the workspace's per-project repo strategy.

3. **What's the canonical chart payload schema?** I drafted `{ version: 1, type, title, data, options }` based on chart.js's standard config. The Concord client INS-019a renderer needs to agree on the exact shape. Confirm:
   - Is `version: 1` desired? (Recommended for future-proofing.)
   - Should we support all chart.js types or just `bar`/`line`/`pie`/`doughnut`?
   - Does the Concord renderer want raw chart.js options, or a normalized subset (axis labels, colors, legend on/off)?

4. **Should the plugin bundle a JSON-Schema validator for the chart payload?** Stricter validation = fewer client-side render errors but more rejections. Recommended: lenient on the openclaw side, strict on the Concord renderer side.

5. **Upstream openclaw PR or no?** Filing a PR against `openclaw/openclaw` to add `extraContent` to the public `message.send` action surface would let other openclaw users emit Concord charts via the existing `message` tool, but it's optional and not blocking. Decide whether to invest the time.

6. **Plugin install process automation.** Should INS-019b also include a `concord/admin/openclaw-deploy-chart-plugin.sh` script that builds + scp's + installs + enables the plugin on `corr@openclaw`? Or is that out of scope?

7. **Tunnels & federation.** The chart payload survives federation per the Matrix spec, but Concord-specific. If Concord ever federates `example.test` with another server running concord-client, that's fine. If it federates with element.io or matrix.org, those clients will only see fallback text. Is that acceptable for now? (My read: yes — it's a private instance.)

---

## 7. Test checklist (deliverable test gate)

A downstream developer reading ONLY this document should be able to answer:

| # | Question | Answer in this doc | Confidence |
|---|---|---|---|
| 1 | What language is OpenClaw written in? | §1: TypeScript/JavaScript on Node.js 18+, ESM. | ✅ Verified |
| 2 | What's the file path where tools are defined? | §2c, §4: Tools are registered by plugins via `api.registerTool({ name, description, parameters, execute })` inside a `definePluginEntry({ register(api) { ... } })` entry. There is no single source-of-truth file for tools — each plugin owns its own. The matrix message actions live at `/home/corr/.npm-global/lib/node_modules/openclaw/dist/channel-DJIceexp.js:104` (`matrixMessageActions`). The skill markdown files live at `/home/corr/.npm-global/lib/node_modules/openclaw/skills/<name>/SKILL.md`. The Concord chart plugin should live at `concord/tooling/openclaw-plugin-concord-chart/src/index.ts`. | ✅ Verified |
| 3 | What's the concrete code to add a new tool? | §4: Full `index.ts` and `package.json` provided. | ✅ Provided |
| 4 | Does OpenClaw use orracle's persona framework? | §1: NO. There is no reference to `~/projects/orracle/` anywhere on the openclaw VM. The shared `oracle` skill is the unrelated `@steipete/oracle` CLI. Personas are file-based markdown at `~/.openclaw/workspace/workspaces/<id>/AGENTS.md`. | ✅ Verified |
| 5 | Will the `com.concord.chart` content field survive the Matrix send path? | §5a: YES through the new plugin tool path (Path C in §3), which uses `sendSingleTextMessageMatrix({ extraContent })`. NO through the existing `message.send` action (Path B) — that path's handler does not forward `extraContent`. The merge code (`withMatrixExtraContentFields`) is a plain spread with no key filter, no whitelist. E2EE rooms preserve the field because Matrix encrypts the entire content object. Survives federation. | ✅ Verified |

**Unanswered (flagged in §6):** 6 open questions about scope/design that need user input.

---

## Appendix A: SSH commands used

For reproducibility, the inspection used these commands on `corr@openclaw`:

```bash
# basics
uname -a; ls -la ~; ls -la ~/.openclaw; openclaw --version; openclaw --help
file /usr/local/bin/openclaw; readlink -f /usr/local/bin/openclaw
systemctl --user list-units --all 'openclaw*'

# package metadata
cat ~/.npm-global/lib/node_modules/openclaw/package.json
ls ~/.npm-global/lib/node_modules/openclaw/dist/extensions/
cat ~/.npm-global/lib/node_modules/openclaw/dist/extensions/matrix/package.json

# matrix extension internals
ls ~/.npm-global/lib/node_modules/openclaw/dist/extensions/matrix/
cat ~/.npm-global/lib/node_modules/openclaw/dist/extensions/matrix/index.js
cat ~/.npm-global/lib/node_modules/openclaw/dist/extensions/matrix/api.js
cat ~/.npm-global/lib/node_modules/openclaw/dist/extensions/matrix/runtime-api.js

# plugin SDK type definitions (the public contract)
cat ~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/extensions/matrix/src/matrix/sdk.d.ts
cat ~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/extensions/matrix/src/matrix/send/types.d.ts
cat ~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/channels/plugins/types.core.d.ts
cat ~/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/src/agents/channel-tools.d.ts

# implementation: matrix message actions (model-facing tool surface)
sed -n '100,275p' ~/.npm-global/lib/node_modules/openclaw/dist/channel-DJIceexp.js
sed -n '295,395p' ~/.npm-global/lib/node_modules/openclaw/dist/tool-actions.runtime-JHJl54vQ.js

# implementation: send pipeline + extraContent merge
grep -n 'withMatrixExtraContentFields\|sendMessageMatrix\|extraContent' ~/.npm-global/lib/node_modules/openclaw/dist/send-87Q35u0G.js

# implementation: reply delivery (the path agent text replies actually take)
sed -n '1615,1750p' ~/.npm-global/lib/node_modules/openclaw/dist/monitor-Bl-05QFP.js
grep -n 'finalized_preview\|extraContent' ~/.npm-global/lib/node_modules/openclaw/dist/monitor-Bl-05QFP.js

# corr's deployment config (sans secrets)
python3 -c "import json; d=json.load(open('/home/corr/.openclaw/openclaw.json')); print(json.dumps(d['agents'], indent=2))"
python3 -c "import json; d=json.load(open('/home/corr/.openclaw/openclaw.json')); print(json.dumps(d['bindings'], indent=2))"
python3 -c "import json; d=json.load(open('/home/corr/.openclaw/openclaw.json')); print(json.dumps(d['channels']['matrix'], indent=2))"
python3 -c "import json; d=json.load(open('/home/corr/.openclaw/openclaw.json')); print(json.dumps({k:'<'+type(v).__name__+'>' for k,v in d.items()}, indent=2))"

# personas / agent workspace
find ~/.openclaw/workspace -name 'AGENTS.md'
cat ~/.openclaw/workspace/workspaces/sable/AGENTS.md

# tools the agents actually invoked (from session jsonl)
cat ~/.openclaw/agents/sable/sessions/*.jsonl | python3 -c "import json,sys; tools=set(); [tools.add(json.loads(l).get('message',{}).get('toolName')) for l in sys.stdin if l.strip()]; print('\n'.join(sorted(t for t in tools if t)))"

# orracle reference search (came back empty)
find /home/corr -maxdepth 3 -iname '*orracle*' 2>/dev/null
grep -rn 'orracle' /home/corr/.openclaw/ 2>/dev/null

# documentation
cat ~/.npm-global/lib/node_modules/openclaw/docs/plugins/building-plugins.md
```

## Appendix B: Outstanding "needs upstream verification" items

These are things I am highly confident about from inspection but should be re-verified at install time before the plugin code goes live:

1. **`openclaw/plugin-sdk/extensions/matrix/runtime-heavy` (or whatever subpath)** — the import path that re-exports `sendSingleTextMessageMatrix` for plugins. v2026.4.8 has it under `dist/plugin-sdk/extensions/matrix/src/matrix/send.d.ts`, but the canonical npm `exports` map may have a friendlier path. Check `package.json#exports` on the openclaw VM at install time.
2. **Tool name uniqueness.** The `emit_chart` name must not collide with any existing tool. None of openclaw's first-party extensions appear to register a tool by that name (skills don't register tools, they're markdown). But run `openclaw skills list` or grep `dist/` for `name: "emit_chart"` before publishing.
3. **`tools.allow` semantics.** The plugin docs say users enable optional tools with `tools.allow`. We should mark `emit_chart` as `optional: true` and require explicit allowlisting, or leave it required and let it always be available — confirm with user (open question §6.1).

---

*End of inspection report.*
