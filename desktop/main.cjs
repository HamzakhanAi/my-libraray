const { app, BrowserWindow, dialog } = require("electron");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const APP_NAME = "Lumen Reader";
const START_TIMEOUT_MS = 45000;
const DESKTOP_APP_HOST = "localhost";

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let isQuitting = false;

function getAppRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.resolve(__dirname, "..");
}

function getIconPath() {
  const iconPath = path.join(getAppRoot(), "desktop", "icons", "icon.png");
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function getServerEntry() {
  return path.join(getAppRoot(), "dist", "server.cjs");
}

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();

    tester.once("error", reject);
    tester.listen(0, "127.0.0.1", () => {
      const address = tester.address();
      tester.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }

        reject(new Error("Could not resolve an open port for the desktop server."));
      });
    });
  });
}

function waitForServer(port) {
  const deadline = Date.now() + START_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/api/health",
          timeout: 2000,
        },
        (response) => {
          response.resume();
          if (response.statusCode === 200) {
            resolve();
            return;
          }

          if (Date.now() >= deadline) {
            reject(new Error(`Desktop server started but health check returned ${response.statusCode}.`));
            return;
          }

          setTimeout(attempt, 400);
        },
      );

      request.on("timeout", () => {
        request.destroy(new Error("Timed out waiting for desktop server health."));
      });

      request.on("error", (error) => {
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }

        setTimeout(attempt, 400);
      });
    };

    attempt();
  });
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) {
    serverProcess = null;
    return;
  }

  serverProcess.kill();
  serverProcess = null;
}

function startServer(port) {
  const appRoot = getAppRoot();
  const serverEntry = getServerEntry();

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing desktop server build at ${serverEntry}. Run the build before launching the desktop app.`);
  }

  const child = spawn(process.execPath, [serverEntry], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      DISABLE_HMR: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[desktop-server] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[desktop-server] ${chunk}`);
  });

  child.once("exit", (code, signal) => {
    if (!isQuitting) {
      dialog.showErrorBox(APP_NAME, `The bundled local server stopped unexpectedly (code: ${code ?? "null"}, signal: ${signal ?? "none"}).`);
      app.quit();
    }
  });

  serverProcess = child;
}

async function createMainWindow() {
  if (serverPort == null) {
    serverPort = await findOpenPort();
    startServer(serverPort);
    await waitForServer(serverPort);
  }

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: "#f4ecd8",
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(`http://${DESKTOP_APP_HOST}:${serverPort}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.name = APP_NAME;

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
    dialog.showErrorBox(APP_NAME, error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        await createMainWindow();
      } catch (error) {
        dialog.showErrorBox(APP_NAME, error instanceof Error ? error.message : String(error));
        app.quit();
      }
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});