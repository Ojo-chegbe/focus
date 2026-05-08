import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ActiveRules, HelperStatus } from "../shared/models";

const execFileAsync = promisify(execFile);
const START_MARKER = "# >>> Focus managed block";
const END_MARKER = "# <<< Focus managed block";

export class HostsBlocker {
  private lastAppliedAt?: string;
  private lastError?: string;

  get hostsPath(): string {
    if (process.platform === "win32") {
      return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts");
    }
    return "/etc/hosts";
  }

  async getStatus(activeRules: ActiveRules): Promise<HelperStatus> {
    return {
      platform: process.platform,
      isWindows: process.platform === "win32",
      isElevated: await this.isElevated(),
      hostsPath: this.hostsPath,
      lastAppliedAt: this.lastAppliedAt,
      lastError: this.lastError,
      activeRules
    };
  }

  async apply(activeRules: ActiveRules): Promise<void> {
    this.lastError = undefined;
    try {
      const hosts = this.buildHostsEntries(activeRules);
      const existing = fs.existsSync(this.hostsPath) ? fs.readFileSync(this.hostsPath, "utf8") : "";
      const next = this.replaceManagedBlock(existing, hosts);
      if (next !== existing) {
        fs.writeFileSync(this.hostsPath, next, "utf8");
        await this.flushDns();
      }
      this.lastAppliedAt = new Date().toISOString();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  buildHostsEntries(activeRules: ActiveRules): string {
    const hosts = new Set<string>();
    for (const site of activeRules.sites) {
      hosts.add(site.normalizedHost);
      if (site.includeSubdomains) {
        for (const host of getCommonSubdomains(site.normalizedHost)) {
          hosts.add(host);
        }
      }
    }

    if (hosts.size === 0) return "";
    return [...hosts]
      .sort()
      .flatMap((host) => [`127.0.0.1 ${host}`, `::1 ${host}`])
      .join(os.EOL);
  }

  replaceManagedBlock(existing: string, block: string): string {
    const withoutBlock = existing.replace(
      new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\s*`, "m"),
      ""
    );
    const trimmed = withoutBlock.trimEnd();
    if (!block.trim()) return `${trimmed}${os.EOL}`;
    return `${trimmed}${os.EOL}${os.EOL}${START_MARKER}${os.EOL}${block}${os.EOL}${END_MARKER}${os.EOL}`;
  }

  async flushDns(): Promise<void> {
    if (process.platform === "win32") {
      await execFileAsync("ipconfig.exe", ["/flushdns"], { windowsHide: true });
    }
  }

  async isElevated(): Promise<boolean> {
    if (process.platform !== "win32") return process.getuid?.() === 0;
    try {
      await execFileAsync("net.exe", ["session"], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
}

function getCommonSubdomains(host: string): string[] {
  return ["www", "m", "mobile", "new", "old", "login", "accounts", "account"]
    .map((subdomain) => `${subdomain}.${host}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
