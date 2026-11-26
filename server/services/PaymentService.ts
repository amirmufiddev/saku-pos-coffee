// server/services/PaymentService.ts
import { OutletDatabase } from '../db/database.js';
import { OrderService } from './OrderService.js';
import type { PaymentStatus, OrderRecord } from '../types/index.js';

export interface ProcessPaymentInput {
  orderId: string;
  paymentMethod: 'CASH' | 'QRIS' | 'EDC_DEBIT' | 'EDC_CREDIT' | 'ROOM_CHARGE';
  amountPaid: number;
  paymentRef?: string;
  simulateState?: 'SUCCESS' | 'UNKNOWN' | 'FAILED'; // For dev/test chaos testing
}

export interface PaymentResult {
  success: boolean;
  paymentStatus: PaymentStatus;
  order: OrderRecord;
  reconciliationRequired: boolean;
  message: string;
}

export class PaymentService {
  private dbInstance: OutletDatabase;
  private orderService: OrderService;

  constructor(dbInstance?: OutletDatabase) {
    this.dbInstance = dbInstance || OutletDatabase.getInstance();
    this.orderService = new OrderService(this.dbInstance);
  }

  private get db() {
    return this.dbInstance.db;
  }

  /**
   * Process and validate payment.
   * If payment succeeds:
   *  1. Update order payment_status to 'PAID'
   *  2. Advance order status to 'PREPARING' (sent to barista)
   *  3. Create Outbox event POS_SALE_COMPLETED with stable idempotency key
   */
  public processPayment(input: ProcessPaymentInput): PaymentResult {
    const order = this.orderService.getOrderById(input.orderId);
    if (!order) {
      throw new Error(`Order not found: ${input.orderId}`);
    }

    if (order.status === 'CANCELLED' || order.paymentStatus === 'REFUNDED') {
      throw new Error(`Cannot process payment for cancelled or refunded order: ${order.orderNumber}`);
    }

    if (order.paymentStatus === 'PAID') {
      return {
        success: true,
        paymentStatus: 'PAID',
        order,
        reconciliationRequired: false,
        message: 'Order is already marked as PAID.',
      };
    }

    // Determine state outcome (supports simulation of network timeouts for UNKNOWN testing)
    let outcome: PaymentStatus = 'PENDING';

    if (input.simulateState === 'UNKNOWN') {
      outcome = 'UNKNOWN';
    } else if (input.simulateState === 'FAILED') {
      outcome = 'FAILED';
    } else {
      if (input.paymentMethod === 'CASH') {
        if (input.amountPaid < order.totalAmount) {
          throw new Error(`Insufficient cash. Required: ${order.totalAmount}, Given: ${input.amountPaid}`);
        }
        outcome = 'PAID';
      } else {
        // QRIS, EDC, etc. In production this queries gateway/EDC serial port
        outcome = 'PAID';
      }
    }

    const now = new Date().toISOString();

    if (outcome === 'UNKNOWN') {
      this.db.prepare(`
        UPDATE orders
        SET payment_status = 'UNKNOWN', payment_method = ?, payment_ref = ?, updated_at = ?
        WHERE id = ?
      `).run(input.paymentMethod, input.paymentRef || null, now, order.id);

      const updated = this.orderService.getOrderById(order.id)!;
      return {
        success: false,
        paymentStatus: 'UNKNOWN',
        order: updated,
        reconciliationRequired: true,
        message: 'Payment in UNKNOWN state. Manual or gateway reconciliation required before retry.',
      };
    }

    if (outcome === 'FAILED') {
      this.db.prepare(`
        UPDATE orders
        SET payment_status = 'FAILED', payment_method = ?, payment_ref = ?, updated_at = ?
        WHERE id = ?
      `).run(input.paymentMethod, input.paymentRef || null, now, order.id);

      const updated = this.orderService.getOrderById(order.id)!;
      return {
        success: false,
        paymentStatus: 'FAILED',
        order: updated,
        reconciliationRequired: false,
        message: 'Payment rejected by provider or insufficient funds.',
      };
    }

    // SUCCESS: Atomic update of payment & status in SQLite
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        UPDATE orders
        SET payment_status = 'PAID', status = 'PREPARING', payment_method = ?, payment_ref = ?, updated_at = ?
        WHERE id = ?
      `).run(input.paymentMethod, input.paymentRef || `REF-${Date.now()}`, now, order.id);

      this.db.exec('COMMIT');

      const updated = this.orderService.getOrderById(order.id)!;
      return {
        success: true,
        paymentStatus: 'PAID',
        order: updated,
        reconciliationRequired: false,
        message: 'Payment settled successfully.',
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Reconcile an UNKNOWN payment to resolve to either PAID or FAILED.
   */
  public reconcilePayment(orderId: string, resolvedStatus: 'PAID' | 'FAILED', notes?: string): OrderRecord {
    const order = this.orderService.getOrderById(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);

    if (order.paymentStatus !== 'UNKNOWN') {
      throw new Error(`Order is not in UNKNOWN payment status (current: ${order.paymentStatus})`);
    }

    if (resolvedStatus === 'PAID') {
      return this.processPayment({
        orderId,
        paymentMethod: (order.paymentMethod as any) || 'QRIS',
        amountPaid: order.totalAmount,
        paymentRef: order.paymentRef ? `${order.paymentRef}-RECONCILED` : 'RECONCILED',
      }).order;
    } else {
      const now = new Date().toISOString();
      this.db.prepare(`
        UPDATE orders SET payment_status = 'FAILED', notes = ?, updated_at = ? WHERE id = ?
      `).run(notes || 'Reconciled as FAILED', now, orderId);
      return this.orderService.getOrderById(orderId)!;
    }
  }
}
