import { describe, expect, it } from "vitest";
import chatLayoutSource from "../ChatLayout.tsx?raw";

describe("ChatLayout shell sizing contracts", () => {
  it("keeps the desktop shell pinned to the full viewport", () => {
    expect(chatLayoutSource).toContain(
      'className="h-full w-full min-h-0 min-w-0 relative flex overflow-hidden bg-surface text-on-surface"',
    );
    expect(chatLayoutSource).toContain(
      'className="flex h-full min-h-0 flex-shrink-0 bg-surface"',
    );
    expect(chatLayoutSource).toContain(
      'className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface"',
    );
    expect(chatLayoutSource).toContain(
      'className="flex min-h-0 flex-1"',
    );
  });

  it("keeps all layout branches stretched to fill their wrapper", () => {
    expect(chatLayoutSource).toContain(
      'className="h-full w-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-surface text-on-surface"',
    );
    expect(chatLayoutSource).toContain(
      'className="h-full w-full min-h-0 min-w-0 flex overflow-hidden bg-surface text-on-surface tv-layout"',
    );
    expect(chatLayoutSource).toContain(
      'className="h-full w-full min-h-0 min-w-0" data-concord-layout="tablet"',
    );
    expect(chatLayoutSource).toContain(
      'className="hidden md:block h-full w-full min-h-0 min-w-0" data-concord-layout="desktop"',
    );
    expect(chatLayoutSource).toContain(
      'className="md:hidden h-full w-full min-h-0 min-w-0" data-concord-layout="mobile"',
    );
  });

  it("renders the unified GroupedRail on desktop (sources+servers in one stacked rail)", () => {
    // The old separate 41px Sources column + Server sidebar were merged into
    // one stacked rail (sources centered on their server groups). The desktop
    // shell now mounts <GroupedRail/> in place of that two-column split.
    expect(chatLayoutSource).toContain("import { GroupedRail }");
    expect(chatLayoutSource).toContain("<GroupedRail");
    expect(chatLayoutSource).toContain("onLocalServerSelect={handleLocalServerSelect}");
  });
});
