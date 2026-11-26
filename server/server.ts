// server/server.ts
import express, { Request, Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { OutletDatabase } from './db/database.js';
import { OrderService } from './services/OrderService.js';
import { PaymentService } from './services/PaymentService.js';
import { CupLabelService } from './services/CupLabelService.js';
import { PrintQueueService, MockPrinterAdapter } from './services/PrintQueueService.js';
import { ShiftService } from './services/ShiftService.js';
import { EdcConfigService } from './services/EdcConfigService.js';
import type { CreateOrderRequest, OrderStatus } from './types/index.js';
import { getOutletEnvConfig } from './config/outlet-env.js';
import {
  getCupLabelPrinterDisplayName,
  isCupLabelDelegatedToHost,
} from './config/cup-label-print.config.js';
import {
  ensureLocalModifierGroups,
  isLocalModifierGroupId,
  LOCAL_MODIFIER_GROUP_SORT_ORDER,
  resolveLocalModifierGroupIdsForProduct,
  resolveProductModifierGroupIds,
} from './catalog/local-modifier-groups.service.js';

export function createServer(options?: {
  dbPath?: string;
  receiptPrinter?: MockPrinterAdapter;
  cupLabelPrinter?: MockPrinterAdapter;
}) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // Initialize DB and Local Services
  const outletEnv = getOutletEnvConfig();
  const dbInstance = OutletDatabase.getInstance(options?.dbPath);
  const orderService = new OrderService(dbInstance);
  const paymentService = new PaymentService(dbInstance);
  const shiftService = new ShiftService(dbInstance);
  const edcConfigService = new EdcConfigService(dbInstance);
  const printQueueService = new PrintQueueService(
    dbInstance,
    options?.receiptPrinter,
    options?.cupLabelPrinter,
  );

  if (isCupLabelDelegatedToHost()) {
    const cupAdapter = printQueueService.getCupLabelAdapter() as MockPrinterAdapter;
    cupAdapter.name = getCupLabelPrinterDisplayName();
    cupAdapter.online = true;
  }

  // Broadcast to all active WebSocket clients (Barista KDS, Cashiers, Status displays)
  const broadcast = (event: string, data: any) => {
    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        event: 'connected',
        data: {
          serverTime: new Date().toISOString(),
          outletId: outletEnv.outletId,
          outletName: outletEnv.outletDisplayName,
        },
      }),
    );
  });

  // Start Local Print Queue Worker
  printQueueService.startWorker(2000);

  // --- Local Outlet API Routes ---

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'OK',
      mode: 'LOCAL_SQLITE',
      name: 'SakuPOS - Coffee Outlet Server',
      version: '1.0.0',
      connectedClients: wss.clients.size,
    });
  });

  // 1. Catalog API (Products & Local Modifier Groups)
  app.get('/api/catalog', (_req: Request, res: Response) => {
    try {
      ensureLocalModifierGroups(dbInstance.db);

      const products = dbInstance.db
        .prepare(`SELECT * FROM products WHERE is_active = 1 ORDER BY category ASC, name ASC`)
        .all() as any[];

      const updateMods = dbInstance.db.prepare(
        `UPDATE products SET modifier_group_ids_json = ? WHERE id = ?`,
      );
      for (const p of products) {
        let ids: string[] = [];
        try {
          const parsed = JSON.parse(String(p.modifier_group_ids_json || '[]')) as string[];
          ids = Array.isArray(parsed) ? parsed : [];
        } catch {
          ids = [];
        }
        if (ids.length === 0 || ids.some((id) => String(id).startsWith('local_mod_'))) {
          const fresh = resolveLocalModifierGroupIdsForProduct(
            String(p.category || ''),
            String(p.name || ''),
          );
          const json = JSON.stringify(fresh);
          updateMods.run(json, p.id);
          p.modifier_group_ids_json = json;
        }
      }

      const modGroups = dbInstance.db.prepare(`SELECT * FROM modifier_groups`).all() as any[];

      res.json({
        products: products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          description: p.description,
          basePriceRegular: p.base_price_regular,
          basePriceLarge: p.base_price_large,
          isSoldOut: Boolean(p.is_sold_out),
          stockQty: p.stock_qty != null ? Number(p.stock_qty) : null,
          modifierGroupIds: resolveProductModifierGroupIds(p.modifier_group_ids_json, true),
        })),
        modifierGroups: modGroups
          .filter((g) => isLocalModifierGroupId(g.id))
          .sort(
            (a, b) =>
              (LOCAL_MODIFIER_GROUP_SORT_ORDER[a.id] ?? 99) -
              (LOCAL_MODIFIER_GROUP_SORT_ORDER[b.id] ?? 99),
          )
          .map((g) => {
            const options = JSON.parse(g.options_json || '[]') as Array<{
              id: string;
              name: string;
              price: number;
            }>;
            return {
              id: g.id,
              name: g.name,
              type: g.type,
              required: Boolean(g.required),
              minSelection: g.min_selection,
              maxSelection: g.max_selection,
              options,
            };
          })
          .filter((g) => g.options.length > 0),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 1b. Local Stock Control
  app.patch('/api/catalog/products/:id/stock', (req: Request, res: Response) => {
    try {
      const productId = String(req.params.id);
      const rawStock = req.body?.stockQty;
      const stockQty = rawStock === null ? null : Number(rawStock);
      if (stockQty !== null && (!Number.isFinite(stockQty) || stockQty < 0)) {
        return res.status(400).json({ error: 'stockQty harus berupa angka >= 0 atau null' });
      }
      const isSoldOut =
        typeof req.body?.isSoldOut === 'boolean' ? req.body.isSoldOut : undefined;

      const updated = orderService.updateProductStock(productId, stockQty, isSoldOut);
      broadcast('catalog:updated', { productId, ...updated });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/catalog/restock-all', (req: Request, res: Response) => {
    try {
      const defaultQty = req.body?.defaultQty !== undefined ? Number(req.body.defaultQty) : 50;
      const updatedCount = orderService.restockAllProducts(defaultQty);
      broadcast('catalog:updated', { restocked: true, defaultQty, updatedCount });
      res.json({ success: true, updatedCount, defaultQty });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Orders List
  app.get('/api/orders', (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const orders = orderService.listOrders(limit);
      res.json(orders);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Single Order Details
  app.get('/api/orders/:id', (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id);
      const order = orderService.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      res.json(order);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Create Order Atomically
  app.post('/api/orders', (req: Request, res: Response) => {
    try {
      const input: CreateOrderRequest = req.body;
      const order = orderService.createOrder(input);

      broadcast('order:created', order);
      broadcast('catalog:updated', { orderId: order.id });
      res.status(201).json(order);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 5. Settle / Process Payment
  app.post('/api/orders/:id/pay', (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id);
      const { paymentMethod, amountPaid, paymentRef, simulateState } = req.body;
      const result = paymentService.processPayment({
        orderId,
        paymentMethod: paymentMethod || 'CASH',
        amountPaid: Number(amountPaid) || 0,
        paymentRef,
        simulateState,
      });

      broadcast('order:payment_updated', result.order);
      printQueueService.processNextBatch().catch(() => {});

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 6. Update Barista Status (PREPARING, READY, COMPLETED, CANCELLED)
  app.post('/api/orders/:id/status', (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id);
      const status = req.body.status as OrderStatus;
      const updated = orderService.updateOrderStatus(orderId, status);

      broadcast('order:status_updated', updated);
      if (status === 'CANCELLED') {
        broadcast('catalog:updated', { orderId, restored: true });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 6b. Local Payment Reconciliation for UNKNOWN payment state
  app.post('/api/orders/:id/reconcile-payment', (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id);
      const rawResolved = req.body?.resolvedStatus;
      if (rawResolved !== 'PAID' && rawResolved !== 'FAILED') {
        return res.status(400).json({ error: "resolvedStatus wajib bernilai 'PAID' atau 'FAILED'" });
      }
      const resolvedStatus = rawResolved;
      const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;

      const order = paymentService.reconcilePayment(orderId, resolvedStatus, notes);
      broadcast('order:payment_updated', order);
      if (resolvedStatus === 'PAID') {
        printQueueService.processNextBatch().catch(() => {});
      }
      res.json({
        status: order.paymentStatus,
        message:
          resolvedStatus === 'PAID'
            ? 'Pembayaran berhasil direkonsiliasi lokal sebagai PAID.'
            : 'Pembayaran ditandai FAILED secara lokal.',
        order,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 7. Reprint Cup Labels
  app.post('/api/orders/:id/reprint', (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id);
      const count = orderService.reprintCupLabels(orderId);
      printQueueService.processNextBatch().catch(() => {});

      res.json({ success: true, reprintedLabelsCount: count });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 8. Cup Labels Preview
  app.get('/api/orders/:id/cup-labels/preview', (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.id);
      const order = orderService.getOrderById(orderId);
      if (!order) return res.status(404).json({ error: 'Order not found' });

      const printJobs = printQueueService
        .getJobsForOrder(order.id)
        .filter((j) => j.jobType === 'CUP_LABEL');

      const previews = printJobs.map((job) => {
        const payload = job.payload;
        return {
          jobId: job.id,
          labelIndex: job.labelIndex,
          totalLabels: job.totalLabels,
          productName: payload.productName,
          variantSize: payload.variantSize,
          modifiersSummary: payload.modifiersSummary,
          isReprint: job.isReprint,
          status: job.status,
          htmlPreview: CupLabelService.renderHtml(payload),
          plainTextPreview: CupLabelService.renderPlainText(payload),
        };
      });

      res.json({
        orderNumber: order.orderNumber,
        totalCups: previews.length,
        labels: previews,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8b. Cup label jobs for Electron host (Windows USB spooler)
  app.get('/api/print-queue/cup-labels/pending', (_req: Request, res: Response) => {
    try {
      if (!isCupLabelDelegatedToHost()) {
        return res.json({ delegateToHost: false, jobs: [] });
      }

      const jobs = printQueueService.getPendingHostCupLabelJobs(8).map((job) => ({
        id: job.id,
        labelIndex: job.labelIndex,
        totalLabels: job.totalLabels,
        html: CupLabelService.renderHtml(job.payload),
      }));

      res.json({ delegateToHost: true, jobs });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load pending cup labels';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/print-queue/cup-labels/:id/complete', (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.id);
      const success = Boolean(req.body?.success);
      const errorMessage = typeof req.body?.error === 'string' ? req.body.error : undefined;

      const updated = printQueueService.completeHostCupLabelJob(jobId, success, errorMessage);
      if (!updated) {
        return res.status(404).json({ error: 'Print job not found' });
      }
      res.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to ack cup label print';
      res.status(400).json({ error: message });
    }
  });

  // 9. Printer Status & Print Queue
  app.get('/api/printer/status', async (_req: Request, res: Response) => {
    try {
      const receiptOnline = await printQueueService.getReceiptAdapter().isOnline();
      const cupLabelOnline = await printQueueService.getCupLabelAdapter().isOnline();
      const pendingJobs = printQueueService.getPendingJobCount();

      res.json({
        receiptPrinter: {
          name: printQueueService.getReceiptAdapter().name,
          online: receiptOnline,
        },
        cupLabelPrinter: {
          name: printQueueService.getCupLabelAdapter().name,
          online: cupLabelOnline,
        },
        pendingJobsCount: pendingJobs,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Trigger Print Queue Retry
  app.post('/api/printer/retry', async (_req: Request, res: Response) => {
    try {
      const processed = await printQueueService.processNextBatch();
      res.json({ processed });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 11. Local Printer Resilience Toggle
  app.post('/api/chaos/toggle-printer', (_req: Request, res: Response) => {
    const adapter = printQueueService.getCupLabelAdapter() as MockPrinterAdapter;
    if (adapter && typeof adapter.online !== 'undefined') {
      adapter.online = !adapter.online;
      res.json({ cupLabelPrinterOnline: adapter.online });
    } else {
      res.json({ error: 'Current adapter does not support online toggling' });
    }
  });

  // 12. Local EDC Configurations (SQLite)
  app.get('/api/edc-configurations', (_req: Request, res: Response) => {
    try {
      res.json({ items: edcConfigService.listConfigs() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/edc-configurations', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name wajib diisi' });
      const saved = edcConfigService.saveConfig({
        id: body.id ? String(body.id) : undefined,
        name,
        bank: body.bank ? String(body.bank) : null,
        connectionType: body.connectionType === 'TCP_IP' ? 'TCP_IP' : 'SERIAL',
        host: body.host ? String(body.host) : null,
        ipPis: body.ipPis ? String(body.ipPis) : null,
        ipTerminal: body.ipTerminal ? String(body.ipTerminal) : null,
        port: body.port != null ? Number(body.port) : null,
        baudRate: body.baudRate != null ? Number(body.baudRate) : 115200,
        portPath: body.portPath ? String(body.portPath) : null,
        vendorId: body.vendorId ? String(body.vendorId) : null,
        productId: body.productId ? String(body.productId) : null,
        serialNumber: body.serialNumber ? String(body.serialNumber) : null,
        manufacturer: body.manufacturer ? String(body.manufacturer) : null,
        terminalId: body.terminalId ? String(body.terminalId) : null,
        isDefault: Boolean(body.isDefault),
        isActive: body.isActive !== false,
      });
      res.status(201).json({ item: saved });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/edc-configurations/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const body = req.body as Record<string, unknown>;
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name wajib diisi' });
      const saved = edcConfigService.saveConfig({
        id,
        name,
        bank: body.bank !== undefined ? (body.bank ? String(body.bank) : null) : undefined,
        connectionType: body.connectionType === 'TCP_IP' ? 'TCP_IP' : 'SERIAL',
        host: body.host !== undefined ? (body.host ? String(body.host) : null) : undefined,
        ipPis: body.ipPis !== undefined ? (body.ipPis ? String(body.ipPis) : null) : undefined,
        ipTerminal:
          body.ipTerminal !== undefined ? (body.ipTerminal ? String(body.ipTerminal) : null) : undefined,
        port: body.port !== undefined ? (body.port != null ? Number(body.port) : null) : undefined,
        baudRate: body.baudRate != null ? Number(body.baudRate) : undefined,
        portPath:
          body.portPath !== undefined ? (body.portPath ? String(body.portPath) : null) : undefined,
        vendorId:
          body.vendorId !== undefined ? (body.vendorId ? String(body.vendorId) : null) : undefined,
        productId:
          body.productId !== undefined ? (body.productId ? String(body.productId) : null) : undefined,
        serialNumber:
          body.serialNumber !== undefined ? (body.serialNumber ? String(body.serialNumber) : null) : undefined,
        manufacturer:
          body.manufacturer !== undefined ? (body.manufacturer ? String(body.manufacturer) : null) : undefined,
        terminalId:
          body.terminalId !== undefined ? (body.terminalId ? String(body.terminalId) : null) : undefined,
        isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : undefined,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
      });
      res.json({ item: saved });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/edc-configurations/:id', (req: Request, res: Response) => {
    try {
      const deleted = edcConfigService.deleteConfig(String(req.params.id));
      if (!deleted) return res.status(404).json({ error: 'EDC configuration not found' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/edc-configurations/:id/default', (req: Request, res: Response) => {
    try {
      const item = edcConfigService.setDefault(String(req.params.id));
      res.json({ item });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post('/api/edc-configurations/:id/test-result', (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const item = edcConfigService.updateTestResult(String(req.params.id), {
        lastTestStatus: body.lastTestStatus === 'CONNECTED' ? 'CONNECTED' : 'FAILED',
        lastTestedAt: body.lastTestedAt ? String(body.lastTestedAt) : new Date().toISOString(),
        lastTestError: body.lastTestError ? String(body.lastTestError) : null,
        terminalId: body.terminalId ? String(body.terminalId) : null,
        vendorId: body.vendorId ? String(body.vendorId) : null,
        productId: body.productId ? String(body.productId) : null,
        serialNumber: body.serialNumber ? String(body.serialNumber) : null,
        manufacturer: body.manufacturer ? String(body.manufacturer) : null,
        portPath: body.portPath ? String(body.portPath) : undefined,
      });
      res.json({ item });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // 13. Local SQLite Database Status & Vacuum
  app.get('/api/db/status', (_req: Request, res: Response) => {
    try {
      const countOf = (table: string) =>
        (dbInstance.db.prepare(`SELECT count(*) as c FROM ${table}`).get() as { c: number }).c;

      res.json({
        connected: true,
        engine: 'SQLite 3 (WAL Mode)',
        dbFile: path.basename(dbInstance.dbPath),
        dbPath: dbInstance.dbPath,
        terminalId: outletEnv.terminalId,
        outletId: outletEnv.outletId,
        outletName: outletEnv.outletDisplayName,
        counts: {
          products: countOf('products'),
          modifierGroups: countOf('modifier_groups'),
          users: countOf('users'),
          edcConfigurations: countOf('edc_configurations'),
          orders: countOf('orders'),
          shifts: countOf('shifts'),
          pendingPrintJobs: (
            dbInstance.db
              .prepare(`SELECT count(*) as c FROM print_jobs WHERE status = 'PENDING'`)
              .get() as { c: number }
          ).c,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/db/vacuum', (_req: Request, res: Response) => {
    try {
      dbInstance.db.exec('VACUUM;');
      res.json({ success: true, message: 'SQLite database vacuumed and re-indexed.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 14. Staff PIN Authentication (100% Local SQLite)
  app.post('/api/auth/pin', (req: Request, res: Response) => {
    try {
      const { pin } = req.body;
      if (!pin) {
        return res.status(400).json({ error: 'PIN wajib dimasukkan' });
      }
      const pinStr = String(pin).trim();
      const user = shiftService.verifyPin(pinStr);
      if (!user) {
        return res.status(401).json({ error: 'PIN tidak sesuai. Silakan coba lagi.' });
      }

      res.json({
        user,
        authMode: 'local',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 15. List Staff Users
  app.get('/api/auth/users', (_req: Request, res: Response) => {
    try {
      const users = shiftService.listUsers();
      res.json({ users });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 16. Get Current Shift & Live Financial Summary
  app.get('/api/shifts/current', (req: Request, res: Response) => {
    try {
      const terminalId = String(req.query.terminalId || 'TERM-01');
      const data = shiftService.getCurrentShift(terminalId);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 17. Open New Shift
  app.post('/api/shifts/open', (req: Request, res: Response) => {
    try {
      const shift = shiftService.openShift(req.body);
      broadcast('shift_opened', { shift });
      res.json({ shift });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // 18. Close Shift / End Of Day (EOD)
  app.post('/api/shifts/close', (req: Request, res: Response) => {
    try {
      const shift = shiftService.closeShift(req.body);
      broadcast('shift_closed', { shift });
      res.json({ shift });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return {
    app,
    server,
    wss,
    orderService,
    paymentService,
    shiftService,
    edcConfigService,
    printQueueService,
    broadcast,
    close: () => {
      printQueueService.stopWorker();
      wss.close();
      server.close();
    },
  };
}
