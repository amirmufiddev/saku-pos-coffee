/** Ukuran fisik stiker cup: lebar 5 cm, tinggi 3 cm */
export const CUP_LABEL_WIDTH_MM = 50;
export const CUP_LABEL_HEIGHT_MM = 30;
export const CUP_LABEL_SIZE_DISPLAY = '5×3 cm (50×30 mm)';

/** Margin konten dalam label (mm). Kiri minimal + geser X untuk CD410 / DT640. */
export const CUP_LABEL_PAD_TOP_MM = 1.6;
export const CUP_LABEL_PAD_RIGHT_MM = 2.4;
export const CUP_LABEL_PAD_BOTTOM_MM = 3.6;
export const CUP_LABEL_PAD_LEFT_MM = 1;

/** Geser konten ke kiri saat cetak (nilai negatif). Atur via CUP_LABEL_PRINT_SHIFT_X_MM. */
export function getCupLabelPrintShiftXMm(): number {
  const raw = process.env.CUP_LABEL_PRINT_SHIFT_X_MM;
  if (raw === undefined || raw === '') {
    return -1.5;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1.5;
}

/** Padding kiri ekstra = |shift| agar huruf pertama tidak terpotong overflow. */
export function getCupLabelBleedLeftMm(shiftXMm: number): number {
  return shiftXMm < 0 ? -shiftXMm : 0;
}

/** Geser konten ke bawah (mm positif) — kompensasi clip atas driver CD410. */
export function getCupLabelPrintShiftYMm(): number {
  const raw = process.env.CUP_LABEL_PRINT_SHIFT_Y_MM;
  if (raw === undefined || raw === '') {
    return 0.45;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0.45;
}
