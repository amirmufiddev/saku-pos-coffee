export interface PrinterInfoLite {
  name: string;
  status?: number;
  isDefault?: boolean;
}

/** Maps Electron getPrintersAsync() rows to a stable lite shape (Electron 45+ typings omit status/isDefault). */
export function mapElectronPrinter(printer: {
  name: string;
  options?: unknown;
}): PrinterInfoLite {
  const legacy = printer as typeof printer & { status?: number; isDefault?: boolean };
  const options = (printer.options ?? {}) as Record<string, unknown>;
  const statusRaw = legacy.status ?? options['printer-status'] ?? options.status;
  const defaultRaw =
    legacy.isDefault ??
    options['printer-is-default'] ??
    options['is-default'] ??
    options.isDefault;

  return {
    name: printer.name,
    status: typeof statusRaw === 'number' ? statusRaw : undefined,
    isDefault:
      defaultRaw === true ||
      defaultRaw === 1 ||
      defaultRaw === '1' ||
      defaultRaw === 'true',
  };
}

/**
 * Resolves Windows spooler printer name for cup labels.
 * Prefers exact CUP_LABEL_PRINTER_NAME, then CD410 / DT640 / label heuristics.
 */
export function resolveCupLabelPrinterName(
  printers: PrinterInfoLite[],
  preferred?: string,
): string | null {
  const trimmed = (preferred || '').trim();
  if (trimmed) {
    const exact = printers.find((p) => p.name === trimmed);
    if (exact) return exact.name;

    const lowerPref = trimmed.toLowerCase();
    const contains = printers.find(
      (p) =>
        p.name.toLowerCase().includes(lowerPref) ||
        lowerPref.includes(p.name.toLowerCase()),
    );
    if (contains) return contains.name;
  }

  const byCd410 = printers.find((p) => /CD410/i.test(p.name) && /label/i.test(p.name));
  if (byCd410) return byCd410.name;

  const byDt640 = printers.find((p) => /\bDT[-\s]?640\b/i.test(p.name));
  if (byDt640) return byDt640.name;

  const byDt642 = printers.find((p) => /\bDT[-\s]?642\b/i.test(p.name));
  if (byDt642) return byDt642.name;

  const fourInchLabel = printers.find(
    (p) => /label/i.test(p.name) && /4\s*-?\s*inch|4inch/i.test(p.name),
  );
  if (fourInchLabel) return fourInchLabel.name;

  const anyLabel = printers.find((p) => /label/i.test(p.name));
  if (anyLabel) return anyLabel.name;

  return trimmed || null;
}

/**
 * Resolves Windows spooler printer name for thermal receipts (e.g. Blueprint 800MP / POS-80 / POS800).
 * Prioritizes preferred name, then Blueprint heuristics, then POS/receipt heuristics.
 */
export function resolveReceiptPrinterName(
  printers: PrinterInfoLite[],
  preferred?: string,
): string | null {
  const trimmed = (preferred || '').trim();
  if (trimmed) {
    const exact = printers.find(
      (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exact) return exact.name;

    const lowerPref = trimmed.toLowerCase();
    const contains = printers.find(
      (p) =>
        p.name.toLowerCase().includes(lowerPref) ||
        lowerPref.includes(p.name.toLowerCase()),
    );
    if (contains) return contains.name;
  }

  // 1. Blueprint 800MP / BP-800MP / POS800 / POS-800 / Blueprint
  const byBlueprint = printers.find((p) =>
    /blueprint|\b(bp[-\s]?800|800mp|pos[-\s]?800|pos[-\s]?80)\b/i.test(p.name),
  );
  if (byBlueprint) return byBlueprint.name;

  // 2. Generic Receipt / Thermal / POS printer (excluding label printers)
  const byThermalReceipt = printers.find(
    (p) =>
      /(receipt|thermal|struk|kasir)/i.test(p.name) &&
      !/(label|barcode|cd410|dt640|dt642)/i.test(p.name),
  );
  if (byThermalReceipt) return byThermalReceipt.name;

  // 3. Default Windows printer (if not a label printer)
  const defaultPrinter = printers.find((p) => p.isDefault);
  if (
    defaultPrinter &&
    !/(label|barcode|cd410|dt640|dt642)/i.test(defaultPrinter.name)
  ) {
    return defaultPrinter.name;
  }

  // 4. Any printer matching POS
  const anyPos = printers.find((p) => /\bpos\b/i.test(p.name));
  if (anyPos) return anyPos.name;

  return trimmed || (defaultPrinter ? defaultPrinter.name : null);
}
