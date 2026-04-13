import { describe, expect, it } from "vitest";
import chatLayoutSource from "../ChatLayout.tsx?raw";

describe("source browser auth wiring", () => {
  it("discovers Matrix login flows before adding a source", () => {
    expect(chatLayoutSource).toContain("fetchLoginFlows");
    expect(chatLayoutSource).toContain("buildMatrixSourceDraft");
    expect(chatLayoutSource).toContain("setScreen(\"matrix-auth\")");
  });

  it("supports both password and sso source logins", () => {
    expect(chatLayoutSource).toContain("loginWithPasswordAtBaseUrl");
    expect(chatLayoutSource).toContain("buildSsoRedirectUrl");
    expect(chatLayoutSource).toContain("Continue with SSO");
    expect(chatLayoutSource).toContain("Sign in with password");
  });

  it("loads remote public rooms through the source browser and joins them through the current concord session", () => {
    expect(chatLayoutSource).toContain("loadSourceDirectory");
    expect(chatLayoutSource).toContain("browseClient.publicRooms");
    expect(chatLayoutSource).toContain("client.joinRoom");
  });
});
