import { describe, expect, it } from "vitest";
import { HostsBlocker } from "./hostsBlocker";

describe("HostsBlocker", () => {
  it("builds hosts entries for active sites", () => {
    const blocker = new HostsBlocker();
    const entries = blocker.buildHostsEntries({
      activeProfileIds: ["p1"],
      activeProfileNames: ["Work"],
      activationReasonsByProfileId: { p1: "manual" },
      appPoliciesByProfileId: { p1: "blocklist" },
      blockedApps: [],
      allowedApps: [],
      focusSessionAllowedApps: [],
      activeFocusSession: undefined,
      apps: [],
      sites: [
        {
          id: "s1",
          profileId: "p1",
          domain: "youtube.com",
          normalizedHost: "youtube.com",
          includeSubdomains: true,
          enabled: true
        }
      ]
    });

    expect(entries).toContain("127.0.0.1 youtube.com");
    expect(entries).toContain("::1 www.youtube.com");
    expect(entries).toContain("127.0.0.1 m.youtube.com");
  });

  it("replaces only the managed block", () => {
    const blocker = new HostsBlocker();
    const existing = `127.0.0.1 localhost

# >>> Focus managed block
127.0.0.1 old.com
# <<< Focus managed block
`;

    const next = blocker.replaceManagedBlock(existing, "127.0.0.1 new.com");
    expect(next).toContain("127.0.0.1 localhost");
    expect(next).toContain("127.0.0.1 new.com");
    expect(next).not.toContain("old.com");
  });
});
