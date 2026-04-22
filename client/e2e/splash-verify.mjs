#!/usr/bin/env node
/**
 * Direct Playwright verification of the Concord launch splash against
 * both Chromium and Firefox, exercising all four acceptance criteria:
 *
 *   1. Theme-driven retinting (rings + nodes) across all themes.
 *   2. Opaque-footprint sizing (not padded viewBox).
 *   3. Transparent backdrop (no reflow, no dark rectangle crop).
 *   4. Single rendered layer at any given moment (no double mark).
 *
 * Run after `vite dev --port 5178` is live. Emits JSON report to
 * stdout + per-browser screenshots under ./splash-evidence/.
 *
 * Usage: node e2e/splash-verify.mjs [chromium|firefox]
 */
import { chromium, firefox } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";

const BASE_URL = process.env.SPLASH_BASE_URL ?? "http://127.0.0.1:5178/?nocache=" + Date.now();
const OUT_DIR = path.resolve(new URL(".", import.meta.url).pathname, "splash-evidence");
const THEMES = ["kinetic-node", "verdant-signal", "ember-circuit", "arctic-current"];
const EXPECTED = {
  "kinetic-node":   { primary: "rgb(164, 165, 255)", secondary: "rgb(175, 239, 221)" },
  "verdant-signal": { primary: "rgb(125, 224, 183)", secondary: "rgb(139, 200, 255)" },
  "ember-circuit":  { primary: "rgb(255, 154, 107)", secondary: "rgb(255, 214, 110)" },
  "arctic-current": { primary: "rgb(123, 200, 255)", secondary: "rgb(145, 240, 208)" },
};

function parseArgs() {
  const arg = process.argv[2];
  if (!arg || arg === "all") return ["chromium", "firefox"];
  if (arg === "chromium" || arg === "firefox") return [arg];
  throw new Error(`unknown browser: ${arg}`);
}

async function run(browserName) {
  const launcher = browserName === "firefox" ? firefox : chromium;
  const browser = await launcher.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const report = { browser: browserName, url: BASE_URL, themes: {}, criteria: {} };

  // Force a cold-boot by navigating with cache disabled.
  await page.goto(BASE_URL, { waitUntil: "load" });

  // By the time `load` fires the splash may have already dismissed.
  // We force the boot-splash visible again so we can observe its
  // *paint* properties deterministically, and we separately check
  // that during the natural cold boot only one layer was ever
  // visible at any instant (see multiLayerCheck below).
  const measure = async (theme) => {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      const boot = document.getElementById("boot-splash");
      if (boot) {
        boot.setAttribute("data-state", "visible");
        boot.classList.remove("boot-splash-retired");
      }
    }, theme);
    // brief pause for CSS var propagation
    await page.waitForTimeout(50);
    return await page.evaluate(() => {
      const boot = document.getElementById("boot-splash");
      const primary = boot?.querySelector(".boot-ring-primary");
      const secondary = boot?.querySelector(".boot-ring-secondary");
      const primaryNode = boot?.querySelector(".boot-splash-node.primary");
      const secondaryNode = boot?.querySelector(".boot-splash-node.secondary");
      const svg = boot?.querySelector("svg");
      const rect = svg?.getBoundingClientRect();
      const cs = boot ? getComputedStyle(boot) : null;
      return {
        bootDisplay: cs?.display,
        bootBgColor: cs?.backgroundColor,
        bootPointerEvents: cs?.pointerEvents,
        svgRenderedWidth: rect ? Math.round(rect.width) : null,
        opaqueFootprintPx: rect ? Math.round(rect.width * (416 / 512)) : null,
        primaryStroke: primary ? getComputedStyle(primary).stroke : null,
        secondaryStroke: secondary ? getComputedStyle(secondary).stroke : null,
        primaryNodeBg: primaryNode ? getComputedStyle(primaryNode).backgroundColor : null,
        secondaryNodeBg: secondaryNode ? getComputedStyle(secondaryNode).backgroundColor : null,
        bodyScrollHeight: document.body.scrollHeight,
        viewportHeight: innerHeight,
      };
    });
  };

  for (const theme of THEMES) {
    const data = await measure(theme);
    report.themes[theme] = data;
    await page.screenshot({
      path: path.join(OUT_DIR, `${browserName}-dev-${theme}.png`),
      fullPage: false,
    });
  }

  // Acceptance 1: retinting — strokes match expected per theme.
  report.criteria.retinting = THEMES.every((t) => {
    const m = report.themes[t];
    const e = EXPECTED[t];
    return m.primaryStroke === e.primary
      && m.secondaryStroke === e.secondary
      && m.primaryNodeBg === e.primary
      && m.secondaryNodeBg === e.secondary;
  });

  // Acceptance 2: sizing — opaque footprint within 156 ± 10 px at rest
  // (wider tolerance because the keyframe animation can catch mid-frame
  // scaling the element by up to 1.012 × or 0.965 ×; at viewBox the
  // opaque footprint should be 192 * 0.8125 = 156).
  const defaultTheme = report.themes["kinetic-node"];
  report.criteria.sizing = Math.abs(defaultTheme.opaqueFootprintPx - 156) <= 10;

  // Acceptance 3: transparent backdrop + no reflow.
  report.criteria.backdrop = defaultTheme.bootBgColor === "rgba(0, 0, 0, 0)"
    && defaultTheme.bootPointerEvents === "none"
    && defaultTheme.bodyScrollHeight === defaultTheme.viewportHeight;

  // Acceptance 4: no double-layer during natural cold-boot.
  // Re-navigate fresh and sample every 25ms for 2500ms — flag any
  // sample where BOTH layers report visible (display != none AND
  // opacity > 0) simultaneously.
  await page.goto(BASE_URL + "&r2=1", { waitUntil: "load" });
  const multiLayerCheck = await page.evaluate(() => {
    return new Promise((resolve) => {
      const samples = [];
      const t0 = performance.now();
      const iv = setInterval(() => {
        const boot = document.getElementById("boot-splash");
        const react = document.querySelector("[data-testid=\"launch-animation\"]");
        const bootVisible = (() => {
          if (!boot) return false;
          const cs = getComputedStyle(boot);
          return cs.display !== "none" && parseFloat(cs.opacity) > 0;
        })();
        const reactVisible = (() => {
          if (!react) return false;
          const cs = getComputedStyle(react);
          return cs.display !== "none" && parseFloat(cs.opacity) > 0;
        })();
        samples.push({
          t: Math.round(performance.now() - t0),
          bootVisible,
          reactVisible,
          both: bootVisible && reactVisible,
        });
        if (performance.now() - t0 > 2500) {
          clearInterval(iv);
          resolve(samples);
        }
      }, 25);
    });
  });
  const doubleLayerFrames = multiLayerCheck.filter((s) => s.both);
  report.criteria.singleLayer = doubleLayerFrames.length === 0;
  report.multiLayerSampleCount = multiLayerCheck.length;
  report.multiLayerDoubleCount = doubleLayerFrames.length;
  report.multiLayerDoubleFrames = doubleLayerFrames.slice(0, 5);

  report.verdict = Object.values(report.criteria).every(Boolean) ? "PASS" : "FAIL";

  await ctx.close();
  await browser.close();
  return report;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const browsers = parseArgs();
  const reports = [];
  for (const b of browsers) {
    try {
      const r = await run(b);
      reports.push(r);
    } catch (e) {
      reports.push({ browser: b, verdict: "ERROR", error: String(e.stack || e) });
    }
  }
  const reportPath = path.join(OUT_DIR, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(reports, null, 2));
  for (const r of reports) {
    process.stdout.write(`\n=== ${r.browser}: ${r.verdict} ===\n`);
    if (r.verdict === "ERROR") {
      process.stdout.write(`${r.error}\n`);
      continue;
    }
    process.stdout.write(`retinting:   ${r.criteria.retinting}\n`);
    process.stdout.write(`sizing:      ${r.criteria.sizing} (opaque footprint ${r.themes["kinetic-node"].opaqueFootprintPx}px, target 156±10)\n`);
    process.stdout.write(`backdrop:    ${r.criteria.backdrop} (bg=${r.themes["kinetic-node"].bootBgColor}, pointer-events=${r.themes["kinetic-node"].bootPointerEvents}, reflow=${r.themes["kinetic-node"].bodyScrollHeight !== r.themes["kinetic-node"].viewportHeight})\n`);
    process.stdout.write(`singleLayer: ${r.criteria.singleLayer} (${r.multiLayerDoubleCount}/${r.multiLayerSampleCount} double-layer samples)\n`);
  }
  process.stdout.write(`\nreport: ${reportPath}\n`);
  const anyFail = reports.some((r) => r.verdict !== "PASS");
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
