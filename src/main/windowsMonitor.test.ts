import { describe, expect, it } from "vitest";
import { matchesAppRule } from "./windowsMonitor";

describe("matchesAppRule", () => {
  it("matches executable variants launched by packaged apps", () => {
    expect(
      matchesAppRule(
        {
          id: "a1",
          profileId: "p1",
          displayName: "WhatsApp",
          executable: "whatsapp.exe",
          enabled: true
        },
        {
          executable: "WhatsApp.Root.exe",
          title: "WhatsApp"
        }
      )
    ).toBe(true);
  });

  it("does not match unrelated apps with similar names", () => {
    expect(
      matchesAppRule(
        {
          id: "a1",
          profileId: "p1",
          displayName: "WhatsApp",
          executable: "whatsapp.exe",
          enabled: true
        },
        {
          executable: "whatsappclone.exe",
          title: "WhatsApp Clone"
        }
      )
    ).toBe(false);
  });
});
