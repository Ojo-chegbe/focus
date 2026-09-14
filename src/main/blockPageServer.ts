import http from "node:http";
import { getAppIconDataUrl } from "./appIcon";

export class BlockPageServer {
  private serverByAddress = new Map<string, http.Server>();

  start(port: number): void {
    if (this.serverByAddress.size > 0) return;

    const iconDataUrl = getAppIconDataUrl();
    const iconHtml = iconDataUrl ? `<img src="${iconDataUrl}" width="64" height="64" style="border-radius:14px;margin-bottom:16px;display:inline-block;" alt="Focus" />` : "";

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Blocked by Focus</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Segoe UI, sans-serif; background: #0f172a; color: #f8fafc; }
    main { max-width: 560px; padding: 32px; text-align: center; }
    h1 { margin: 0 0 12px; font-size: 34px; }
    p { margin: 0; color: #cbd5e1; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    ${iconHtml}
    <h1>Blocked by Focus</h1>
    <p>This site is currently blocked by an active focus profile. Return to your planned task or adjust the profile when strict mode allows it.</p>
  </main>
</body>
</html>`;

    // Hosts-file blocking sends plain HTTP requests to 127.0.0.1:80.
    // Keep the configurable port too so the page is still reachable directly.
    for (const targetPort of new Set([80, port])) {
      for (const host of ["127.0.0.1", "::1"] as const) {
        const key = `${host}:${targetPort}`;
        const server = http.createServer((_, response) => {
          response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          response.end(html);
        });
        server.on("error", () => {
          this.serverByAddress.delete(key);
        });
        server.listen(targetPort, host);
        this.serverByAddress.set(key, server);
      }
    }
  }

  stop(): void {
    for (const server of this.serverByAddress.values()) {
      server.close();
    }
    this.serverByAddress.clear();
  }
}
