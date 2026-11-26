// electron/receipt-print.util.ts — Thermal Receipt Printer (Blueprint 800MP / POS-80 / 80mm)
import { BrowserWindow, type WebContentsPrintOptions } from 'electron';

export interface ReceiptPrintOptions {
  deviceName: string;
  copies?: number;
  silent?: boolean;
}

/**
 * Wraps raw receipt HTML into an 80mm continuous thermal paper document
 * styled specifically for Blueprint 800MP ESC/POS thermal head.
 */
function wrapReceiptHtml(htmlContent: string, copyIndex: number, totalCopies: number): string {
  const copyLabel =
    totalCopies > 1
      ? copyIndex === 0
        ? '--- LEMBAR PELANGGAN / CUSTOMER COPY ---'
        : '--- LEMBAR KASIR / MERCHANT COPY ---'
      : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <title>Struk Pembayaran SakuPOS - Coffee</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0;
      padding: 0;
      width: 72mm;
      max-width: 80mm;
      background: #ffffff;
      color: #000000;
      font-family: 'Courier New', Courier, monospace, sans-serif;
      font-size: 11px;
      line-height: 1.35;
    }
    .receipt-copy-badge {
      text-align: center;
      font-size: 9px;
      font-weight: bold;
      letter-spacing: 0.5px;
      padding: 4px 0 6px 0;
      border-bottom: 1px dashed #000000;
      margin-bottom: 8px;
    }
    .receipt-content {
      width: 100%;
    }
    img {
      filter: grayscale(100%) contrast(150%);
      max-width: 100%;
    }
    .cut-spacing {
      height: 14mm; /* extra margin at bottom for auto-cutter clearance */
    }
  </style>
</head>
<body>
  ${copyLabel ? `<div class="receipt-copy-badge">${copyLabel}</div>` : ''}
  <div class="receipt-content">
    ${htmlContent}
  </div>
  <div class="cut-spacing"></div>
</body>
</html>`;
}

/**
 * Sends receipt print job to Windows Spooler for Blueprint 800MP printer.
 * If copies = 2, sends 2 separate print jobs with delay so Blueprint hardware auto-cutter
 * cuts between Customer Copy and Merchant Copy cleanly.
 */
export async function printReceiptToSpooler(
  htmlContent: string,
  options: ReceiptPrintOptions,
): Promise<{ success: boolean; copiesPrinted: number }> {
  const { deviceName, copies = 2 } = options;

  if (!deviceName) {
    throw new Error('Nama printer struk Windows tidak ditemukan (pastikan Blueprint 800MP terhubung).');
  }

  const totalCopies = Math.max(1, copies);

  for (let c = 0; c < totalCopies; c++) {
    let printWindow: BrowserWindow | null = null;
    try {
      printWindow = new BrowserWindow({
        show: false,
        backgroundColor: '#ffffff',
        webPreferences: {
          offscreen: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      const fullHtml = wrapReceiptHtml(htmlContent, c, totalCopies);

      await printWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`,
      );

      await printWindow.webContents.executeJavaScript(`
        new Promise((resolve) => {
          if (document.readyState === 'complete') resolve();
          else window.addEventListener('load', () => resolve(), { once: true });
        });
      `);

      await new Promise<void>((resolve, reject) => {
        if (!printWindow) {
          reject(new Error('Window printer struk tidak terinisialisasi.'));
          return;
        }

        const printOptions: WebContentsPrintOptions = {
          silent: true,
          deviceName,
          printBackground: true,
          landscape: false,
          margins: { marginType: 'none' },
          usePrinterDefaultPageSize: true, // Continuous roll on Blueprint 800MP
        };

        printWindow.webContents.print(printOptions, (success, failureReason) => {
          if (success) {
            resolve();
          } else {
            reject(
              new Error(
                failureReason
                  ? `Cetak struk gagal: ${failureReason}`
                  : 'Cetak struk gagal (driver menolak atau printer Blueprint 800MP offline).',
              ),
            );
          }
        });
      });
    } finally {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
      }
    }

    // Delay between copies to give the Blueprint 800MP hardware cutter time to cut
    if (totalCopies > 1 && c < totalCopies - 1) {
      await new Promise((r) => setTimeout(r, 650));
    }
  }

  return { success: true, copiesPrinted: totalCopies };
}
