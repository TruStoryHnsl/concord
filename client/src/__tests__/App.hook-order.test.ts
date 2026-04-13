import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";

describe("App boot contract", () => {
  it("renders the server picker before the login form when no server is selected", () => {
    const pickerIndex = appSource.indexOf("if (!serverConnected) {");
    const loginIndex = appSource.indexOf("if (!isLoggedIn) {");
    const shellIndex = appSource.indexOf("const shellContent = (");

    expect(pickerIndex).toBeGreaterThan(-1);
    expect(loginIndex).toBeGreaterThan(-1);
    expect(shellIndex).toBeGreaterThan(-1);
    expect(pickerIndex).toBeLessThan(loginIndex);
    expect(loginIndex).toBeLessThan(shellIndex);
  });

  it("keeps unauthenticated web boots on LoginForm instead of the hollow shell", () => {
    expect(appSource).toContain("<LoginForm />");
    expect(appSource).not.toContain("onAddSource={openAddSourceModal}");
    expect(appSource).not.toContain("addSourceModalOpen");
  });
});
