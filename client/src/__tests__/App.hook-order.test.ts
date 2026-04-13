import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";

describe("App hook-order guard", () => {
  it("keeps the add-source auto-close effect before the early return branches", () => {
    const effectNeedle = "useEffect(() => {\n    if (isLoggedIn && addSourceModalOpen)";
    const submitNeedle = '\n  if (path.startsWith("/submit/"))';
    const loadingNeedle = "\n  if (isLoading) {";

    const effectIndex = appSource.indexOf(effectNeedle);
    const submitIndex = appSource.indexOf(submitNeedle);
    const loadingIndex = appSource.indexOf(loadingNeedle);

    expect(effectIndex).toBeGreaterThan(-1);
    expect(submitIndex).toBeGreaterThan(-1);
    expect(loadingIndex).toBeGreaterThan(-1);
    expect(effectIndex).toBeLessThan(submitIndex);
    expect(effectIndex).toBeLessThan(loadingIndex);
  });

  it("documents the rendered-more-hooks regression next to that guard", () => {
    expect(appSource).toContain("Rendered more hooks than during the previous");
  });
});
