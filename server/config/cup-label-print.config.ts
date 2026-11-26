export function isCupLabelDelegatedToHost(): boolean {
  const transport = (process.env.PRINTER_TRANSPORT || '').trim().toLowerCase();
  return (
    process.env.CUP_LABEL_DELEGATE_HOST === 'true' ||
    transport === 'windows' ||
    transport === 'winspool'
  );
}

export function getCupLabelPrinterDisplayName(): string {
  const fromEnv = (process.env.CUP_LABEL_PRINTER_NAME || '').trim();
  return fromEnv || 'CD410Label Printer';
}

/**
 * CD410 / driver Windows punya margin hardware + Chromium sering mengabaikan pageSize kustom.
 * Default: pakai ukuran kertas dari driver (Preferences printer harus 50×30 mm).
 */
export function shouldUsePrinterDefaultPageSize(): boolean {
  return process.env.CUP_LABEL_USE_PRINTER_PAGE_SIZE !== 'false';
}

/** DPI head thermal label (203 = 8 dot/mm). Hindari silent print “kecil di tengah” (72 DPI). */
export function getCupLabelPrintDpi(): number {
  const raw = Number(process.env.CUP_LABEL_PRINT_DPI || '203');
  return raw > 50 && raw < 600 ? Math.round(raw) : 203;
}

export function getCupLabelPrintScaleFactor(): number {
  const raw = Number(process.env.CUP_LABEL_PRINT_SCALE_FACTOR || '100');
  return raw > 10 && raw <= 200 ? Math.round(raw) : 100;
}

/** Margin tambahan di dialog print Electron (px). Kanan positif → konten geser kiri di halaman lebar. */
export function getCupLabelPrintMarginPx(): {
  marginType: 'none' | 'custom';
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const useCustom = process.env.CUP_LABEL_PRINT_MARGIN_CUSTOM === 'true';
  if (!useCustom) {
    return { marginType: 'none', top: 0, bottom: 0, left: 0, right: 0 };
  }
  const left = Number(process.env.CUP_LABEL_PRINT_MARGIN_LEFT_PX || '0');
  const right = Number(process.env.CUP_LABEL_PRINT_MARGIN_RIGHT_PX || '24');
  const top = Number(process.env.CUP_LABEL_PRINT_MARGIN_TOP_PX || '0');
  const bottom = Number(process.env.CUP_LABEL_PRINT_MARGIN_BOTTOM_PX || '0');
  return {
    marginType: 'custom',
    top: Number.isFinite(top) ? top : 0,
    bottom: Number.isFinite(bottom) ? bottom : 0,
    left: Number.isFinite(left) ? left : 0,
    right: Number.isFinite(right) ? right : 24,
  };
}
