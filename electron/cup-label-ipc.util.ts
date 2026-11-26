import type { CupLabelPayload, VariantSize } from '../server/types/index.js';
import { CupLabelService } from '../server/services/CupLabelService.js';

export interface CupLabelPrintIpcParams {
  html?: string;
  productName?: string;
  size?: string;
  modifiers?: string[];
  orderNumber?: string;
  pagerNumber?: string;
  customerName?: string;
  notes?: string;
}

function normalizeVariantSize(size?: string): VariantSize {
  return size?.toLowerCase() === 'large' ? 'Large' : 'Regular';
}

export function buildCupLabelPayloadFromIpc(
  params: CupLabelPrintIpcParams,
): CupLabelPayload {
  return {
    orderId: 'electron-test',
    orderNumber: params.orderNumber || 'TEST',
    outletName: 'SakuPOS - Coffee',
    customerName: params.customerName || 'Walk-in',
    orderTime: new Date().toISOString(),
    pagerNumber: params.pagerNumber,
    cupIndex: 1,
    totalCups: 1,
    productName: params.productName || 'Test Beverage',
    variantSize: normalizeVariantSize(params.size),
    modifiersSummary: params.modifiers || [],
    notes: params.notes,
    isReprint: false,
  };
}

export function resolveCupLabelHtml(params: CupLabelPrintIpcParams): string {
  if (params.html && params.html.trim()) {
    return params.html.trim();
  }
  const payload = buildCupLabelPayloadFromIpc(params);
  return CupLabelService.renderHtml(payload);
}
