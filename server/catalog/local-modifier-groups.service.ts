import type { DatabaseSync } from 'node:sqlite';

/** Grup modifier lokal — sama dengan seed `feat/grab-and-go-mvp` (database.ts). */
export const MOD_SUGAR = 'mod_sugar';
export const MOD_ICE = 'mod_ice';
export const MOD_MILK = 'mod_milk';
export const MOD_SHOTS = 'mod_shots';
export const MOD_SYRUP = 'mod_syrup';

const LOCAL_GROUP_IDS = [MOD_SUGAR, MOD_ICE, MOD_MILK, MOD_SHOTS, MOD_SYRUP] as const;

const STANDARD_BEVERAGE = [MOD_SUGAR, MOD_ICE, MOD_MILK, MOD_SHOTS, MOD_SYRUP];
const NON_COFFEE_BEVERAGE = [MOD_SUGAR, MOD_ICE, MOD_MILK, MOD_SYRUP];
const AMERICANO_STYLE = [MOD_SUGAR, MOD_ICE, MOD_SHOTS];
const COLD_BREW_STYLE = [MOD_SUGAR, MOD_ICE, MOD_MILK, MOD_SYRUP];
const MINIMAL_SWEET = [MOD_SUGAR, MOD_ICE];

export const LOCAL_MODIFIER_GROUP_SORT_ORDER: Record<string, number> = {
  [MOD_SUGAR]: 1,
  [MOD_ICE]: 2,
  [MOD_MILK]: 3,
  [MOD_SHOTS]: 4,
  [MOD_SYRUP]: 5,
};

export function getLocalModifierGroupIds(): string[] {
  return [...LOCAL_GROUP_IDS];
}

export function getStandardBeverageModifierGroupIds(): string[] {
  return [...STANDARD_BEVERAGE];
}

export function isLocalModifierGroupId(id: string): boolean {
  return id.startsWith('mod_');
}

function isPastryOrFoodCategory(category: string, productName: string): boolean {
  const c = category.toLowerCase();
  const n = productName.toLowerCase();
  if (c.includes('pastry') || c.includes('bakery') || c.includes('roti') || c.includes('kue')) {
    return true;
  }
  if (c.includes('food') && !c.includes('coffee') && !n.includes('latte') && !n.includes('brew')) {
    return true;
  }
  return false;
}

/** Pemetaan grup per produk — selaras MVP grab-and-go (bukan satu set untuk semua SKU). */
export function resolveLocalModifierGroupIdsForProduct(
  category: string,
  productName: string,
): string[] {
  if (isPastryOrFoodCategory(category, productName)) {
    return [];
  }

  const n = productName.toLowerCase();
  if (n.includes('americano') || n.includes('long black')) {
    return [...AMERICANO_STYLE];
  }
  if (n.includes('cold brew')) {
    return [...COLD_BREW_STYLE];
  }
  if (
    n.includes('cascara') ||
    n.includes('tonic') ||
    (n.includes('tea') && !n.includes('latte'))
  ) {
    return [...MINIMAL_SWEET];
  }

  const c = category.toLowerCase();
  if (
    c.includes('tea') ||
    c.includes('non-coffee') ||
    c.includes('non coffee') ||
    n.includes('matcha') ||
    n.includes('chocolate')
  ) {
    return [...NON_COFFEE_BEVERAGE];
  }

  return [...STANDARD_BEVERAGE];
}

/** Seed / refresh grup modifier outlet (tidak dari ERP). */
export function ensureLocalModifierGroups(db: DatabaseSync): void {
  db.prepare(`DELETE FROM modifier_groups WHERE id LIKE 'local_mod_%'`).run();

  const insert = db.prepare(`
    INSERT INTO modifier_groups (id, name, type, required, min_selection, max_selection, options_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      required = excluded.required,
      min_selection = excluded.min_selection,
      max_selection = excluded.max_selection,
      options_json = excluded.options_json
  `);

  insert.run(
    MOD_SUGAR,
    'Sugar Level',
    'SUGAR',
    1,
    1,
    1,
    JSON.stringify([
      { id: 'sug_100', name: 'Normal Sugar (100%)', price: 0, default: true },
      { id: 'sug_50', name: 'Less Sugar (50%)', price: 0 },
      { id: 'sug_25', name: 'Slight Sugar (25%)', price: 0 },
      { id: 'sug_0', name: 'No Sugar (0%)', price: 0 },
    ]),
  );

  insert.run(
    MOD_ICE,
    'Ice Level',
    'ICE',
    1,
    1,
    1,
    JSON.stringify([
      { id: 'ice_norm', name: 'Normal Ice', price: 0, default: true },
      { id: 'ice_less', name: 'Less Ice', price: 0 },
      { id: 'ice_none', name: 'No Ice', price: 0 },
    ]),
  );

  insert.run(
    MOD_MILK,
    'Dairy & Plant Milk',
    'MILK',
    0,
    0,
    1,
    JSON.stringify([
      { id: 'milk_fresh', name: 'Fresh Milk', price: 0, default: true },
      { id: 'milk_oat', name: 'Oatly Oat Milk', price: 8000 },
      { id: 'milk_almond', name: 'Almond Milk', price: 8000 },
      { id: 'milk_soy', name: 'Soy Milk', price: 6000 },
    ]),
  );

  insert.run(
    MOD_SHOTS,
    'Espresso Shots',
    'EXTRA_SHOT',
    0,
    0,
    3,
    JSON.stringify([
      { id: 'shot_1', name: 'Extra Shot (1x)', price: 6000 },
      { id: 'shot_2', name: 'Double Extra Shot (2x)', price: 12000 },
    ]),
  );

  insert.run(
    MOD_SYRUP,
    'Flavored Syrups',
    'SYRUP',
    0,
    0,
    2,
    JSON.stringify([
      { id: 'syr_vanilla', name: 'Madagascar Vanilla', price: 5000 },
      { id: 'syr_hazelnut', name: 'Roasted Hazelnut', price: 5000 },
      { id: 'syr_caramel', name: 'Salted Caramel', price: 5000 },
    ]),
  );
}

export function resolveProductModifierGroupIds(
  storedJson: string | null | undefined,
  useLocalModifiers: boolean,
): string[] {
  if (!useLocalModifiers) {
    try {
      const parsed = JSON.parse(String(storedJson || '[]')) as string[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => {
        const s = String(id).trim();
        if (!s) return false;
        return !isLocalModifierGroupId(s) && !s.startsWith('local_mod_');
      });
    } catch {
      return [];
    }
  }

  try {
    const parsed = JSON.parse(String(storedJson || '[]')) as string[];
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter(Boolean);
    }
  } catch {
    // fall through
  }

  return getStandardBeverageModifierGroupIds();
}
