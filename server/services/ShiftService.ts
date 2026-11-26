// server/services/ShiftService.ts
import { v4 as uuidv4 } from 'uuid';
import { OutletDatabase } from '../db/database.js';
import { getOutletEnvConfig } from '../config/outlet-env.js';
import type {
  UserRecord,
  ShiftRecord,
  OpenShiftRequest,
  CloseShiftRequest,
} from '../types/index.js';

export interface ShiftLiveSummary {
  totalOrders: number;
  totalCups: number;
  grossSales: number;
  discount: number;
  tax: number;
  netSales: number;
  cashSales: number;
  qrisSales: number;
  edcSales: number;
  startingCash: number;
  expectedCash: number;
}

export class ShiftService {
  constructor(private dbInstance: OutletDatabase) { }

  private get db() {
    return this.dbInstance.db;
  }

  /**
   * Verify staff PIN and return user info without pin.
   */
  public verifyPin(pin: string): Omit<UserRecord, 'pin'> | null {
    const user = this.db.prepare(`
      SELECT id, username, name, role, pin, is_active, created_at
      FROM users
      WHERE pin = ? AND is_active = 1
    `).get(pin.trim()) as any;

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
    };
  }

  /**
   * List staff for quick selector.
   */
  public listUsers(): Omit<UserRecord, 'pin'>[] {
    const users = this.db.prepare(`
      SELECT id, username, name, role, is_active, created_at
      FROM users
      WHERE is_active = 1
      ORDER BY role ASC, name ASC
    `).all() as any[];

    return users.map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      isActive: Boolean(u.is_active),
      createdAt: u.created_at,
    }));
  }

  /**
   * Get active open shift and real-time sales summary for terminal.
   */
  public getCurrentShift(terminalId: string): {
    shift: ShiftRecord | null;
    summary: ShiftLiveSummary | null;
  } {
    const shift = this.db.prepare(`
      SELECT * FROM shifts
      WHERE terminal_id = ? AND status = 'OPEN'
      ORDER BY opened_at DESC
      LIMIT 1
    `).get(terminalId) as any;

    if (!shift) {
      return { shift: null, summary: null };
    }

    const summary = this.calculateShiftSales(shift.id, shift.opened_at, shift.starting_cash);

    return {
      shift: {
        id: shift.id,
        outletId: shift.outlet_id,
        terminalId: shift.terminal_id,
        cashierId: shift.cashier_id,
        cashierName: shift.cashier_name,
        openedAt: shift.opened_at,
        closedAt: shift.closed_at,
        status: shift.status,
        startingCash: shift.starting_cash,
        expectedCash: summary.expectedCash,
        actualCash: shift.actual_cash,
        cashDifference: shift.cash_difference,
        totalOrders: summary.totalOrders,
        totalCups: summary.totalCups,
        totalGrossSales: summary.grossSales,
        totalDiscount: summary.discount,
        totalTax: summary.tax,
        totalNetSales: summary.netSales,
        paymentSummary: {
          CASH: summary.cashSales,
          QRIS: summary.qrisSales,
          EDC: summary.edcSales,
        },
        notes: shift.notes,
        createdAt: shift.created_at,
      },
      summary,
    };
  }

  /**
   * Calculate live sales numbers for an open or closed shift.
   */
  public calculateShiftSales(
    shiftId: string,
    openedAt: string,
    startingCash: number,
    closedAt?: string
  ): ShiftLiveSummary {
    const query = closedAt
      ? `SELECT id, total_amount, subtotal, discount, tax, payment_method
         FROM orders
         WHERE payment_status = 'PAID'
           AND status != 'CANCELLED'
           AND created_at >= ?
           AND created_at <= ?`
      : `SELECT id, total_amount, subtotal, discount, tax, payment_method
         FROM orders
         WHERE payment_status = 'PAID'
           AND status != 'CANCELLED'
           AND created_at >= ?`;

    const params = closedAt ? [openedAt, closedAt] : [openedAt];
    const orders = this.db.prepare(query).all(...params) as any[];

    let grossSales = 0;
    let discount = 0;
    let tax = 0;
    let netSales = 0;
    let cashSales = 0;
    let qrisSales = 0;
    let edcSales = 0;

    const orderIds = orders.map(o => o.id);
    let totalCups = 0;

    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const cupsResult = this.db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) as totalCups
        FROM order_items
        WHERE order_id IN (${placeholders})
      `).get(...orderIds) as { totalCups: number };
      totalCups = cupsResult?.totalCups || 0;
    }

    for (const o of orders) {
      grossSales += o.subtotal || 0;
      discount += o.discount || 0;
      tax += o.tax || 0;
      netSales += o.total_amount || 0;

      const pMethod = (o.payment_method || '').toUpperCase();
      if (pMethod === 'CASH') {
        cashSales += o.total_amount;
      } else if (pMethod.includes('QRIS')) {
        qrisSales += o.total_amount;
      } else if (
        pMethod.startsWith('EDC') ||
        pMethod.includes('CARD') ||
        pMethod.includes('DEBIT') ||
        pMethod.includes('CREDIT')
      ) {
        edcSales += o.total_amount;
      } else {
        cashSales += o.total_amount;
      }
    }

    const expectedCash = startingCash + cashSales;

    return {
      totalOrders: orders.length,
      totalCups,
      grossSales,
      discount,
      tax,
      netSales,
      cashSales,
      qrisSales,
      edcSales,
      startingCash,
      expectedCash,
    };
  }

  /**
   * Open a new shift register session.
   */
  public openShift(req: OpenShiftRequest): ShiftRecord {
    // Check if open shift already exists
    const existing = this.db.prepare(`
      SELECT * FROM shifts WHERE terminal_id = ? AND status = 'OPEN'
    `).get(req.terminalId) as any;

    if (existing) {
      return {
        id: existing.id,
        outletId: existing.outlet_id,
        terminalId: existing.terminal_id,
        cashierId: existing.cashier_id,
        cashierName: existing.cashier_name,
        openedAt: existing.opened_at,
        status: 'OPEN',
        startingCash: existing.starting_cash,
        expectedCash: existing.starting_cash,
        totalOrders: 0,
        totalCups: 0,
        totalGrossSales: 0,
        totalDiscount: 0,
        totalTax: 0,
        totalNetSales: 0,
        paymentSummary: {},
        createdAt: existing.created_at,
      };
    }

    const now = new Date().toISOString();
    const shiftId = `shift_${uuidv4().slice(0, 8)}`;
    const outletId = req.outletId || getOutletEnvConfig().outletId;

    this.db.prepare(`
      INSERT INTO shifts (
        id, outlet_id, terminal_id, cashier_id, cashier_name,
        opened_at, status, starting_cash, expected_cash,
        total_orders, total_cups, total_gross_sales, total_discount,
        total_tax, total_net_sales, payment_summary_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, 0, 0, 0, 0, 0, 0, '{}', ?)
    `).run(
      shiftId,
      outletId,
      req.terminalId,
      req.cashierId,
      req.cashierName,
      now,
      req.startingCash || 0,
      req.startingCash || 0,
      now
    );

    return {
      id: shiftId,
      outletId,
      terminalId: req.terminalId,
      cashierId: req.cashierId,
      cashierName: req.cashierName,
      openedAt: now,
      status: 'OPEN',
      startingCash: req.startingCash || 0,
      expectedCash: req.startingCash || 0,
      totalOrders: 0,
      totalCups: 0,
      totalGrossSales: 0,
      totalDiscount: 0,
      totalTax: 0,
      totalNetSales: 0,
      paymentSummary: {},
      createdAt: now,
    };
  }

  /**
   * Close shift / End Of Day (Z-Report generation & Outbox event).
   */
  public closeShift(req: CloseShiftRequest): ShiftRecord {
    const shift = this.db.prepare(`
      SELECT * FROM shifts WHERE id = ?
    `).get(req.shiftId) as any;

    if (!shift) {
      throw new Error(`Shift not found: ${req.shiftId}`);
    }

    if (shift.status === 'CLOSED') {
      throw new Error(`Shift ${req.shiftId} is already closed.`);
    }

    const now = new Date().toISOString();
    const summary = this.calculateShiftSales(shift.id, shift.opened_at, shift.starting_cash, now);
    const cashDifference = req.actualCash - summary.expectedCash;
    const paymentJson = JSON.stringify({
      CASH: summary.cashSales,
      QRIS: summary.qrisSales,
      EDC: summary.edcSales,
    });

    // Update Shift record
    this.db.prepare(`
      UPDATE shifts SET
        closed_at = ?,
        status = 'CLOSED',
        expected_cash = ?,
        actual_cash = ?,
        cash_difference = ?,
        total_orders = ?,
        total_cups = ?,
        total_gross_sales = ?,
        total_discount = ?,
        total_tax = ?,
        total_net_sales = ?,
        payment_summary_json = ?,
        notes = ?
      WHERE id = ?
    `).run(
      now,
      summary.expectedCash,
      req.actualCash,
      cashDifference,
      summary.totalOrders,
      summary.totalCups,
      summary.grossSales,
      summary.discount,
      summary.tax,
      summary.netSales,
      paymentJson,
      req.notes || null,
      shift.id
    );

    // 1. Enqueue Z-Report receipt print job
    const zReportText = this.formatZReport({
      shiftId: shift.id,
      outletName: 'SAKUPOS - COFFEE',
      terminalId: shift.terminal_id,
      cashierName: req.cashierName || shift.cashier_name,
      openedAt: shift.opened_at,
      closedAt: now,
      summary,
      actualCash: req.actualCash,
      cashDifference,
      notes: req.notes,
    });

    const printJobId = uuidv4();
    this.db.prepare(`
      INSERT INTO print_jobs (
        id, order_id, job_type, label_index, total_labels,
        item_name, variant_size, modifiers_summary, payload_json,
        status, is_reprint, retry_count, created_at
      ) VALUES (?, ?, 'RECEIPT', 1, 1, 'Z-REPORT CLOSING', 'EOD', 'SUMMARY', ?, 'PENDING', 0, 0, ?)
    `).run(
      printJobId,
      shift.id,
      JSON.stringify({ zReportText, type: 'EOD_Z_REPORT', shiftId: shift.id }),
      now
    );

    return {
      id: shift.id,
      outletId: shift.outlet_id,
      terminalId: shift.terminal_id,
      cashierId: shift.cashier_id,
      cashierName: req.cashierName || shift.cashier_name,
      openedAt: shift.opened_at,
      closedAt: now,
      status: 'CLOSED',
      startingCash: shift.starting_cash,
      expectedCash: summary.expectedCash,
      actualCash: req.actualCash,
      cashDifference,
      totalOrders: summary.totalOrders,
      totalCups: summary.totalCups,
      totalGrossSales: summary.grossSales,
      totalDiscount: summary.discount,
      totalTax: summary.tax,
      totalNetSales: summary.netSales,
      paymentSummary: {
        CASH: summary.cashSales,
        QRIS: summary.qrisSales,
        EDC: summary.edcSales,
      },
      notes: req.notes,
      createdAt: shift.created_at,
    };
  }

  /**
   * Format Z-Report for ESC/POS receipt printer.
   */
  public formatZReport(data: {
    shiftId: string;
    outletName: string;
    terminalId: string;
    cashierName: string;
    openedAt: string;
    closedAt: string;
    summary: ShiftLiveSummary;
    actualCash: number;
    cashDifference: number;
    notes?: string;
  }): string {
    const s = data.summary;
    const formatRp = (num: number) => `Rp ${num.toLocaleString('id-ID')}`;

    const lines: string[] = [
      '================================',
      '        SAKUPOS - COFFEE        ',
      '       GRAB & GO COUNTER        ',
      '     END OF DAY / Z-REPORT      ',
      '================================',
      `Shift ID   : ${data.shiftId}`,
      `Terminal   : ${data.terminalId}`,
      `Cashier    : ${data.cashierName}`,
      `Buka Shift : ${new Date(data.openedAt).toLocaleString('id-ID')}`,
      `Tutup Shift: ${new Date(data.closedAt).toLocaleString('id-ID')}`,
      '--------------------------------',
      'RINGKASAN PENJUALAN',
      `Total Pesanan : ${s.totalOrders} order`,
      `Total Gelas   : ${s.totalCups} cup`,
      `Penjualan Bruto: ${formatRp(s.grossSales)}`,
      `Diskon        : ${formatRp(s.discount)}`,
      `PB1 (Pajak 10%): ${formatRp(s.tax)}`,
      `TOTAL BERSIH  : ${formatRp(s.netSales)}`,
      '--------------------------------',
      'RINCIAN METODE PEMBAYARAN',
      `Tunai (CASH)  : ${formatRp(s.cashSales)}`,
      `QRIS Dinamis  : ${formatRp(s.qrisSales)}`,
      `EDC / Kartu   : ${formatRp(s.edcSales)}`,
      '--------------------------------',
      'REKONSILIASI KAS LACI',
      `Kas Awal (Float): ${formatRp(s.startingCash)}`,
      `Penjualan Tunai : ${formatRp(s.cashSales)}`,
      `Estimasi Kas    : ${formatRp(s.expectedCash)}`,
      `Uang Fisik Kas  : ${formatRp(data.actualCash)}`,
      `Selisih (Diff)  : ${data.cashDifference >= 0 ? '+' : ''}${formatRp(data.cashDifference)}`,
      '--------------------------------',
    ];

    if (data.notes) {
      lines.push(`Catatan: ${data.notes}`);
      lines.push('--------------------------------');
    }

    lines.push('Tanda Tangan Kasir:');
    lines.push('');
    lines.push('');
    lines.push('( ............................ )');
    lines.push(`Dicetak: ${new Date().toLocaleString('id-ID')}`);
    lines.push('================================');

    return lines.join('\n');
  }
}
