function readEnv(key: string, fallback: string): string {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return trimmed === '' ? fallback : trimmed;
}

/** Konfigurasi outlet & terminal lokal — sumber tunggal untuk server. */
export function getOutletEnvConfig() {
  return {
    outletId: readEnv('OUTLET_ID', 'out_sakupos_coffee_01'),
    outletName: readEnv('OUTLET_NAME', 'SAKUPOS - COFFEE'),
    outletDisplayName: readEnv(
      'OUTLET_DISPLAY_NAME',
      'SakuPOS - Coffee',
    ),
    terminalId: readEnv('TERMINAL_ID', 'TERM-01'),
    companyId: readEnv('COMPANY_ID', 'sakupos-coffee-local'),
    trxPrefix: readEnv('OUTLET_TRX_PREFIX', 'SAKUPOS'),
    salesChannel: readEnv('SALES_CHANNEL', 'pos'),
  };
}

/** Default pajak order lokal (10%) — override via env OUTLET_TAX_RATE jika perlu. */
export function resolveOrderTaxRate(): number {
  const envRate = Number(process.env.OUTLET_TAX_RATE);
  if (Number.isFinite(envRate) && envRate >= 0 && envRate <= 1) {
    return envRate;
  }
  return 0.1;
}
