// electron/main.ts
import { app, BrowserWindow, ipcMain, screen, utilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { loadProjectEnv } from "../server/config/load-env.js";
import {
  printCupLabelHtml,
  printHtmlToWindowsSpooler,
} from "./cup-label-print.util.js";
import { printReceiptToSpooler } from "./receipt-print.util.js";
import {
  mapElectronPrinter,
  resolveCupLabelPrinterName,
  resolveReceiptPrinterName,
} from "./printer-resolve.util.js";
import type { PrinterInfoLite } from "./printer-resolve.util.js";
import {
  resolveCupLabelHtml,
  type CupLabelPrintIpcParams,
} from "./cup-label-ipc.util.js";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveProjectRoot(): string {
  return path.join(__dirname, "..");
}

let mainWindow: BrowserWindow | null = null;
let customerWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;

let edcManager: any = null;
try {
  const edcModulePath = path.join(
    resolveProjectRoot(),
    "electron",
    "edc",
    "edc-manager.cjs",
  );
  const edcModule = require(edcModulePath);
  edcManager =
    edcModule.edcManager ||
    (edcModule.EDCManager && edcModule.EDCManager.getInstance());
  if (edcManager?.onStatusChange) {
    edcManager.onStatusChange((status: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("edc:status-changed", status);
      }
    });
  }
} catch (e) {
  console.warn("[EDC Main] Failed to load EDC module:", e);
}

const isDev = !app.isPackaged;

loadProjectEnv();

async function getSystemPrinters(): Promise<PrinterInfoLite[]> {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) {
    return [];
  }
  const printers = await win.webContents.getPrintersAsync();
  return printers.map(mapElectronPrinter);
}

async function resolveCupLabelDeviceName(): Promise<string> {
  const preferred = (process.env.CUP_LABEL_PRINTER_NAME || "").trim();
  const printers = await getSystemPrinters();
  const resolved = resolveCupLabelPrinterName(printers, preferred);
  if (!resolved) {
    const listed =
      printers.map((p) => p.name).join(", ") ||
      "(tidak ada printer terdeteksi)";
    throw new Error(
      `Printer cup label tidak ditemukan. Set CUP_LABEL_PRINTER_NAME (saat ini: "${preferred || "kosong"}"). Terdeteksi: ${listed}`,
    );
  }
  return resolved;
}

/**
 * Outlet server (Express + SQLite) runs as a separate Node/utility process.
 */
function startEmbeddedServer(): void {
  if (isDev) {
    console.log(
      "[Electron] Dev: outlet server dijalankan oleh `yarn server:dev` (port 3344)",
    );
    return;
  }

  const port = Number(process.env.SERVER_PORT) || 3344;
  const projectRoot = resolveProjectRoot();

  // 1. Lokasi bundled server di production/packaged installer
  const bundledServer = path.join(__dirname, "server.mjs");

  // 2. Fallback standalone jika menggunakan tsx di lingkungan non-packaged
  const tsxCli = path.join(
    projectRoot,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const serverEntry = path.join(projectRoot, "server", "index.ts");

  const userDataDir = app.getPath("userData");
  const sqliteDataDir = path.join(userDataDir, "data");
  if (!fs.existsSync(sqliteDataDir)) {
    try {
      fs.mkdirSync(sqliteDataDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  const serverEnv = {
    ...process.env,
    SERVER_PORT: String(port),
    DATA_DIR: sqliteDataDir,
    ELECTRON_RUN_AS_NODE: "1",
  };

  if (fs.existsSync(bundledServer)) {
    console.log(`[Electron] Menjalankan bundled server: ${bundledServer} (port ${port})`);
    if (utilityProcess && typeof utilityProcess.fork === "function") {
      serverProcess = utilityProcess.fork(bundledServer, [], {
        cwd: userDataDir,
        env: serverEnv,
        stdio: "inherit",
      }) as any;
    } else {
      serverProcess = spawn(process.execPath, [bundledServer], {
        cwd: userDataDir,
        env: serverEnv,
        stdio: "inherit",
      });
    }
  } else if (fs.existsSync(tsxCli) && fs.existsSync(serverEntry)) {
    console.log(`[Electron] Menjalankan tsx server: ${serverEntry} (port ${port})`);
    serverProcess = spawn(process.execPath, [tsxCli, serverEntry], {
      cwd: projectRoot,
      env: serverEnv,
      stdio: "inherit",
    });
  } else {
    console.warn(
      `[Electron] Embedded server files not found (bundled: ${bundledServer}, tsx: ${serverEntry}). Expecting external server on port ${port}`,
    );
    return;
  }

  if (serverProcess) {
    serverProcess.on("error", (err: any) => {
      console.error("[Electron] Gagal menjalankan outlet server:", err);
    });

    serverProcess.on("exit", (code: number | null, signal: string | null) => {
      if (code !== null && code !== 0) {
        console.warn(
          `[Electron] Outlet server keluar (code=${code}, signal=${signal ?? "none"})`,
        );
      }
      serverProcess = null;
    });

    console.log(`[Electron] Outlet server subprocess started (port ${port})`);
  }
}

function stopEmbeddedServer(): void {
  if (!serverProcess) return;
  try {
    serverProcess.kill();
  } catch {
    // ignore
  }
  serverProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#0c1412",
    title: "SakuPOS - Coffee — Kasir POS",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    autoHideMenuBar: true,
  });

  const devUrl = "http://localhost:5174";
  const prodPath = path.join(__dirname, "../dist/index.html");

  if (isDev) {
    mainWindow.loadURL(devUrl).catch(() => {
      console.warn(`[Electron] ${devUrl} refused, fallback ke ${prodPath}`);
      if (fs.existsSync(prodPath)) {
        mainWindow?.loadFile(prodPath);
      }
    });
  } else {
    mainWindow.loadFile(prodPath).catch((err) => {
      console.error(`[Electron] Gagal load dist/index.html:`, err);
    });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    if (customerWindow) {
      customerWindow.close();
    }
  });
}

function createCustomerWindow(targetDisplayId?: number) {
  if (customerWindow && !customerWindow.isDestroyed()) {
    customerWindow.focus();
    return;
  }

  const displays = screen.getAllDisplays();
  let targetDisplay: any = null;

  if (targetDisplayId) {
    targetDisplay = displays.find((d) => d.id === targetDisplayId);
  }

  if (!targetDisplay) {
    // Select secondary display if available (display not at 0,0 or id != primary)
    const primaryId = screen.getPrimaryDisplay().id;
    targetDisplay =
      displays.find((d) => d.id !== primaryId) || screen.getPrimaryDisplay();
  }

  const isExternal = targetDisplay.id !== screen.getPrimaryDisplay().id;

  customerWindow = new BrowserWindow({
    x: targetDisplay.bounds.x + (isExternal ? 0 : 50),
    y: targetDisplay.bounds.y + (isExternal ? 0 : 50),
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: isExternal, // Kiosk/fullscreen if on dedicated second monitor
    title: "SakuPOS - Coffee — Customer Facing Display",
    backgroundColor: "#020617",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    autoHideMenuBar: true,
  });

  const devUrl = "http://localhost:5174/?display=customer";
  const prodPath = path.join(__dirname, "../dist/index.html");

  if (isDev) {
    customerWindow.loadURL(devUrl).catch(() => {
      if (fs.existsSync(prodPath)) {
        customerWindow?.loadFile(prodPath, { query: { display: "customer" } });
      }
    });
  } else {
    customerWindow.loadFile(prodPath, { query: { display: "customer" } });
  }

  customerWindow.on("closed", () => {
    customerWindow = null;
  });
}

app.whenReady().then(() => {
  startEmbeddedServer();
  createWindow();

  // If a secondary customer display monitor is connected, automatically launch Customer Display on it
  const displays = screen.getAllDisplays();
  if (displays.length > 1) {
    createCustomerWindow();
  }

  // Handle display changes (reconnecting monitor)
  screen.on("display-added", () => {
    if (!customerWindow || customerWindow.isDestroyed()) {
      const updatedDisplays = screen.getAllDisplays();
      if (updatedDisplays.length > 1) {
        createCustomerWindow();
      }
    }
  });

  screen.on("display-removed", () => {
    // If external monitor removed, don't crash
  });

  // IPC Handlers
  ipcMain.handle("open-customer-display", (_event, displayId?: number) => {
    createCustomerWindow(displayId);
    return { success: true };
  });

  ipcMain.handle("get-displays", () => {
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      bounds: d.bounds,
      isPrimary: d.id === screen.getPrimaryDisplay().id,
      label: `Display ${d.id} (${d.bounds.width}x${d.bounds.height})${d.id === screen.getPrimaryDisplay().id ? " - Primary" : " - External"}`,
    }));
  });

  // Relay messages between Cashier and Customer Display windows
  ipcMain.on("cds-message", (_event, data) => {
    if (customerWindow && !customerWindow.isDestroyed()) {
      customerWindow.webContents.send("cds-message-reply", data);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cds-message-reply", data);
    }
  });

  // EDC IPC Handlers matching Grocery-Pos-Desktop
  ipcMain.handle("edc:list-ports", async () => {
    if (!edcManager) return [];
    try {
      return await edcManager.listPorts();
    } catch (err) {
      console.error("[EDC Main] listPorts error:", err);
      return [];
    }
  });

  ipcMain.handle("edc:test-connection", async (_event, params) => {
    if (!edcManager) {
      return {
        success: false,
        message: "Modul EDC belum terpasang atau gagal dimuat di sistem.",
      };
    }
    try {
      return await edcManager.testConnection(params);
    } catch (err: any) {
      console.error("[EDC Main] testConnection error:", err);
      return {
        success: false,
        message: err?.message || "Error pengujian koneksi EDC.",
      };
    }
  });

  ipcMain.handle("edc:process-payment", async (_event, params) => {
    if (!edcManager) {
      return { success: false, message: "Modul EDC tidak tersedia." };
    }
    try {
      return await edcManager.processPayment(params);
    } catch (err: any) {
      console.error("[EDC Main] processPayment error:", err);
      return {
        success: false,
        message: err?.message || "Gagal memproses transaksi EDC.",
      };
    }
  });

  ipcMain.handle("edc:void-transaction", async (_event, params) => {
    if (!edcManager) {
      return { success: false, message: "Modul EDC tidak tersedia." };
    }
    try {
      return await edcManager.voidTransaction(params);
    } catch (err: any) {
      console.error("[EDC Main] voidTransaction error:", err);
      return {
        success: false,
        message: err?.message || "Gagal void transaksi EDC.",
      };
    }
  });

  ipcMain.handle("edc:settle-transaction", async (_event, params) => {
    if (!edcManager) {
      return { success: false, message: "Modul EDC tidak tersedia." };
    }
    try {
      return await edcManager.settleTransaction(params);
    } catch (err: any) {
      console.error("[EDC Main] settleTransaction error:", err);
      return {
        success: false,
        message: err?.message || "Gagal settlement EDC.",
      };
    }
  });

  ipcMain.handle("edc:inquiry-qris-last", async (_event, params) => {
    if (!edcManager) {
      return { success: false, message: "Modul EDC tidak tersedia." };
    }
    try {
      return await edcManager.inquiryQrisLastTransaction(params);
    } catch (err: any) {
      console.error("[EDC Main] inquiryQrisLast error:", err);
      return {
        success: false,
        message: err?.message || "Gagal inquiry QRIS EDC.",
      };
    }
  });

  ipcMain.handle("edc:inquiry-qris-any", async (_event, params) => {
    if (!edcManager) {
      return { success: false, message: "Modul EDC tidak tersedia." };
    }
    try {
      return await edcManager.inquiryQrisAnyTransaction(params);
    } catch (err: any) {
      console.error("[EDC Main] inquiryQrisAny error:", err);
      return {
        success: false,
        message: err?.message || "Gagal inquiry QRIS EDC.",
      };
    }
  });

  ipcMain.handle("edc:get-status", async () => {
    if (!edcManager) {
      return {
        state: "DISCONNECTED",
        activePortPath: null,
        activeOperation: null,
        recovery: null,
        savedDevice: null,
      };
    }
    try {
      return edcManager.getStatus();
    } catch (err) {
      console.error("[EDC Main] getStatus error:", err);
      return {
        state: "DISCONNECTED",
        activePortPath: null,
        activeOperation: null,
        recovery: null,
        savedDevice: null,
      };
    }
  });

  ipcMain.handle("edc:reset-recovery", async (_event, params) => {
    if (!edcManager) {
      return { success: false, message: "Modul EDC tidak tersedia." };
    }
    try {
      return edcManager.resetRecovery(params?.reason, params?.method);
    } catch (err: any) {
      console.error("[EDC Main] resetRecovery error:", err);
      return {
        success: false,
        message: err?.message || "Gagal reset recovery EDC.",
      };
    }
  });

  ipcMain.handle("get-printers", async () => {
    try {
      const printers = await getSystemPrinters();
      return {
        success: true,
        printers: printers.map((p) => ({
          name: p.name,
          status: p.status,
          isDefault: p.isDefault,
        })),
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Gagal membaca daftar printer";
      return { success: false, message, printers: [] };
    }
  });

  ipcMain.handle(
    "print-cup-label",
    async (_event, params: CupLabelPrintIpcParams) => {
      try {
        const deviceName = await resolveCupLabelDeviceName();
        const html = resolveCupLabelHtml(params || {});
        await printCupLabelHtml(html, deviceName);
        console.log(`[CupLabel] Printed via "${deviceName}"`);
        return { success: true, deviceName };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Gagal cetak cup label";
        console.error("[CupLabel] print failed:", message);
        return { success: false, message };
      }
    },
  );

  ipcMain.handle(
    "print-receipt",
    async (
      _event,
      params: { htmlContent?: string; deviceName?: string; copies?: number },
    ) => {
      try {
        const preferred = (
          params?.deviceName ||
          process.env.RECEIPT_PRINTER_NAME ||
          "POS800"
        ).trim();
        const printers = await getSystemPrinters();
        const deviceName =
          resolveReceiptPrinterName(printers, preferred) ||
          printers.find((p) => p.isDefault)?.name ||
          preferred;

        if (!deviceName) {
          return {
            success: false,
            message: "Printer struk tidak ditemukan di Windows.",
          };
        }

        const html =
          params?.htmlContent ||
          '<div style="font-family:monospace;padding:12px;text-align:center"><h3>SAKUPOS - COFFEE</h3><p>Test Struk Blueprint 800MP</p></div>';

        const copies = Math.max(
          1,
          Number(params?.copies) ||
            Number(process.env.RECEIPT_PRINT_COPIES) ||
            2,
        );

        await printReceiptToSpooler(html, { deviceName, copies });
        console.log(`[Receipt] Struk pembayaran berhasil dicetak via "${deviceName}" (${copies}x cetak)`);
        return { success: true, deviceName, copies };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Gagal cetak struk";
        console.error("[Receipt] Cetak struk gagal:", message);
        return { success: false, message };
      }
    },
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopEmbeddedServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopEmbeddedServer();
});
