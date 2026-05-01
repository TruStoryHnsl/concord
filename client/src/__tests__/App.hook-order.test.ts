import { describe, expect, it } from "vitest";
import appSource from "../App.tsx?raw";

describe("App boot contract", () => {
  it("renders the server picker before the login form on web/Docker boots when no server is selected", () => {
    // Post-INS-058: the gate ordering still exists for the NON-Tauri
    // (web/Docker) path. On Tauri, both gates short-circuit and
    // ChatLayout (the hollow shell) renders directly.
    const pickerIndex = appSource.indexOf("if (!isTauri && !serverConnected) {");
    const loginIndex = appSource.indexOf("if (!isTauri && !isLoggedIn) {");
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
