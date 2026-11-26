// server/services/CupLabelService.ts
import {
  CUP_LABEL_HEIGHT_MM,
  CUP_LABEL_PAD_BOTTOM_MM,
  CUP_LABEL_PAD_LEFT_MM,
  CUP_LABEL_PAD_RIGHT_MM,
  CUP_LABEL_PAD_TOP_MM,
  CUP_LABEL_WIDTH_MM,
  getCupLabelBleedLeftMm,
  getCupLabelPrintShiftXMm,
  getCupLabelPrintShiftYMm,
} from '../constants/cup-label-dimensions.js';
import type { CupLabelPayload } from '../types/index.js';

export interface RenderedLabel {
  html: string;
  plainText: string;
  escposBytes: Uint8Array;
}

export class CupLabelService {
  /**
   * Renders HTML for cup sticker 5×3 cm (50×30 mm) — preview & Windows spooler print.
   * Logo, header, and order metadata stay as is.
   * Underneath the beverage name: ICE/HOT, SIZE, dan seluruh modifier dari snapshot pesanan.
   */
  public static renderHtml(payload: CupLabelPayload): string {
    const timeFormatted = new Date(payload.orderTime).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });

    // Temperature & Size (e.g. ICE,REGULAR like in the thermal sticker photo)
    const isHot = (payload.notes || '').toLowerCase().includes('panas') ||
                  (payload.notes || '').toLowerCase().includes('hot');
    const tempStr = isHot ? 'HOT' : 'ICE';
    const sizeStr = (payload.variantSize || 'REGULAR').toUpperCase();
    const specLine = `${tempStr}, ${sizeStr}`;

    const modifierLines = payload.modifiersSummary || [];

    const reprintBadge = payload.isReprint
      ? `<div style="background:#0f172a;color:#ffffff;font-size:7.5px;font-weight:900;padding:1.5px 4px;text-align:center;margin:0 0 2px 0;letter-spacing:0.6px;">*** REPRINT ***</div>`
      : '';

    const modifierItems = modifierLines.length > 0
      ? modifierLines
          .map(m => `<div style="font-size:8.5px;font-weight:700;color:#0f172a;line-height:1.1;">• ${m}</div>`)
          .join('')
      : '';

    const notesItem = payload.notes && !isHot
      ? `<div style="font-size:9.5px;font-weight:bold;color:#b45309;margin-top:1px;line-height:1.12;">NB: ${payload.notes}</div>`
      : '';

    const shiftX = getCupLabelPrintShiftXMm();
    const shiftY = getCupLabelPrintShiftYMm();
    const bleedLeft = getCupLabelBleedLeftMm(shiftX);
    const padLeftMm = CUP_LABEL_PAD_LEFT_MM + bleedLeft;
    const padTop = `${CUP_LABEL_PAD_TOP_MM + shiftY}mm`;
    const padRight = `${CUP_LABEL_PAD_RIGHT_MM}mm`;
    const padBottom = `${CUP_LABEL_PAD_BOTTOM_MM}mm`;
    const padLeft = `${padLeftMm}mm`;

    return `
      <div class="cup-label-shell" style="
        width: ${CUP_LABEL_WIDTH_MM}mm;
        height: ${CUP_LABEL_HEIGHT_MM}mm;
        max-height: ${CUP_LABEL_HEIGHT_MM}mm;
        overflow: hidden;
        position: relative;
        box-sizing: border-box;
      ">
      <div class="cup-label" style="
        width: ${CUP_LABEL_WIDTH_MM}mm;
        min-height: ${CUP_LABEL_HEIGHT_MM}mm;
        max-height: ${CUP_LABEL_HEIGHT_MM}mm;
        margin-left: ${shiftX}mm;
        padding: ${padTop} ${padRight} ${padBottom} ${padLeft};
        background: #ffffff;
        color: #000000;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        border: none;
        box-sizing: border-box;
        position: relative;
      ">
        <div>
          ${reprintBadge}
          <div style="border-bottom: 1px solid #0f172a; padding-bottom: 2px; margin-bottom: 2px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 2px; padding-bottom: 1mm; width: 100%; box-sizing: border-box;">
              <div style="border: 1px solid #0f172a; border-radius: 2px; display: inline-flex; align-items: center; padding: 1px 3px; font-size: 7px; font-weight: 900; letter-spacing: 0.35px; color: #0f172a; line-height: 1; flex-shrink: 0;">
                <span>SAKUPOS</span>
                <span style="border-left: 1px solid #0f172a; margin-left: 2px; padding-left: 2px;">COFFEE</span>
              </div>
              <span style="flex: 1 1 auto; min-width: 0; font-size: 5.6px; font-weight: 700; color: #64748b; letter-spacing: 0.1px; text-align: right; line-height: 1; white-space: nowrap;">
                GRAB &amp; GO COUNTER
              </span>
            </div>
          </div>
        </div>

        <div style="overflow: hidden; padding-top: 0.3mm; max-height: 16mm; box-sizing: border-box;">
          <div style="font-size: 11px; font-weight: 800; color: #0f172a; line-height: 1.1; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word;">
            ${payload.productName}
          </div>
          <div style="font-size: 8.5px; font-weight: 700; color: #475569; margin-top: 0.5px; letter-spacing: 0.2px;">
            ${specLine}
          </div>
          <div style="overflow: hidden; margin-top: 0.5px;">
            ${modifierItems}
            ${notesItem}
          </div>
        </div>

        <div class="cup-label-footer" style="position: absolute; left: ${padLeft}; right: ${padRight}; bottom: 0.6mm; display: flex; justify-content: space-between; align-items: center; gap: 2px; border-top: 1px dashed #94a3b8; padding-top: 1.5px; min-height: 3mm; font-size: 8px; color: #0f172a; line-height: 1.3; background: #ffffff; box-sizing: border-box;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 auto;">Cust: <b>${payload.customerName || 'Walk-in'}</b></span>
          <span style="font-weight: 700; font-family: monospace; flex-shrink: 0; padding-right: 0.2mm;">${timeFormatted}</span>
        </div>
      </div>
      </div>
    `.trim();
  }

  /**
   * Plain text format for ESC/POS label receipt printers.
   */
  public static renderPlainText(payload: CupLabelPayload): string {
    const timeFormatted = new Date(payload.orderTime).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const isHot = (payload.notes || '').toLowerCase().includes('panas') ||
                  (payload.notes || '').toLowerCase().includes('hot');
    const tempStr = isHot ? 'HOT' : 'ICE';
    const sizeStr = (payload.variantSize || 'REGULAR').toUpperCase();
    const specLine = `${tempStr}, ${sizeStr}`;

    const modifierLines = payload.modifiersSummary || [];

    const lines: string[] = [];
    if (payload.isReprint) {
      lines.push('*** REPRINT ***');
    }
    lines.push('================================');
    lines.push('        SAKUPOS - COFFEE        ');
    lines.push(`Gelas ${payload.cupIndex}/${payload.totalCups}`);
    lines.push('--------------------------------');
    lines.push(payload.productName);
    lines.push(specLine);
    for (const mod of modifierLines) {
      lines.push(` • ${mod}`);
    }
    if (payload.notes && !isHot) {
      lines.push(` Note: ${payload.notes}`);
    }
    lines.push('--------------------------------');
    lines.push(`Cust: ${payload.customerName} | ${timeFormatted}`);
    lines.push('================================');

    return lines.join('\n');
  }

  /**
   * Generates basic ESC/POS byte sequence for ESC/POS sticker printers.
   */
  public static renderEscPos(payload: CupLabelPayload): Uint8Array {
    const text = this.renderPlainText(payload);
    const encoder = new TextEncoder();
    const textBytes = encoder.encode(text);

    // ESC @ (init), ESC ! 0 (normal), ..., GS V 66 0 (feed cut)
    const initCmd = new Uint8Array([0x1b, 0x40]);
    const cutCmd = new Uint8Array([0x1d, 0x56, 0x42, 0x00]);

    const full = new Uint8Array(initCmd.length + textBytes.length + cutCmd.length);
    full.set(initCmd, 0);
    full.set(textBytes, initCmd.length);
    full.set(cutCmd, initCmd.length + textBytes.length);
    return full;
  }
}
