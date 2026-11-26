// server/services/PrintQueueService.ts
import { OutletDatabase } from '../db/database.js';
import { isCupLabelDelegatedToHost } from '../config/cup-label-print.config.js';
import type { PrintJobRecord } from '../types/index.js';

export interface IPrinterAdapter {
  name: string;
  isOnline(): Promise<boolean>;
  print(job: PrintJobRecord): Promise<{ success: boolean; error?: string }>;
}

/**
 * Mock Printer Adapter for automated testing and dev without physical hardware.
 */
export class MockPrinterAdapter implements IPrinterAdapter {
  public name: string;
  public online: boolean = true;
  public printedHistory: PrintJobRecord[] = [];
  public failNextNPrints: number = 0;

  constructor(name = 'Mock-Printer') {
    this.name = name;
  }

  public async isOnline(): Promise<boolean> {
    return this.online;
  }

  public async print(job: PrintJobRecord): Promise<{ success: boolean; error?: string }> {
    if (!this.online) {
      return { success: false, error: 'Printer is offline or disconnected' };
    }

    if (this.failNextNPrints > 0) {
      this.failNextNPrints--;
      return { success: false, error: 'Simulated printer paper jam / hardware error' };
    }

    this.printedHistory.push(job);
    return { success: true };
  }

  public clearHistory(): void {
    this.printedHistory = [];
    this.failNextNPrints = 0;
    this.online = true;
  }
}

export class PrintQueueService {
  private dbInstance: OutletDatabase;
  private receiptAdapter: IPrinterAdapter;
  private cupLabelAdapter: IPrinterAdapter;
  private isProcessing = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    dbInstance?: OutletDatabase,
    receiptAdapter?: IPrinterAdapter,
    cupLabelAdapter?: IPrinterAdapter
  ) {
    this.dbInstance = dbInstance || OutletDatabase.getInstance();
    this.receiptAdapter = receiptAdapter || new MockPrinterAdapter('Receipt-Mock');
    this.cupLabelAdapter = cupLabelAdapter || new MockPrinterAdapter('Cup-Label-Mock');
  }

  private get db() {
    return this.dbInstance.db;
  }

  public getReceiptAdapter(): IPrinterAdapter {
    return this.receiptAdapter;
  }

  public getCupLabelAdapter(): IPrinterAdapter {
    return this.cupLabelAdapter;
  }

  public setCupLabelAdapter(adapter: IPrinterAdapter): void {
    this.cupLabelAdapter = adapter;
  }

  public setReceiptAdapter(adapter: IPrinterAdapter): void {
    this.receiptAdapter = adapter;
  }

  public startWorker(intervalMs = 2000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processNextBatch().catch(() => {});
    }, intervalMs);
  }

  public stopWorker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async processNextBatch(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    let processedCount = 0;
    try {
      const delegateCupToHost = isCupLabelDelegatedToHost();
      const pendingJobs = this.db.prepare(`
        SELECT * FROM print_jobs
        WHERE status IN ('PENDING', 'FAILED') AND retry_count < 5
        AND (? = 0 OR job_type != 'CUP_LABEL')
        ORDER BY created_at ASC
        LIMIT 10
      `).all(delegateCupToHost ? 1 : 0) as any[];

      for (const row of pendingJobs) {
        const job: PrintJobRecord = {
          id: row.id,
          orderId: row.order_id,
          jobType: row.job_type,
          labelIndex: row.label_index,
          totalLabels: row.total_labels,
          itemName: row.item_name,
          variantSize: row.variant_size,
          modifiersSummary: row.modifiers_summary,
          payload: JSON.parse(row.payload_json || '{}'),
          status: row.status,
          isReprint: Boolean(row.is_reprint),
          retryCount: row.retry_count,
          lastError: row.last_error,
          createdAt: row.created_at,
          printedAt: row.printed_at,
        };

        const adapter = job.jobType === 'CUP_LABEL'
          ? this.cupLabelAdapter
          : this.receiptAdapter;

        // Mark as PRINTING
        this.db.prepare(`
          UPDATE print_jobs SET status = 'PRINTING' WHERE id = ?
        `).run(job.id);

        const result = await adapter.print(job);
        const now = new Date().toISOString();

        if (result.success) {
          this.db.prepare(`
            UPDATE print_jobs
            SET status = 'COMPLETED', printed_at = ?, last_error = NULL
            WHERE id = ?
          `).run(now, job.id);
          processedCount++;
        } else {
          this.db.prepare(`
            UPDATE print_jobs
            SET status = 'FAILED', retry_count = retry_count + 1, last_error = ?
            WHERE id = ?
          `).run(result.error || 'Unknown printer failure', job.id);
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  public getPendingJobCount(): number {
    const row = this.db.prepare(`
      SELECT count(*) as count FROM print_jobs WHERE status IN ('PENDING', 'FAILED')
    `).get() as { count: number };
    return row?.count ?? 0;
  }

  public getPendingHostCupLabelJobs(limit = 5): PrintJobRecord[] {
    if (!isCupLabelDelegatedToHost()) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT * FROM print_jobs
      WHERE job_type = 'CUP_LABEL'
        AND status IN ('PENDING', 'FAILED')
        AND retry_count < 5
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((r) => this.mapPrintJobRow(r));
  }

  public completeHostCupLabelJob(
    jobId: string,
    success: boolean,
    errorMessage?: string,
  ): boolean {
    const row = this.db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row || row.job_type !== 'CUP_LABEL') {
      return false;
    }

    const now = new Date().toISOString();
    if (success) {
      this.db.prepare(`
        UPDATE print_jobs
        SET status = 'COMPLETED', printed_at = ?, last_error = NULL
        WHERE id = ?
      `).run(now, jobId);
      return true;
    }

    this.db.prepare(`
      UPDATE print_jobs
      SET status = 'FAILED', retry_count = retry_count + 1, last_error = ?
      WHERE id = ?
    `).run(errorMessage || 'Host print failed', jobId);
    return true;
  }

  private mapPrintJobRow(r: Record<string, unknown>): PrintJobRecord {
    return {
      id: String(r.id),
      orderId: String(r.order_id),
      jobType: r.job_type as PrintJobRecord['jobType'],
      labelIndex: Number(r.label_index),
      totalLabels: Number(r.total_labels),
      itemName: r.item_name as string | undefined,
      variantSize: r.variant_size as string | undefined,
      modifiersSummary: r.modifiers_summary as string | undefined,
      payload: JSON.parse(String(r.payload_json || '{}')),
      status: r.status as PrintJobRecord['status'],
      isReprint: Boolean(r.is_reprint),
      retryCount: Number(r.retry_count),
      lastError: r.last_error as string | undefined,
      createdAt: String(r.created_at),
      printedAt: r.printed_at as string | undefined,
    };
  }

  public getJobsForOrder(orderId: string): PrintJobRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM print_jobs WHERE order_id = ? ORDER BY label_index ASC, created_at ASC
    `).all(orderId) as any[];

    return rows.map((r) => this.mapPrintJobRow(r));
  }
}
