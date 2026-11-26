// server/services/OrderService.ts
import { v4 as uuidv4 } from 'uuid';
import { OutletDatabase } from '../db/database.js';
import { getOutletEnvConfig, resolveOrderTaxRate } from '../config/outlet-env.js';
import {
  buildLocalOrderNumberGlobForDate,
  formatLocalDateKey,
  formatLocalOrderNumber,
  resolveOutletTrxPrefix,
} from '../util/local-trx-code.util.js';
import type {
  CreateOrderRequest,
  OrderRecord,
  OrderItemRecord,
  OrderStatus,
  PaymentStatus,
  SelectedModifier,
  CupLabelPayload,
} from '../types/index.js';

export class OrderService {
  private dbInstance: OutletDatabase;

  constructor(dbInstance?: OutletDatabase) {
    this.dbInstance = dbInstance || OutletDatabase.getInstance();
  }

  private get db() {
    return this.dbInstance.db;
  }

  /**
   * Nomor order lokal selaras ERP: `{OUTLET_TRX_PREFIX}-{YYMMDD}-{000001}`.
   */
  public getNextOrderNumber(_outletId?: string): string {
    const now = new Date();
    const dateKey = formatLocalDateKey(now);
    const orderGlob = buildLocalOrderNumberGlobForDate(now);

    this.db.prepare(`
      INSERT INTO order_sequence (date_key, current_seq)
      VALUES (?, 0)
      ON CONFLICT(date_key) DO NOTHING
    `).run(dateKey);

    const maxExisting = this.db.prepare(`
      SELECT MAX(CAST(substr(order_number, -6) AS INTEGER)) AS max_seq
      FROM orders
      WHERE order_number GLOB ?
    `).get(orderGlob) as { max_seq: number | null } | undefined;

    const maxFromOrders = Number(maxExisting?.max_seq) || 0;

    const seqRow = this.db.prepare(`
      SELECT current_seq FROM order_sequence WHERE date_key = ?
    `).get(dateKey) as { current_seq: number } | undefined;

    const currentSeq = Number(seqRow?.current_seq) || 0;
    const nextSeq = Math.max(currentSeq, maxFromOrders) + 1;

    this.db.prepare(`
      UPDATE order_sequence SET current_seq = ? WHERE date_key = ?
    `).run(nextSeq, dateKey);

    return formatLocalOrderNumber(now, nextSeq, resolveOutletTrxPrefix());
  }

  /**
   * Create an order atomically with all line items, modifiers, print jobs, and outbox event.
   */
  public createOrder(req: CreateOrderRequest): OrderRecord {
    if (!req.items || req.items.length === 0) {
      throw new Error('Order must contain at least one item');
    }

    const orderId = uuidv4();
    const now = new Date().toISOString();
    const outletConfig = getOutletEnvConfig();
    const outletName = outletConfig.outletDisplayName;
    const outletId = req.outletId || outletConfig.outletId;

    let shiftId = req.shiftId;
    if (!shiftId) {
      const openShift = this.db.prepare(`
        SELECT id FROM shifts
        WHERE terminal_id = ? AND status = 'OPEN'
        ORDER BY opened_at DESC
        LIMIT 1
      `).get(req.terminalId) as { id?: string } | undefined;
      shiftId = openShift?.id;
    }

    // Begin atomic transaction
    this.db.exec('BEGIN IMMEDIATE');

    try {
      // 1. Generate collision-free order number within the transaction
      const orderNumber = this.getNextOrderNumber(outletId);

      // 2. Fetch and validate all products from database catalog
      let subtotal = 0;
      let totalCups = 0;
      const validatedItemsData: {
        itemRecord: OrderItemRecord;
        prod: any;
        itemInput: typeof req.items[0];
      }[] = [];

      for (const itemInput of req.items) {
        if (!Number.isInteger(itemInput.quantity) || itemInput.quantity <= 0) {
          throw new Error('Item quantity must be a positive integer');
        }
        totalCups += itemInput.quantity;

        const prod = this.db.prepare(`
          SELECT * FROM products WHERE id = ? AND is_active = 1
        `).get(itemInput.productId) as any;

        if (!prod) {
          throw new Error(`Product not found or inactive: ${itemInput.productId}`);
        }

        if (Number(prod.is_sold_out) === 1) {
          throw new Error(`Produk "${prod.name}" sedang habis (sold out).`);
        }

        if (prod.stock_qty !== null && prod.stock_qty !== undefined) {
          const currentStock = Number(prod.stock_qty);
          if (currentStock < itemInput.quantity) {
            throw new Error(
              `Stok "${prod.name}" tidak mencukupi (tersedia: ${currentStock}, diminta: ${itemInput.quantity}).`,
            );
          }
          const nextStock = currentStock - itemInput.quantity;
          const nextSoldOut = nextStock <= 0 ? 1 : 0;
          this.db
            .prepare(`UPDATE products SET stock_qty = ?, is_sold_out = ?, updated_at = ? WHERE id = ?`)
            .run(nextStock, nextSoldOut, now, prod.id);
        }

        const basePrice = itemInput.variantSize === 'Large'
          ? prod.base_price_large
          : prod.base_price_regular;

        let modifiersPrice = 0;
        const selectedMods: SelectedModifier[] = itemInput.selectedModifiers || [];

        for (const mod of selectedMods) {
          modifiersPrice += (mod.price || 0);
        }

        const unitPrice = basePrice + modifiersPrice;
        const lineSubtotal = unitPrice * itemInput.quantity;
        subtotal += lineSubtotal;

        const itemId = uuidv4();
        const itemRecord: OrderItemRecord = {
          id: itemId,
          orderId,
          productId: prod.id,
          productName: prod.name,
          variantSize: itemInput.variantSize,
          basePrice,
          modifiersPrice,
          unitPrice,
          quantity: itemInput.quantity,
          subtotal: lineSubtotal,
          notes: itemInput.notes || '',
          modifiers: selectedMods,
          cupCount: itemInput.quantity,
          createdAt: now,
        };

        validatedItemsData.push({ itemRecord, prod, itemInput });
      }

      const taxRate = resolveOrderTaxRate();
      const tax = Math.round(subtotal * taxRate);
      const discount = 0;
      const totalAmount = subtotal + tax - discount;

      // 3. Insert parent order first so foreign keys succeed
      this.db.prepare(`
        INSERT INTO orders (
          id, order_number, outlet_id, outlet_name, terminal_id,
          cashier_id, cashier_name, shift_id, customer_name, dining_option, pager_number,
          status, payment_status, payment_method, payment_ref,
          subtotal, discount, tax, total_amount, notes,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', NULL, NULL, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        orderId,
        orderNumber,
        outletId,
        outletName,
        req.terminalId,
        req.cashierId,
        req.cashierName,
        shiftId || null,
        req.customerName || 'Walk-in',
        req.diningOption || 'takeaway',
        req.pagerNumber || null,
        subtotal,
        discount,
        tax,
        totalAmount,
        req.notes || null,
        now,
        now
      );

      // 4. Insert order_items and enqueue print jobs
      let cupSequenceCounter = 1;
      const validatedItems: OrderItemRecord[] = [];

      for (const { itemRecord, prod, itemInput } of validatedItemsData) {
        this.db.prepare(`
          INSERT INTO order_items (
            id, order_id, product_id, product_name, variant_size,
            base_price, modifiers_price, unit_price, quantity, subtotal,
            notes, modifiers_json, cup_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          itemRecord.id,
          itemRecord.orderId,
          itemRecord.productId,
          itemRecord.productName,
          itemRecord.variantSize,
          itemRecord.basePrice,
          itemRecord.modifiersPrice,
          itemRecord.unitPrice,
          itemRecord.quantity,
          itemRecord.subtotal,
          itemRecord.notes || '',
          JSON.stringify(itemRecord.modifiers),
          itemRecord.cupCount,
          itemRecord.createdAt
        );

        validatedItems.push(itemRecord);

        // Enqueue 1 Cup Sticker Print Job per physical cup
        for (let q = 0; q < itemInput.quantity; q++) {
          const cupIndex = cupSequenceCounter++;
          const modSummaryList = (itemRecord.modifiers || []).map(m => m.optionName);

          const cupPayload: CupLabelPayload = {
            orderId,
            orderNumber,
            outletName,
            customerName: req.customerName || 'Walk-in',
            orderTime: now,
            pagerNumber: req.pagerNumber || undefined,
            cupIndex,
            totalCups,
            productName: prod.name,
            variantSize: itemInput.variantSize,
            modifiersSummary: modSummaryList,
            notes: itemInput.notes,
            isReprint: false,
            barcodeValue: `${orderNumber}-${cupIndex}`,
          };

          const printJobId = uuidv4();
          this.db.prepare(`
            INSERT INTO print_jobs (
              id, order_id, job_type, label_index, total_labels,
              item_name, variant_size, modifiers_summary, payload_json,
              status, is_reprint, retry_count, created_at
            ) VALUES (?, ?, 'CUP_LABEL', ?, ?, ?, ?, ?, ?, 'PENDING', 0, 0, ?)
          `).run(
            printJobId,
            orderId,
            cupIndex,
            totalCups,
            prod.name,
            itemInput.variantSize,
            modSummaryList.join(', '),
            JSON.stringify(cupPayload),
            now
          );
        }
      }

      // 5. Enqueue 1 Customer Receipt print job
      const receiptJobId = uuidv4();
      const receiptPayload = {
        orderId,
        orderNumber,
        outletName,
        terminalId: req.terminalId,
        cashierName: req.cashierName,
        customerName: req.customerName || 'Walk-in',
        pagerNumber: req.pagerNumber || undefined,
        orderTime: now,
        items: validatedItems,
        subtotal,
        tax,
        discount,
        totalAmount,
        status: 'PENDING',
      };

      this.db.prepare(`
        INSERT INTO print_jobs (
          id, order_id, job_type, label_index, total_labels,
          item_name, variant_size, modifiers_summary, payload_json,
          status, is_reprint, retry_count, created_at
        ) VALUES (?, ?, 'RECEIPT', 1, 1, 'Customer Bill Receipt', '', '', ?, 'PENDING', 0, 0, ?)
      `).run(
        receiptJobId,
        orderId,
        JSON.stringify(receiptPayload),
        now
      );

      // Commit transaction
      this.db.exec('COMMIT');

      const createdOrder: OrderRecord = {
        id: orderId,
        orderNumber,
        outletId: req.outletId,
        outletName,
        terminalId: req.terminalId,
        cashierId: req.cashierId,
        cashierName: req.cashierName,
        shiftId: req.shiftId,
        customerName: req.customerName || 'Walk-in',
        diningOption: req.diningOption || 'takeaway',
        pagerNumber: req.pagerNumber || undefined,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        subtotal,
        discount,
        tax,
        totalAmount,
        notes: req.notes,
        createdAt: now,
        updatedAt: now,
        items: validatedItems,
      };

      return createdOrder;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public getOrderById(orderId: string): OrderRecord | null {
    const orderRow = this.db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
    if (!orderRow) return null;

    const items = this.getOrderItems(orderId);
    return this.mapOrderRecord(orderRow, items);
  }

  public getOrderByNumber(orderNumber: string): OrderRecord | null {
    const orderRow = this.db.prepare(`SELECT * FROM orders WHERE order_number = ?`).get(orderNumber) as any;
    if (!orderRow) return null;

    const items = this.getOrderItems(orderRow.id);
    return this.mapOrderRecord(orderRow, items);
  }

  public getOrderItems(orderId: string): OrderItemRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC
    `).all(orderId) as any[];

    return rows.map(r => ({
      id: r.id,
      orderId: r.order_id,
      productId: r.product_id,
      productName: r.product_name,
      variantSize: r.variant_size,
      basePrice: r.base_price,
      modifiersPrice: r.modifiers_price,
      unitPrice: r.unit_price,
      quantity: r.quantity,
      subtotal: r.subtotal,
      notes: r.notes,
      modifiers: JSON.parse(r.modifiers_json || '[]'),
      cupCount: r.cup_count,
      createdAt: r.created_at,
    }));
  }

  public listOrders(limit = 50): OrderRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM orders ORDER BY created_at DESC LIMIT ?
    `).all(limit) as any[];

    return rows.map(r => {
      const items = this.getOrderItems(r.id);
      return this.mapOrderRecord(r, items);
    });
  }

  public updateOrderStatus(orderId: string, status: OrderStatus): OrderRecord {
    const allowedStatuses: OrderStatus[] = ['PENDING', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];
    if (!allowedStatuses.includes(status)) {
      throw new Error(`Invalid order status: ${status}`);
    }

    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare(`SELECT status FROM orders WHERE id = ?`).get(orderId) as
        | { status: OrderStatus }
        | undefined;
      if (!existing) {
        throw new Error(`Order not found: ${orderId}`);
      }

      if (existing.status === 'CANCELLED' && status !== 'CANCELLED') {
        throw new Error(`Cancelled order cannot transition to ${status}`);
      }

      if (existing.status !== 'CANCELLED' && status === 'CANCELLED') {
        const items = this.db
          .prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`)
          .all(orderId) as Array<{ product_id: string; quantity: number }>;

        for (const it of items) {
          const prod = this.db
            .prepare(`SELECT stock_qty FROM products WHERE id = ?`)
            .get(it.product_id) as { stock_qty: number | null } | undefined;
          if (prod && prod.stock_qty !== null && prod.stock_qty !== undefined) {
            const restored = Number(prod.stock_qty) + Number(it.quantity);
            this.db
              .prepare(`UPDATE products SET stock_qty = ?, is_sold_out = ?, updated_at = ? WHERE id = ?`)
              .run(restored, restored <= 0 ? 1 : 0, now, it.product_id);
          }
        }
      }

      this.db.prepare(`
        UPDATE orders SET status = ?, updated_at = ? WHERE id = ?
      `).run(status, now, orderId);

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const updated = this.getOrderById(orderId);
    if (!updated) throw new Error(`Order not found: ${orderId}`);
    return updated;
  }

  public updateProductStock(
    productId: string,
    stockQty: number | null,
    isSoldOut?: boolean,
  ): { id: string; stockQty: number | null; isSoldOut: boolean } {
    const prod = this.db.prepare(`SELECT id FROM products WHERE id = ?`).get(productId) as
      | { id: string }
      | undefined;
    if (!prod) {
      throw new Error(`Product not found: ${productId}`);
    }
    const normalizedStock = stockQty === null ? null : Math.max(0, Math.floor(Number(stockQty)));
    const soldOutFlag =
      isSoldOut !== undefined
        ? isSoldOut
        : normalizedStock !== null && normalizedStock <= 0;
    const now = new Date().toISOString();

    this.db
      .prepare(`UPDATE products SET stock_qty = ?, is_sold_out = ?, updated_at = ? WHERE id = ?`)
      .run(normalizedStock, soldOutFlag ? 1 : 0, now, productId);

    return { id: productId, stockQty: normalizedStock, isSoldOut: soldOutFlag };
  }

  public restockAllProducts(defaultQty = 50): number {
    const qty = Math.max(1, Math.floor(Number(defaultQty) || 50));
    const now = new Date().toISOString();
    const res = this.db
      .prepare(`UPDATE products SET stock_qty = ?, is_sold_out = 0, updated_at = ? WHERE is_active = 1`)
      .run(qty, now);
    return Number(res.changes || 0);
  }

  /**
   * Reprint cup stickers for an existing order with is_reprint = 1.
   * Does NOT alter order state or create duplicate orders!
   */
  public reprintCupLabels(orderId: string): number {
    const order = this.getOrderById(orderId);
    if (!order || !order.items) {
      throw new Error(`Order not found for reprint: ${orderId}`);
    }

    const now = new Date().toISOString();
    let totalCups = 0;
    for (const item of order.items) {
      totalCups += item.quantity;
    }

    let cupCounter = 1;
    let reprintCount = 0;

    for (const item of order.items) {
      for (let q = 0; q < item.quantity; q++) {
        const cupIndex = cupCounter++;
        const modSummaryList = item.modifiers.map(m => m.optionName);

        const cupPayload: CupLabelPayload = {
          orderId,
          orderNumber: order.orderNumber,
          outletName: order.outletName,
          customerName: order.customerName,
          orderTime: order.createdAt,
          pagerNumber: order.pagerNumber || undefined,
          cupIndex,
          totalCups,
          productName: item.productName,
          variantSize: item.variantSize,
          modifiersSummary: modSummaryList,
          notes: item.notes,
          isReprint: true, // Marked as REPRINT
          barcodeValue: `${order.orderNumber}-${cupIndex}-R`,
        };

        const printJobId = uuidv4();
        this.db.prepare(`
          INSERT INTO print_jobs (
            id, order_id, job_type, label_index, total_labels,
            item_name, variant_size, modifiers_summary, payload_json,
            status, is_reprint, retry_count, created_at
          ) VALUES (?, ?, 'CUP_LABEL', ?, ?, ?, ?, ?, ?, 'PENDING', 1, 0, ?)
        `).run(
          printJobId,
          orderId,
          cupIndex,
          totalCups,
          item.productName,
          item.variantSize,
          modSummaryList.join(', '),
          JSON.stringify(cupPayload),
          now
        );
        reprintCount++;
      }
    }

    return reprintCount;
  }

  private mapOrderRecord(row: any, items: OrderItemRecord[]): OrderRecord {
    return {
      id: row.id,
      orderNumber: row.order_number,
      outletId: row.outlet_id,
      outletName: row.outlet_name,
      terminalId: row.terminal_id,
      cashierId: row.cashier_id,
      cashierName: row.cashier_name,
      shiftId: row.shift_id,
      customerName: row.customer_name,
      diningOption: row.dining_option,
      pagerNumber: row.pager_number || undefined,
      status: row.status as OrderStatus,
      paymentStatus: row.payment_status as PaymentStatus,
      paymentMethod: row.payment_method,
      paymentRef: row.payment_ref,
      subtotal: row.subtotal,
      discount: row.discount,
      tax: row.tax,
      totalAmount: row.total_amount,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items,
    };
  }
}
