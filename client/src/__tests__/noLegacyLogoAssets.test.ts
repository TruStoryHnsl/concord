/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Permanent ban on the pre-2026-04-21 Concord brand assets.
 *
 * History: until 2026-04-21 the Concord mark shipped as a single
 * full-colour raster master at `branding/logo.png` plus a duplicate
 * at `client/src/assets/concord-logo.png` and a baked-in
 * `client/public/boot-splash.mp4`. None of those files responded to
 * theme switching — their colours were committed into the bytes.
 *
 * The new pipeline ships the mark as two grayscale-alpha mask PNGs
 * (`logo-upper.png` + `logo-lower.png`) which are tinted at runtime
 * via CSS `mask-image` + `background-color`. The legacy assets must
 * never be re-introduced — they would silently regress the theming
 * behaviour and make the next theme switch invisible to half the
 * surfaces in the app.
 *
 * This test enforces the ban at two layers:
 *
 *   1. **Files**: the specific paths that previously held the legacy
 *      assets must remain absent. Each path is on the deny-list.
 *   2. **References**: no `.ts`/`.tsx` source file may import / mention
 *      the legacy filenames as strings (`"concord-logo.png"`,
 *      `"boot-splash.mp4"`). Comments are stripped before checking
 *      so historical mentions in JSDoc / inline notes are allowed.
 *
 * If you came here to "just put back logo.png" — read `branding/BRAND.md`
 * first. The replacement is the two-half mask pipeline; if it doesn't
 * fit your use case, extend it, don't bypass it.
 *
 * Allowlist note: `branding/generate_favicons.py` writes a
 * default-tinted reference render to `client/public/logo.png` for
 * documentation. That generated artefact is permitted because it is
 * NEVER imported as a runtime asset by any source file (favicon
 * <link>s point at the favicon-*.png files, not logo.png). The
 * reference check below allows the file to exist; it is the source
 * references that are banned.
 */

// `client/src/__tests__/<this>.test.ts` → `client/src` → `client` → repo root
const THIS_FILE = fileURLToPath(import.meta.url);
const SRC_ROOT = join(THIS_FILE, "..", "..");
const CLIENT_ROOT = join(SRC_ROOT, "..");
const REPO_ROOT = join(CLIENT_ROOT, "..");

/**
 * Files whose continued presence in the working tree would mean the
 * old logo pipeline has been resurrected. The README/BRAND files are
 * deliberately omitted — they document the new pipeline and may
 * reference legacy filenames as historical context.
 */
const FORBIDDEN_FILES = [
  // The pre-2026-04-21 raster master + its sibling reference copy.
  // Replaced by `branding/logo-upper.png` + `branding/logo-lower.png`.
  "branding/logo-interlocking-circles.png",
  // The duplicate of the master that lived inside the React asset
  // pipeline — its only consumers were a Vite ?url import and the
  // favicon generator's secondary write. Both are gone.
  "client/src/assets/concord-logo.png",
  // The hand-rendered MP4 splash. Replaced by the same mask-tinted
  // half mechanism that powers the React `<ConcordLogo />`.
  "client/public/boot-splash.mp4",
  // Earlier WebP / GIF iterations of the same splash that lived in
  // public during the splash-format experimentation phase. None of
  // them are theme-responsive and all were superseded.
  "client/public/boot-splash.webp",
  "client/public/boot-splash.gif",
];

const FORBIDDEN_REFERENCES: Array<{ regex: RegExp; description: string }> = [
  {
    // Importing the deleted asset would either fail at build time
    // (the file is gone) or, worse, silently break in dev when a
    // stale dist still has it. Either way: don't reference it.
    regex: /\bconcord-logo\.png\b/,
    description: 'reference to deleted "concord-logo.png" asset',
  },
  {
    regex: /\blogo-interlocking-circles\.png\b/,
    description: 'reference to deleted "logo-interlocking-circles.png" master',
  },
  {
    regex: /\bboot-splash\.mp4\b/,
    description: 'reference to deleted boot-splash.mp4 asset',
  },
  {
    regex: /\bboot-splash\.webp\b/,
    description: 'reference to deleted boot-splash.webp asset',
  },
  {
    regex: /\bboot-splash\.gif\b/,
    description: 'reference to deleted boot-splash.gif asset',
  },
];

/**
 * Strip JS/TS comments so the pattern check only sees executable
 * code. Mirrors the helper in noLegacyTauriGlobal.test.ts so the
 * tone of the two tripwires matches.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function* walkSources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (
        entry === "node_modules" ||
        entry === ".git" ||
        entry === "dist" ||
        entry === ".worktrees"
      ) {
        continue;
      }
      yield* walkSources(full);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      // skip this test file itself — it documents the forbidden
      // patterns deliberately as string literals.
      full !== THIS_FILE
    ) {
      yield full;
    }
  }
}

describe("regression guard: legacy logo assets are permanently banned", () => {
  it("no banned filename exists in the working tree", () => {
    const present: string[] = [];
    for (const rel of FORBIDDEN_FILES) {
      if (existsSync(join(REPO_ROOT, rel))) {
        present.push(rel);
      }
    }
    if (present.length > 0) {
      throw new Error(
        "Legacy Concord logo asset(s) re-introduced. The brand mark " +
          "must be authored as `branding/logo-upper.png` + " +
          "`branding/logo-lower.png` only. See `branding/BRAND.md`.\n\n" +
          present.map((p) => `  - ${p}`).join("\n"),
      );
    }
    expect(present).toEqual([]);
  });

  it("no production source file references a banned legacy asset filename", () => {
    const offenders: string[] = [];
    for (const file of walkSources(SRC_ROOT)) {
      const raw = readFileSync(file, "utf8");
      const stripped = stripComments(raw);
      for (const { regex, description } of FORBIDDEN_REFERENCES) {
        if (regex.test(stripped)) {
          const lineIdx = stripped
            .split("\n")
            .findIndex((l) => regex.test(l));
          const snippet =
            lineIdx >= 0
              ? `${lineIdx + 1}: ${stripped.split("\n")[lineIdx].trim()}`
              : "(pattern found but no single-line match)";
          offenders.push(
            `${relative(SRC_ROOT, file)} — ${description}\n    ${snippet}`,
          );
        }
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        "Legacy Concord logo asset reference detected. Use the " +
          "`<ConcordLogo />` component (or, for the pre-React splash, " +
          "the inline mask divs in `client/index.html`). See " +
          "`branding/BRAND.md`.\n\n" +
          offenders.map((o) => `  - ${o}`).join("\n"),
      );
    }
    expect(offenders).toEqual([]);
  });

  it("the new mask assets are present where the runtime expects them", () => {
    const required = [
      "branding/logo-upper.png",
      "branding/logo-lower.png",
      "client/public/logo-upper.png",
      "client/public/logo-lower.png",
    ];
    const missing = required.filter((rel) => !existsSync(join(REPO_ROOT, rel)));
    if (missing.length > 0) {
      throw new Error(
        "New mask-half assets missing from the tree. The runtime " +
          "loads them from `/logo-upper.png` and `/logo-lower.png`; " +
          "without them the brand mark would render invisible.\n\n" +
          missing.map((m) => `  - ${m}`).join("\n"),
      );
    }
    expect(missing).toEqual([]);
  });
});
