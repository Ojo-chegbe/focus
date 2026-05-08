const net = require("node:net");

const host = process.argv[2] || "127.0.0.1";
const port = Number(process.argv[3] || 5173);
const timeoutMs = Number(process.argv[4] || 30000);
const startedAt = Date.now();

function tryConnect() {
  const socket = net.createConnection({ host, port });
  socket.setTimeout(1000);

  socket.on("connect", () => {
    socket.end();
    process.exit(0);
  });

  socket.on("timeout", () => {
    socket.destroy();
  });

  socket.on("error", () => {
    socket.destroy();
  });

  socket.on("close", () => {
    if (Date.now() - startedAt >= timeoutMs) {
      console.error(`Timed out waiting for ${host}:${port}`);
      process.exit(1);
    }
    setTimeout(tryConnect, 250);
  });
}

tryConnect();
