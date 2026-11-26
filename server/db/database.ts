// server/db/database.ts
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_SQL } from './schema.js';
import { ensureLocalModifierGroups } from '../catalog/local-modifier-groups.service.js';
import { seedFullLocalDatabase } from './seed.js';

export interface OutletDatabaseOptions {
  skipAutoSeed?: boolean;
  seedTransactions?: boolean;
}

export class OutletDatabase {
  private static instance: OutletDatabase | null = null;
  public db: DatabaseSync;
  public dbPath: string;

  constructor(customPath?: string, options?: OutletDatabaseOptions) {
    if (customPath) {
      this.dbPath = customPath;
    } else if (process.env.SQLITE_DB_PATH) {
      this.dbPath = process.env.SQLITE_DB_PATH;
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } else {
      const baseDir = process.env.DATA_DIR || process.cwd();
      const dataDir = path.resolve(baseDir, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.dbPath = path.join(dataDir, 'outlet_pos.sqlite');
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();

    if (!options?.skipAutoSeed) {
      ensureLocalModifierGroups(this.db);
      seedFullLocalDatabase(this.db, {
        includeTransactions: options?.seedTransactions !== false,
      });
      this.migrateLocalPinsToFiveDigits();
    }
  }

  /** DB lama: PIN demo 4 digit -> 5 digit. */
  private migrateLocalPinsToFiveDigits(): void {
    const updates: Array<[string, string]> = [
      ['1234', '12345'],
      ['2026', '20261'],
      ['8888', '88888'],
    ];
    const stmt = this.db.prepare(`UPDATE users SET pin = ? WHERE pin = ?`);
    for (const [from, to] of updates) {
      try {
        stmt.run(to, from);
      } catch {
        // ignore
      }
    }
  }

  public static getInstance(customPath?: string, options?: OutletDatabaseOptions): OutletDatabase {
    if (!OutletDatabase.instance) {
      OutletDatabase.instance = new OutletDatabase(customPath, options);
    }
    return OutletDatabase.instance;
  }

  public static resetInstance(): void {
    if (OutletDatabase.instance) {
      try {
        OutletDatabase.instance.db.close();
      } catch {
        // ignore
      }
      OutletDatabase.instance = null;
    }
  }

  private initSchema(): void {
    this.db.exec(SCHEMA_SQL);
    // Bersihkan tabel outbox legacy bila membuka DB lama
    try {
      this.db.exec('DROP TABLE IF EXISTS outbox_events;');
    } catch {
      // ignore
    }
    const migrations = [
      'ALTER TABLE orders ADD COLUMN pager_number TEXT;',
      'ALTER TABLE products ADD COLUMN stock_qty INTEGER;',
    ];
    for (const sql of migrations) {
      try {
        this.db.exec(sql);
      } catch {
        // column exists
      }
    }
  }
}
