# Visual Code Editor Framework Recommendation

**Status:** Draft 2026-04-08 · TASK 30 · For user review
**Scope:** Foundational decision for `concord-game-maker` (Game Center planned sub-app)
**Stack target:** Tauri v2 + React 18/19 + TypeScript + Rust backend
**Project scope:** `commercial` (retagged 2026-04-08 — license compatibility is a hard gate)

---

## Executive Summary

**No candidate fully satisfies the user's three requirements** (multi-language output, text↔visual dual representation, commercial-safe Tauri v2 native compatibility). The ecosystem state is honest about this gap — visual coding libraries either do one-way block→code generation, or they do text↔visual round-trip but under non-commercial licenses.

- **Primary recommendation: Blockly** (Apache-2.0, Raspberry Pi Foundation). Multi-language output is its strongest feature — five built-in generators (JavaScript, Python, Lua, Dart, PHP). Mature React wrapper (`react-blockly` v7). Commercial-safe. **Accepts the compromise:** `concord-game-maker` authors games in a **Blockly-defined DSL** that compiles to JS/Python/Lua; it does NOT support editing existing arbitrary TypeScript source code visually. For game authoring specifically, this compromise is reasonable because games are authored from scratch in the editor, not imported from external codebases.
- **Fallback recommendation: Rete.js core** (MIT). More flexible node-graph UX, TypeScript-first, first-class React plugin (`rete-react-plugin`). No built-in multi-language codegen and no built-in round-trip — both would be engineering work on top. Pick this if Blockly's block-based aesthetic feels too juvenile for Concord's target audience.
- **The text↔visual round-trip requirement is substantially unmet.** The closest match (**Rete Studio**) does exactly what the user asked for — transforms JavaScript text into a Rete graph and back — but it's licensed CC BY-NC-SA 4.0 (non-commercial), which is a hard blocker for Concord's commercial scope. See §6 "Reality check" below for the long-term options if the user insists on this feature.

---

## 1. Criteria Definitions

The four evaluation criteria were chosen to reflect Concord's specific constraints, not a generic "pick a visual editor" exercise.

### 1.1 React/TypeScript integration without bridge code (weight: HIGH)

`concord-game-maker` is a Tauri v2 shell around a React/TypeScript frontend. Any library that requires an iframe, a separate WebView, a DOM-globals shim, or a Node.js child process adds a cross-process boundary — each one is an integration tax, a debugging cost, and a potential security surface. A first-class React component with TypeScript types installs cleanly, type-checks with the rest of the codebase, and participates in React DevTools like any other component.

### 1.2 Multi-language output (weight: HIGH)

The user's stated requirement: *"at least JavaScript/TypeScript, ideally also Rust or Python, so that the same game can run in multiple contexts."* A game authored once should compile to multiple runtimes — the browser (JS/TS), the desktop (Rust via Tauri), perhaps a scripting sandbox (Lua/Python). Libraries that generate only one target language force the engine team to write custom generators per additional language, which is a multi-month engineering investment.

### 1.3 Text↔visual dual representation (weight: HIGH — user's explicit hard requirement)

The user's verbatim requirement: *"edit existing text code visually without breaking compatibility, and edit visual nodes by dropping into the underlying text."* This is the hardest feature to find — most visual coding libraries are one-way (blocks → code), because the reverse direction (text → blocks) requires a full parser for the target language and an algorithm to lay out the resulting graph cleanly. Very few libraries in the JS ecosystem attempt it at all.

### 1.4 Tauri v2 bundle size impact (weight: MEDIUM)

Tauri v2 apps benefit from lean dependencies — the whole value proposition is native-feeling apps without Electron's 100+MB baseline. A visual editor dragging in a 5MB bundle is not automatically disqualifying, but anything over ~200KB gzipped needs a strong justification. Libraries with their own canvas rendering stack (not DOM-based) tend to be denser.

---

## 2. Comparison Matrix

Scores: 5 = excellent fit, 1 = blocker or near-blocker. Each cell is score (rationale in one sentence).

| Candidate | React/TS Integration | Multi-language Output | Text↔Visual Round-trip | Tauri Bundle Size | License | Commercial-safe? |
|---|---|---|---|---|---|---|
| **Blockly** | 4 — mature `react-blockly` wrapper, TypeScript types in core npm package, but UMD packaging requires bundler tuning | **5** — five first-party generators (JS, Python, Lua, Dart, PHP), custom generator path for TS/Rust | 1 — one-way only; no mechanism to parse existing source back into blocks | 2 — ~720KB unminified, ~160KB gzipped, ~100KB with Closure advanced compilation | Apache-2.0 | ✅ |
| **Flyde** | 4 — React-based editor, TypeScript-first core runtime | 2 — integrates with existing TS/JS code but doesn't do multi-target codegen | 1 — no text↔visual round-trip documented | N/A — blocked | Core: MIT. **Editor UI: AGPLv3.** | ❌ **AGPLv3 editor blocks commercial use** |
| **Rete.js core** | **5** — `rete-react-plugin` is first-party, TypeScript-first (97%), v2.0.6 June 2025, 12K stars | 2 — `code-plugin` emits JavaScript only; custom generators require per-language work | 1 — core framework has no round-trip; see Rete Studio below | 4 — smaller than Blockly, modular plugin architecture | MIT | ✅ |
| **Rete Studio** | 4 — built on Rete.js, React-based | 2 — JavaScript only | **5 — does exactly what the user asked for**: text→graph→text round-trip | Standalone app, not a library — not directly embeddable | **CC BY-NC-SA 4.0** | ❌ **Non-commercial license blocks commercial use** |
| **@comfyorg/litegraph** | 1 — no React bindings, Canvas2D-based, DOM-adjacent not DOM-native | 1 — no codegen; designed for dataflow execution inside ComfyUI | 1 — no round-trip | N/A — blocked | MIT | ❌ **Archived August 5 2025** — merged into ComfyUI Frontend monorepo, no longer maintained standalone |
| **Scratch Blocks** | 1 — no React integration documented; built on Blockly but as webpack-bundled TypeScript, not a React component | 2 — inherits Blockly's generators but intended for Scratch VM, not general-purpose | 1 — one-way only | 2 — larger than Blockly due to Scratch VM coupling | Apache-2.0 | Technically yes but blocked by React gap |
| **Node-RED** | 1 — standalone Node.js runtime at `localhost:1880`, not an embeddable library | 1 — designed for flow-based IoT/event automation, not source code generation | 1 — none | N/A — blocked | Apache-2.0 | Technically yes but blocked by standalone-runtime gap |

---

## 3. Detailed Per-Candidate Evaluation

### 3.1 Blockly — Apache-2.0

- **What it is:** Google's flagship block-based visual programming library. Transferred from Google to the Raspberry Pi Foundation on November 10, 2025 (governance change, not a fork). Powers Scratch, MIT App Inventor, Microsoft MakeCode, hundreds of educational products.
- **React integration:** `react-blockly` (by nbudin, currently at v7) embeds Blockly as a React component with hook and component APIs. TypeScript support via the core `blockly` npm package, but the package is UMD — Tauri's bundler (Vite) handles UMDs but requires a tiny config nudge.
- **Multi-language output:** First-class. Blockly ships five generators today: JavaScript ES5, Python 3, Lua 5.1, Dart 2, PHP 7. Each generator is documented and extensible. Custom generators targeting TypeScript or Rust are possible via the codelab example but require writing the per-block emit logic yourself — non-trivial but bounded work.
- **Text↔visual:** **One-way only.** Blockly has no parser for its own output — you can generate code from blocks, but you cannot generate blocks from code. This is the load-bearing gap against the user's hard requirement. The workaround is to **author only in Blockly** and treat the serialized workspace state (Blockly XML or JSON) as the canonical source; text output is a derived artifact that is never edited directly.
- **Bundle size:** ~720KB unminified, ~160KB gzipped in the standard build. With Google's Closure Compiler advanced compilation mode + tree-shaking, this drops to ~300KB / ~100KB gzipped. Both numbers are workable for a Tauri desktop app; neither is ideal for a mobile build.
- **Maintenance:** Raspberry Pi Foundation takeover signals long-term stability; Google's handoff explicitly framed it as "continued investment in education." Active issue tracker, frequent releases.
- **Blockers for Concord:** The text↔visual gap. If users must edit existing JS/TS source code visually, Blockly does not solve that. If users author games from scratch inside Blockly and only export to run them, Blockly is fine.
- **Final score: 4/4/1/2** (React / multi-lang / round-trip / bundle) — best commercial-safe option with the round-trip gap flagged.

### 3.2 Flyde — MIT core + AGPLv3 editor → BLOCKED

- **What it is:** A visual extension of TypeScript for AI agent workflows and backend logic. Flyde flows are visually authored node graphs that execute as TypeScript code.
- **License problem:** Core runtime packages (`@flyde/core`, `@flyde/loader`, `@flyde/nodes`) are MIT. **The UI library and editor components are GNU AGPLv3.** AGPLv3 requires any application that includes the editor to be open-sourced under AGPLv3 itself — including the server-side code served to users over a network. For a commercial Concord product this is a contractual dealbreaker: Concord would need to open-source the entire app under AGPLv3, and any Concord place hosting a `concord-game-maker` instance would inherit AGPLv3 obligations for the whole Concord codebase.
- **Decision:** **Blocked by license.** Not a candidate regardless of other features.
- **Final score: N/A (license blocker)**.

### 3.3 Rete.js core — MIT

- **What it is:** A TypeScript-first framework for creating visual node-graph programming interfaces. v2.0.6 June 2025. 12K GitHub stars, 97% TypeScript codebase, actively maintained by Vitaliy Stoliarov (ni55an). Provides a dataflow/control-flow graph execution engine plus a plugin system for rendering, presets, history, minimap, etc.
- **React integration:** `rete-react-plugin` is a first-party plugin that renders nodes and connections as React components with full customization. `Rete Kit` is a scaffold generator for setting up a new Rete project with React presets. This is the cleanest React integration of any candidate.
- **Multi-language output:** The first-party `code-plugin` generates **JavaScript only**. Components define a `code()` method that emits JS statements. Custom generators for TypeScript, Python, Rust, etc. require writing per-component emit logic — more work than Blockly's ready-made generators, but the plugin architecture is clean.
- **Text↔visual:** **Not in core Rete.js.** See Rete Studio below for the round-trip feature, which is a separate (non-commercial) project built on Rete.
- **Bundle size:** Modular plugin architecture means you only bundle what you use. Rough estimate based on plugin granularity: 50-100KB gzipped for a minimal setup (core + react-plugin + one render preset), growing modestly with minimap/context-menu/history plugins.
- **Maintenance:** Actively maintained, recent commits, well-documented at retejs.org, examples at `retejs.org/examples`.
- **Blockers for Concord:** No built-in multi-language codegen (each target is custom work). No round-trip. But the framework itself is flexible enough to build either on top if someone invests the engineering time.
- **Final score: 5/2/1/4** — best integration story, worst codegen story. Fallback pick if Blockly's aesthetic is wrong for the target audience.

### 3.4 Rete Studio — CC BY-NC-SA 4.0 → BLOCKED

- **What it is:** A code generation tool built on Rete.js that transforms JavaScript text into a Rete graph AND transforms the graph back into JavaScript. This is the only library in this evaluation that matches the user's hard requirement for bidirectional round-trip. Live demo at `studio.retejs.org`.
- **License problem:** Licensed under **Creative Commons Attribution-Noncommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**. The "Noncommercial" clause prohibits commercial use without a separate license from the author. Concord's commercial scope makes this a hard block — we cannot ship Rete Studio's code in `concord-game-maker` without negotiating a commercial license with the maintainer (ni55an).
- **Architecture:** Standalone web application at `studio.retejs.org`, not a library packaged for embedding. Rete Studio comprises modular packages (`Core`, `Languages`, `UI`, `Demo`) but the Core/Languages packages carry the non-commercial license too, so even selective embedding is blocked.
- **Maturity:** 223 stars, 62 commits, 47 forks, 1 open issue, last commit January 26, 2025. Early-stage but actively developed. Only JavaScript is supported; other languages are planned but not shipped.
- **What this means for Concord:** Rete Studio is the **reference implementation** of the feature the user wants, but the license blocks direct use. The architectural techniques (AST parsing → graph layout → graph → AST → codegen) are well-documented in the open-source code; a clean-room reimplementation on top of Rete.js core (MIT) is possible but is its own significant engineering project. See §6 for options.
- **Decision:** **Blocked by license.** Not a candidate unless the user negotiates a commercial license directly with the maintainer, which is out of scope for this task.
- **Final score: N/A (license blocker)**.

### 3.5 @comfyorg/litegraph — MIT → BLOCKED (archived)

- **What it is:** The TypeScript fork of `litegraph.js` that powers ComfyUI's node graph. Canvas2D rendering, dataflow execution, similar in feel to Unreal Blueprints.
- **Blocker:** **The standalone `@comfyorg/litegraph` repository was archived on August 5, 2025.** Development moved into the ComfyUI Frontend monorepo at `@/lib/litegraph`. Future contributions are directed there. Using the archived npm package means no security updates, no bug fixes, no compatibility work with new React or TypeScript versions.
- **Architecture concern:** Canvas2D-based rendering. All nodes, wires, and interactions are painted to a canvas — there's no React integration at all. For `concord-game-maker` this would mean managing canvas state alongside React state, building a React wrapper from scratch, and losing React DevTools visibility into the editor's internals.
- **Codegen:** None. litegraph is a dataflow execution engine, not a source code generator. The graph runs *as* the program; there's no "emit JavaScript text" step.
- **Decision:** **Blocked by archive status + no React integration.** Not a candidate.
- **Final score: N/A (archived + no React)**.

### 3.6 Scratch Blocks — Apache-2.0 → BLOCKED (no React)

- **What it is:** A library for building creative computing interfaces, built on top of Blockly and coupled to the Scratch Virtual Machine. Latest release v2.1.9 April 7, 2026. Actively maintained.
- **React gap:** Not a React component library. Built with TypeScript and bundled via webpack, but the consumption model is "include the bundle in a page and mount the editor into a DOM node" — not "`<ScratchBlocks />` as a JSX element." A React wrapper is buildable but would be a project of its own.
- **Concord mismatch:** Scratch Blocks is optimized for the Scratch visual identity (chunky rounded blocks, Scratch-specific color palette, child-friendly aesthetic). Concord's target audience is broader than Scratch's ~8-16 age range; a Scratch-styled editor would visually undermine Concord's otherwise-polished dark theme.
- **Decision:** **Blocked by React gap + aesthetic mismatch.** Not a candidate.
- **Final score: N/A (no React integration)**.

### 3.7 Node-RED — Apache-2.0 → BLOCKED (standalone runtime)

- **What it is:** A flow-based visual programming environment for event-driven applications, originally built for IoT. Standalone Node.js runtime — you install it via `npm install -g node-red`, run `node-red`, and a browser opens to `localhost:1880`.
- **Architectural blocker:** Node-RED is not an embeddable library. It's an application you install and run. There is no "`import NodeRed from 'node-red'`" path — the entire Node-RED UI is coupled to the runtime server. Embedding it in a Tauri desktop app would require either running the Node-RED runtime as a child process (adds a Node.js dependency to every Concord install — big dependency) or forking Node-RED's UI out of the runtime (effectively a rewrite).
- **Paradigm mismatch:** Flow-based event programming for IoT/backend automation is a different problem from game authoring. Even if embedding worked, Node-RED's node palette (HTTP request, MQTT, file I/O, cron trigger) is wrong for concord-game-maker's domain.
- **Decision:** **Blocked by architecture + paradigm mismatch.** Not a candidate.
- **Final score: N/A (not embeddable)**.

---

## 4. Primary Recommendation: Blockly + DSL Workflow

### 4.1 Why

Blockly is the only candidate that is **commercial-safe AND multi-language out-of-the-box AND has a mature React wrapper**. The text↔visual round-trip gap is real, but it can be worked around at the product level: `concord-game-maker` treats its Blockly workspace as the canonical source of truth, with generated code as a read-only export.

### 4.2 Integration sketch

```
concord-game-maker/
├── package.json                      # adds: blockly@^11, react-blockly@^7
├── src/
│   ├── App.tsx
│   ├── editor/
│   │   ├── GameMakerEditor.tsx       # wraps react-blockly with Concord theming
│   │   ├── toolbox.ts                # defines the block palette for game authoring
│   │   ├── generators/
│   │   │   ├── javascript.ts         # uses Blockly.JavaScript (first-party)
│   │   │   ├── python.ts             # uses Blockly.Python (first-party)
│   │   │   └── rust.ts               # CUSTOM — emits Rust source per block
│   │   ├── blocks/
│   │   │   ├── movement.ts           # custom blocks: move_forward, turn_left, ...
│   │   │   ├── physics.ts            # custom blocks: set_gravity, collide_with, ...
│   │   │   ├── ai.ts                 # custom blocks: llm_prompt, llm_decide, ...
│   │   │   └── chat.ts               # custom blocks: send_message, listen_for, ...
│   │   └── workspace-serializer.ts   # import/export workspace JSON
```

### 4.3 React component sketch

```tsx
// editor/GameMakerEditor.tsx
import { BlocklyWorkspace } from "react-blockly";
import * as Blockly from "blockly";
import { registerGameBlocks } from "./blocks";
import { javascriptGenerator } from "./generators/javascript";
import { pythonGenerator } from "./generators/python";
import { rustGenerator } from "./generators/rust";
import { toolboxCategories } from "./toolbox";

export function GameMakerEditor({ initialWorkspace, onChange }) {
  // Register custom game blocks once
  useEffect(() => {
    registerGameBlocks();
  }, []);

  return (
    <BlocklyWorkspace
      toolboxConfiguration={toolboxCategories}
      initialJson={initialWorkspace}
      className="h-full w-full"
      workspaceConfiguration={{
        theme: Blockly.Themes.Dark, // Matches Concord dark theme
        grid: { spacing: 20, length: 3, colour: "#374151", snap: true },
        zoom: { controls: true, wheel: true, minScale: 0.5, maxScale: 2 },
        move: { scrollbars: true, drag: true, wheel: true },
      }}
      onJsonChange={(newJson) => {
        onChange({
          workspace: newJson,
          js: javascriptGenerator.workspaceToCode(Blockly.Workspace.currentWorkspace),
          py: pythonGenerator.workspaceToCode(Blockly.Workspace.currentWorkspace),
          rs: rustGenerator.workspaceToCode(Blockly.Workspace.currentWorkspace),
        });
      }}
    />
  );
}
```

### 4.4 Sample "hello world" visual graph

For a simple game rule *"when the player enters the room, greet them with a chat message"*, the Blockly workspace would be (in JSON serialized form — NOT hand-authored, generated by the editor):

```json
{
  "blocks": {
    "blocks": [
      {
        "type": "event_on_player_enter",
        "inputs": {
          "DO": {
            "block": {
              "type": "chat_send_message",
              "fields": { "TARGET": "player" },
              "inputs": {
                "MESSAGE": {
                  "block": {
                    "type": "text",
                    "fields": { "TEXT": "Welcome to the dungeon!" }
                  }
                }
              }
            }
          }
        }
      }
    ]
  }
}
```

The JavaScript generator would emit:

```javascript
onPlayerEnter(() => {
  chat.sendMessage("player", "Welcome to the dungeon!");
});
```

The Python generator would emit:

```python
def on_player_enter():
    chat.send_message("player", "Welcome to the dungeon!")
game.on("player_enter", on_player_enter)
```

### 4.5 Specific blockers/gotchas for the downstream INS task

- **UMD packaging:** Blockly's npm package is UMD, not ESM. Vite (Concord's bundler) handles UMDs but requires a `optimizeDeps.include: ["blockly"]` entry in `vite.config.ts` to pre-bundle it properly.
- **Bundle size in mobile builds:** ~160KB gzipped is workable for desktop but starts to matter on mobile. Tree-shake aggressively with Closure Compiler advanced mode if `concord-game-maker` ships to the mobile apps from INS-020.
- **Custom block registration timing:** Blocks must be registered before the workspace is instantiated. Put the registration in a `useEffect` with empty deps OR in a module-level side-effect import that runs before the React render.
- **Theme:** Blockly ships with `Blockly.Themes.Dark` which is close but not identical to Concord's Tailwind dark theme. Create a `ConcordBlocklyTheme` that matches the CSS custom properties for color alignment.
- **Workspace persistence:** Workspace state is an XML or JSON blob. Serialize it into the game's metadata (same store as the game's author info, title, etc.). **Never serialize the generated code** — always regenerate from the workspace.
- **Rust generator is custom work:** Blockly has no first-party Rust generator. Writing one is a bounded project (~200-500 lines depending on block coverage) but must be done before any Rust targets work.

### 4.6 Test plan (per `feedback_tests_gate_pillars`)

When INS task "build concord-game-maker editor base" lands, it MUST ship with:

- One test verifying the Blockly workspace renders without crashing in a smoke test (vitest + React Testing Library, once the vitest setup lands per task #20).
- One test verifying a known sample workspace JSON generates the expected JavaScript output.
- One test verifying a known sample workspace JSON generates the expected Python output.
- One test verifying that loading a serialized workspace JSON and re-serializing it produces byte-equivalent output (round-trip the workspace state, NOT the generated code).

---

## 5. Fallback Recommendation: Rete.js core + custom codegen

### When to switch to this fallback

Switch to Rete.js if **any** of these are true:
- The user tries Blockly's aesthetic in a prototype and finds it too juvenile/toy-like for Concord's target audience.
- The game engine team needs fine-grained control over node rendering (custom node shapes, interactive previews inside nodes, live-updating thumbnails) that Blockly's block shapes can't express.
- The `concord-game-maker` feature set evolves toward pro-tool dataflow (particle systems, shader graphs, audio DSP) where a node-wire paradigm is a better fit than stacked blocks.

### Why it's the fallback, not the primary

Rete.js core has:
- ✅ Best-in-class React/TypeScript integration
- ✅ MIT license
- ✅ Actively maintained
- ❌ No built-in multi-language codegen (the `code-plugin` does JavaScript only; Python/Lua/Rust are custom work)
- ❌ No built-in text↔visual round-trip (Rete Studio has this but is CC BY-NC-SA)

Picking Rete.js core means accepting **more engineering investment upfront** in exchange for a cleaner UX ceiling. Budget rough estimate: a JavaScript codegen plugin is ~200-400 lines on top of what the existing `code-plugin` provides; a Python codegen is another ~300-500; a Rust codegen is larger because Rust's type system needs more inference work. Multi-month engineering commitment before the first multi-language game compiles.

---

## 6. Reality Check: The Text↔Visual Round-trip Gap

The user's hard requirement is: *"edit existing text code visually without breaking compatibility, and edit visual nodes by dropping into the underlying text."*

**No commercial-safe JavaScript library fully delivers this today.** The closest match (Rete Studio) is explicitly non-commercial. This is not a Concord-specific limitation — it's the state of the JS visual programming ecosystem as of April 2026. The reasons are well-known:

1. **Parsing arbitrary source code into a visual graph requires a full language parser.** For JavaScript/TypeScript, that means Acorn, Babel, or TypeScript's own compiler API. The parser produces an AST, which then needs to be laid out as a graph — node positions, wire routing, grouping of statements into subgraphs. This is a substantial engineering problem.
2. **The reverse (graph → source code) is easier but still nontrivial.** You need a code generator that emits readable, idiomatic source — not machine-generated blobs. Comments must survive round-trips. Formatting must be stable. This is the same problem as a code formatter, plus the graph-to-AST step.
3. **Preserving edit intent across round-trips is the hardest part.** If a user edits the text version and then opens the visual view, the library has to re-derive the graph layout — which may differ from what the user previously arranged. Visual position information has to be stored out-of-band (in comments? in a sidecar file?) and reconciled when the text changes.

**Options if the user insists on this feature:**

### 6a. License Rete Studio commercially

Contact the Rete.js maintainer (`ni55an` — Vitaliy Stoliarov) and negotiate a commercial license for Rete Studio. This is the cleanest path because Rete Studio already implements the feature. Unknown cost. Unknown willingness of the maintainer. **Recommended first step if the requirement is non-negotiable.**

### 6b. Clean-room reimplement the round-trip on top of Rete.js core (MIT)

Build a custom JavaScript → Rete-graph parser using Acorn (MIT, well-maintained) and a custom Rete-graph → JavaScript generator. Do NOT copy any code from Rete Studio — pure clean-room implementation. Budget: **multi-month engineering project**, probably 2000-4000 lines of code plus test infrastructure. High quality bar because bugs corrupt user code.

### 6c. Accept the DSL-only workflow (Blockly)

For `concord-game-maker` specifically — where the goal is authoring games, not editing existing codebases — the round-trip feature is a nice-to-have rather than a must-have. Users author in Blockly; generated code is read-only output. This is the pragmatic default, the path this recommendation endorses as the primary pick.

### 6d. Wait for the ecosystem to catch up

Rete Studio's early-stage activity suggests it may eventually relicense or spawn a permissive alternative. A year from now the situation may be different. Low-risk but slow.

---

## 7. Explicitly Rejected Candidates (summary)

| Candidate | Reason |
|---|---|
| Flyde | AGPLv3 editor UI license incompatible with commercial distribution |
| Rete Studio | CC BY-NC-SA 4.0 non-commercial license |
| @comfyorg/litegraph | Archived August 5, 2025; merged into ComfyUI Frontend monorepo |
| Scratch Blocks | No React integration + Scratch-specific aesthetic |
| Node-RED | Standalone Node.js runtime, not an embeddable library; paradigm mismatch |

---

## 8. Decision Checklist

Per the `feedback_tests_gate_pillars` rule, this is the doc pillar's "test" — a checklist the user can answer in 30 seconds.

- [ ] Does the primary recommendation (Blockly) support text↔visual dual representation for ARBITRARY source code? **NO.** Blockly does one-way block→code only. Dual representation is limited to Blockly's own workspace serialization format. *If this is a deal-breaker, see §6 for the options that address it.*
- [ ] Is the primary recommendation's license compatible with commercial distribution? **YES.** Apache-2.0 — permissive, no copyleft obligations.
- [ ] Does the primary recommendation have a maintained React integration? **YES.** `react-blockly` v7, actively maintained by nbudin.
- [ ] Is the fallback (Rete.js core) materially different from the primary? **YES.** Different paradigm (node-graph vs block-stacking), different React integration quality (Rete is first-class, Blockly is wrapped), different codegen (Rete is bring-your-own, Blockly has 5 built in).
- [ ] Can the primary recommendation be integrated into a Tauri v2 app without adding a separate runtime? **YES.** Pure npm package consumed by the existing Vite/React build. No Node.js child process, no extra server, no WebView-in-WebView.

---

## Appendix: Research Sources

Research conducted 2026-04-08 via WebFetch + WebSearch (Cluster 9 agent initially; completed directly by the main agent after Cluster 9 hung on an npmjs.com fetch that returned 403):

- [Blockly — developers.google.com/blockly](https://developers.google.com/blockly/guides/configure/web/code-generators)
- [Blockly on GitHub — github.com/google/blockly](https://github.com/google/blockly)
- [Raspberry Pi Foundation Blockly announcement — Nov 10, 2025]
- [react-blockly v7 — npmjs.com/package/react-blockly](https://www.npmjs.com/package/react-blockly)
- [Flyde — flyde.dev](https://www.flyde.dev/) + [github.com/flydelabs/flyde](https://github.com/flydelabs/flyde) (AGPLv3 editor UI confirmed)
- [Rete.js — retejs.org](https://retejs.org/) + [github.com/retejs](https://github.com/retejs)
- [Rete Studio — studio.retejs.org](https://studio.retejs.org/) + [github.com/retejs/rete-studio](https://github.com/retejs/rete-studio) (CC BY-NC-SA 4.0 confirmed)
- [@comfyorg/litegraph — github.com/Comfy-Org/litegraph.js](https://github.com/Comfy-Org/litegraph.js) (archived Aug 5, 2025 confirmed)
- [Scratch Blocks — github.com/LLK/scratch-blocks](https://github.com/LLK/scratch-blocks)
- [Node-RED — nodered.org](https://nodered.org/)

---

*Recommendation draft — awaiting user decision. The honest answer is that no candidate is perfect; Blockly is the least-bad commercial-safe pick for a DSL-based game authoring workflow. The user's text↔visual round-trip requirement is largely unmet by the ecosystem and will need a separate conversation before `concord-game-maker` scaffolding begins.*
