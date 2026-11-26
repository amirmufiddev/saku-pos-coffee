import { getOutletEnvConfig } from '../config/outlet-env.js';

/** Format nomor transaksi lokal: `{trx_prefix}-{YYMMDD}-{000001}` */
export const ERP_TRX_CODE_PATTERN = /^[A-Z0-9]+-\d{6}-\d{6}$/i;

export function resolveOutletTrxPrefix(): string {
  const { trxPrefix } = getOutletEnvConfig();
  const normalized = (trxPrefix || 'SAKUPOS').trim().toUpperCase();
  return normalized || 'SAKUPOS';
}

/** Tanggal kalender lokal (bukan UTC) — selaras nomor order & `order_sequence.date_key`. */
export function formatLocalDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatLocalOrderNumber(date: Date, sequence: number, trxPrefix?: string): string {
  const prefix = (trxPrefix || resolveOutletTrxPrefix()).toUpperCase();
  const yy = date.getFullYear().toString().slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(Math.max(1, sequence)).padStart(6, '0');
  return `${prefix}-${yy}${mm}${dd}-${seq}`;
}

/** Pola GLOB SQLite: `SAKUPOS-261026-*` untuk hari yang sama (lokal). */
export function buildLocalOrderNumberGlobForDate(date: Date = new Date(), trxPrefix?: string): string {
  const prefix = (trxPrefix || resolveOutletTrxPrefix()).toUpperCase();
  const yy = date.getFullYear().toString().slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${yy}${mm}${dd}-*`;
}
