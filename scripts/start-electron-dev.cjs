const net = require("node:net");
const { spawn } = require("node:child_process");
const electron = require("electron");

const host = "127.0.0.1";
const port = 5173;
const timeoutMs = 30000;
const startedAt = Date.now();

function waitForVite() {
  return new Promise((resolve, reject) => {
    let settled = false;

    function tryConnect() {
      if (settled) return;
      const socket = net.createConnection({ host, port });
      socket.setTimeout(1000);

      socket.once("connect", () => {
        settled = true;
        socket.end();
        resolve();
      });

      socket.once("timeout", () => {
        socket.destroy();
      });

      socket.once("error", () => {
        socket.destroy();
      });

      socket.once("close", () => {
        if (settled) return;
        if (Date.now() - startedAt >= timeoutMs) {
          settled = true;
          reject(new Error(`Timed out waiting for ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 250);
      });
    }

    tryConnect();
  });
}

waitForVite()
  .then(() => {
    console.log("Starting Electron...");
    const child = spawn(electron, ["."], {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: false
    });

    child.on("exit", (code) => {
      console.log(`Electron exited with code ${code ?? 0}`);
      process.exit(code ?? 0);
    });

    child.on("error", (error) => {
      console.error(error);
      process.exit(1);
    });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
