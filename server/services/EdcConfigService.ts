// server/services/EdcConfigService.ts
import { v4 as uuidv4 } from 'uuid';
import { OutletDatabase } from '../db/database.js';
import type { EdcConfigurationRecord } from '../types/index.js';

export type SaveEdcConfigurationInput = Partial<EdcConfigurationRecord> & {
  name: string;
  connectionType: 'TCP_IP' | 'SERIAL';
};

export interface UpdateEdcTestResultInput {
  lastTestStatus: 'CONNECTED' | 'FAILED';
  lastTestedAt: string;
  lastTestError?: string | null;
  terminalId?: string | null;
  vendorId?: string | null;
  productId?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  portPath?: string | null;
}

export class EdcConfigService {
  private dbInstance: OutletDatabase;

  constructor(dbInstance?: OutletDatabase) {
    this.dbInstance = dbInstance || OutletDatabase.getInstance();
  }

  private get db() {
    return this.dbInstance.db;
  }

  public listConfigs(): EdcConfigurationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM edc_configurations
         WHERE is_active = 1
         ORDER BY is_default DESC, created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapRow(r));
  }

  public getConfigById(id: string): EdcConfigurationRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM edc_configurations WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public saveConfig(input: SaveEdcConfigurationInput): EdcConfigurationRecord {
    const now = new Date().toISOString();
    const id = input.id?.trim() || `edc_${uuidv4().slice(0, 8)}`;

    if (input.port !== undefined && input.port !== null) {
      if (!Number.isInteger(input.port) || input.port <= 0) {
        throw new Error('port harus berupa bilangan bulat positif');
      }
    }
    if (input.baudRate !== undefined && input.baudRate !== null) {
      if (!Number.isInteger(input.baudRate) || input.baudRate <= 0) {
        throw new Error('baudRate harus berupa bilangan bulat positif');
      }
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.getConfigById(id);
      const nextIsActive = input.isActive !== undefined ? input.isActive !== false : (existing ? existing.isActive : true);

      const otherActiveRows = this.db
        .prepare(`SELECT id FROM edc_configurations WHERE is_active = 1 AND id != ? ORDER BY created_at ASC`)
        .all(id) as Array<{ id: string }>;

      let shouldBeDefault: boolean;
      if (!nextIsActive) {
        shouldBeDefault = false;
      } else if (otherActiveRows.length === 0) {
        // Satu-satunya EDC aktif wajib menjadi default
        shouldBeDefault = true;
      } else if (input.isDefault !== undefined) {
        shouldBeDefault = Boolean(input.isDefault);
      } else {
        shouldBeDefault = existing ? existing.isDefault : false;
      }

      if (shouldBeDefault) {
        this.db.prepare(`UPDATE edc_configurations SET is_default = 0`).run();
      }

      if (existing) {
        this.db
          .prepare(
            `UPDATE edc_configurations SET
              name = ?, bank = ?, connection_type = ?, host = ?, ip_pis = ?, ip_terminal = ?,
              port = ?, baud_rate = ?, port_path = ?, vendor_id = ?, product_id = ?,
              serial_number = ?, manufacturer = ?, is_default = ?, terminal_id = ?,
              is_active = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.name.trim(),
            input.bank !== undefined ? input.bank : existing.bank,
            input.connectionType,
            input.host !== undefined ? input.host : existing.host,
            input.ipPis !== undefined ? input.ipPis : existing.ipPis,
            input.ipTerminal !== undefined ? input.ipTerminal : existing.ipTerminal,
            input.port !== undefined ? input.port : existing.port,
            input.baudRate ?? existing.baudRate ?? 115200,
            input.portPath !== undefined ? input.portPath : existing.portPath,
            input.vendorId !== undefined ? input.vendorId : existing.vendorId ?? null,
            input.productId !== undefined ? input.productId : existing.productId ?? null,
            input.serialNumber !== undefined ? input.serialNumber : existing.serialNumber ?? null,
            input.manufacturer !== undefined ? input.manufacturer : existing.manufacturer ?? null,
            shouldBeDefault ? 1 : 0,
            input.terminalId !== undefined ? input.terminalId : existing.terminalId,
            nextIsActive ? 1 : 0,
            now,
            id,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO edc_configurations (
              id, name, bank, connection_type, host, ip_pis, ip_terminal,
              port, baud_rate, port_path, vendor_id, product_id,
              serial_number, manufacturer, is_default, terminal_id,
              last_test_status, last_tested_at, last_test_error,
              is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.name.trim(),
            input.bank || null,
            input.connectionType,
            input.host || null,
            input.ipPis || null,
            input.ipTerminal || null,
            input.port ?? null,
            input.baudRate ?? 115200,
            input.portPath || null,
            input.vendorId || null,
            input.productId || null,
            input.serialNumber || null,
            input.manufacturer || null,
            shouldBeDefault ? 1 : 0,
            input.terminalId || null,
            input.lastTestStatus || null,
            input.lastTestedAt || null,
            input.lastTestError || null,
            nextIsActive ? 1 : 0,
            now,
            now,
          );
      }

      // Jaga invarian: selalu ada 1 default aktif bila ada minimal 1 EDC aktif
      const activeDefault = this.db
        .prepare(`SELECT id FROM edc_configurations WHERE is_active = 1 AND is_default = 1 LIMIT 1`)
        .get() as { id: string } | undefined;
      if (!activeDefault && otherActiveRows.length > 0) {
        this.db
          .prepare(`UPDATE edc_configurations SET is_default = 1, updated_at = ? WHERE id = ?`)
          .run(now, otherActiveRows[0].id);
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return this.getConfigById(id)!;
  }

  public setDefault(id: string): EdcConfigurationRecord {
    const existing = this.getConfigById(id);
    if (!existing) {
      throw new Error(`EDC configuration not found: ${id}`);
    }
    if (!existing.isActive) {
      throw new Error(`Cannot set inactive EDC configuration as default: ${id}`);
    }

    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`UPDATE edc_configurations SET is_default = 0`).run();
      this.db
        .prepare(`UPDATE edc_configurations SET is_default = 1, updated_at = ? WHERE id = ?`)
        .run(now, id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return this.getConfigById(id)!;
  }

  public updateTestResult(id: string, result: UpdateEdcTestResultInput): EdcConfigurationRecord {
    const existing = this.getConfigById(id);
    if (!existing) {
      throw new Error(`EDC configuration not found: ${id}`);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE edc_configurations SET
          last_test_status = ?,
          last_tested_at = ?,
          last_test_error = ?,
          terminal_id = COALESCE(?, terminal_id),
          vendor_id = ?,
          product_id = ?,
          serial_number = ?,
          manufacturer = ?,
          port_path = ?,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(
        result.lastTestStatus,
        result.lastTestedAt,
        result.lastTestError || null,
        result.terminalId || null,
        result.vendorId !== undefined ? result.vendorId : existing.vendorId ?? null,
        result.productId !== undefined ? result.productId : existing.productId ?? null,
        result.serialNumber !== undefined ? result.serialNumber : existing.serialNumber ?? null,
        result.manufacturer !== undefined ? result.manufacturer : existing.manufacturer ?? null,
        result.portPath !== undefined ? result.portPath : existing.portPath,
        now,
        id,
      );

    return this.getConfigById(id)!;
  }

  public deleteConfig(id: string): boolean {
    const existing = this.getConfigById(id);
    if (!existing) return false;

    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`DELETE FROM edc_configurations WHERE id = ?`).run(id);
      if (existing.isDefault) {
        const nextRow = this.db
          .prepare(
            `SELECT id FROM edc_configurations
             WHERE is_active = 1
             ORDER BY created_at ASC
             LIMIT 1`,
          )
          .get() as { id: string } | undefined;
        if (nextRow) {
          this.db
            .prepare(`UPDATE edc_configurations SET is_default = 1, updated_at = ? WHERE id = ?`)
            .run(now, nextRow.id);
        }
      }
      this.db.exec('COMMIT');
      return true;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private mapRow(r: Record<string, unknown>): EdcConfigurationRecord {
    return {
      id: String(r.id),
      name: String(r.name),
      bank: r.bank != null ? String(r.bank) : null,
      connectionType: (r.connection_type === 'TCP_IP' ? 'TCP_IP' : 'SERIAL'),
      host: r.host != null ? String(r.host) : null,
      ipPis: r.ip_pis != null ? String(r.ip_pis) : null,
      ipTerminal: r.ip_terminal != null ? String(r.ip_terminal) : null,
      port: r.port != null ? Number(r.port) : null,
      baudRate: Number(r.baud_rate) || 115200,
      portPath: r.port_path != null ? String(r.port_path) : null,
      vendorId: r.vendor_id != null ? String(r.vendor_id) : null,
      productId: r.product_id != null ? String(r.product_id) : null,
      serialNumber: r.serial_number != null ? String(r.serial_number) : null,
      manufacturer: r.manufacturer != null ? String(r.manufacturer) : null,
      isDefault: Boolean(r.is_default),
      terminalId: r.terminal_id != null ? String(r.terminal_id) : null,
      lastTestStatus:
        r.last_test_status === 'CONNECTED' || r.last_test_status === 'FAILED'
          ? r.last_test_status
          : null,
      lastTestedAt: r.last_tested_at != null ? String(r.last_tested_at) : null,
      lastTestError: r.last_test_error != null ? String(r.last_test_error) : null,
      isActive: r.is_active !== 0,
      createdAt: r.created_at != null ? String(r.created_at) : undefined,
      updatedAt: r.updated_at != null ? String(r.updated_at) : undefined,
    };
  }
}
