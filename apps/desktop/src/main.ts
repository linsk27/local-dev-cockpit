import path from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { startDevCockpitServer, type RunningServer } from "@local-dev-cockpit/server";

let mainWindow: BrowserWindow | undefined;
let runningServer: RunningServer | undefined;

async function createMainWindow(): Promise<void> {
  const webRoot = path.join(__dirname, "web");
  runningServer = await startDevCockpitServer({ port: 8787, webRoot });
  const appUrl = `http://127.0.0.1:${runningServer.port}`;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Dev Cockpit",
    backgroundColor: "#08090c",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(appUrl);
}

app.setName("Dev Cockpit");

app.whenReady().then(() => {
  void createMainWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!runningServer) return;
  event.preventDefault();
  const server = runningServer;
  runningServer = undefined;
  server.close().finally(() => app.exit(0));
});
