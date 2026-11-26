import { BrowserWindow, type WebContentsPrintOptions } from 'electron';
import {
  getCupLabelPrintDpi,
  getCupLabelPrintMarginPx,
  getCupLabelPrintScaleFactor,
  shouldUsePrinterDefaultPageSize,
} from '../server/config/cup-label-print.config.js';
import {
  CUP_LABEL_HEIGHT_MM,
  CUP_LABEL_WIDTH_MM,
} from '../server/constants/cup-label-dimensions.js';

export interface SpoolerPrintPageMm {
  widthMm: number;
  heightMm: number;
  scale?: number;
}

function wrapHtmlForSpooler(
  htmlFragment: string,
  page: SpoolerPrintPageMm,
): string {
  const scale = page.scale ?? 1;
  const scaleBlock =
    scale !== 1
      ? `.scale-wrap { transform: scale(${scale}); transform-origin: top left; width: 200px; }`
      : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: ${page.widthMm}mm ${page.heightMm}mm; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      width: ${page.widthMm}mm;
      height: ${page.heightMm}mm;
      overflow: hidden;
      background: #fff;
      box-sizing: border-box;
    }
    .cup-label-shell {
      width: ${page.widthMm}mm !important;
      height: ${page.heightMm}mm !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .cup-label {
      box-sizing: border-box !important;
      position: relative !important;
    }
    .cup-label-footer {
      position: absolute !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    ${scaleBlock}
  </style>
</head>
<body>
  ${scale !== 1 ? `<div class="scale-wrap">${htmlFragment}</div>` : htmlFragment}
</body>
</html>`;
}

export async function printHtmlToWindowsSpooler(
  htmlFragment: string,
  deviceName: string,
  page?: SpoolerPrintPageMm,
): Promise<void> {
  const pageMm = page ?? {
    widthMm: CUP_LABEL_WIDTH_MM,
    heightMm: CUP_LABEL_HEIGHT_MM,
  };
  if (!deviceName) {
    throw new Error('Nama printer Windows kosong — set CUP_LABEL_PRINTER_NAME di .env');
  }

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

    const fullHtml = wrapHtmlForSpooler(htmlFragment, pageMm);
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
        reject(new Error('Print window tidak terinisialisasi'));
        return;
      }

      const marginPx = getCupLabelPrintMarginPx();
      const dpi = getCupLabelPrintDpi();
      const usePrinterPage = shouldUsePrinterDefaultPageSize();
      const printOptions: WebContentsPrintOptions = {
        silent: true,
        deviceName,
        printBackground: true,
        landscape: false,
        scaleFactor: getCupLabelPrintScaleFactor(),
        dpi: { horizontal: dpi, vertical: dpi },
        margins:
          marginPx.marginType === 'custom'
            ? {
              marginType: 'custom',
              top: marginPx.top,
              bottom: marginPx.bottom,
              left: marginPx.left,
              right: marginPx.right,
            }
            : { marginType: 'none' },
      };
      if (usePrinterPage) {
        printOptions.usePrinterDefaultPageSize = true;
      } else {
        printOptions.pageSize = {
          width: pageMm.widthMm * 1000,
          height: pageMm.heightMm * 1000,
        };
      }

      printWindow.webContents.print(
        printOptions,
        (success, failureReason) => {
          if (success) {
            resolve();
          } else {
            reject(
              new Error(
                failureReason
                  ? `Windows print gagal: ${failureReason}`
                  : 'Windows print gagal (driver menolak atau printer offline)',
              ),
            );
          }
        },
      );
    });
  } finally {
    if (printWindow && !printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

export async function printCupLabelHtml(
  htmlFragment: string,
  deviceName: string,
): Promise<void> {
  return printHtmlToWindowsSpooler(htmlFragment, deviceName, {
    widthMm: CUP_LABEL_WIDTH_MM,
    heightMm: CUP_LABEL_HEIGHT_MM,
  });
}
