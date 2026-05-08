import http from "node:http";

export class BlockPageServer {
  private server?: http.Server;

  start(port: number): void {
    if (this.server) return;
    this.server = http.createServer((_, response) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
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
    <h1>Blocked by Focus</h1>
    <p>This site is currently blocked by an active focus profile. Return to your planned task or adjust the profile when strict mode allows it.</p>
  </main>
</body>
</html>`);
    });
    this.server.listen(port, "127.0.0.1");
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
  }
}
