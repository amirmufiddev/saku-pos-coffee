// src/services/edcStorage.ts — penyimpanan konfigurasi EDC lokal
import type { EdcConfiguration, EdcConnectionType } from '../types/edc-config';
import { EDC_DEFAULT_SERIAL_BAUD_RATE } from '../types/edc-config';

const STORAGE_KEY = 'sakupos_edc_configs_v1';

let memoryConfigs: EdcConfiguration[] = [];

function getStoredConfigs(): EdcConfiguration[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as EdcConfiguration[];
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    // fallback to memory
  }
  return memoryConfigs;
}

function setStoredConfigs(configs: EdcConfiguration[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
    }
  } catch {
    // fallback
  }
  memoryConfigs = [...configs];
}

export const edcStorage = {
  hydrateFromServer: (configs: EdcConfiguration[]): void => {
    setStoredConfigs(Array.isArray(configs) ? configs : []);
  },

  getEdcConfigurations: (): EdcConfiguration[] => {
    return getStoredConfigs();
  },

  saveEdcConfiguration: (
    configData: Partial<EdcConfiguration> & { name: string; connectionType: EdcConnectionType },
  ): EdcConfiguration => {
    const current = getStoredConfigs();
    const existingIndex = configData.id ? current.findIndex((c) => c.id === configData.id) : -1;
    let saved: EdcConfiguration;

    const isFirst = current.length === 0;
    const shouldBeDefault = isFirst || Boolean(configData.isDefault);

    if (existingIndex !== -1) {
      saved = {
        ...current[existingIndex],
        ...configData,
        isDefault: shouldBeDefault ? true : (configData.isDefault ?? current[existingIndex].isDefault),
      };
      current[existingIndex] = saved;
    } else {
      saved = {
        id: configData.id || `EDC-${Date.now().toString(36).toUpperCase()}`,
        name: configData.name,
        bank: configData.bank || null,
        connectionType: configData.connectionType,
        host: configData.host || null,
        ipPis: configData.ipPis || null,
        ipTerminal: configData.ipTerminal || null,
        port: configData.port || null,
        baudRate: configData.baudRate || EDC_DEFAULT_SERIAL_BAUD_RATE,
        portPath: configData.portPath || null,
        vendorId: configData.vendorId || null,
        productId: configData.productId || null,
        serialNumber: configData.serialNumber || null,
        manufacturer: configData.manufacturer || null,
        isDefault: shouldBeDefault,
        terminalId: configData.terminalId || null,
        lastTestStatus: configData.lastTestStatus ?? null,
        lastTestedAt: configData.lastTestedAt ?? null,
        lastTestError: configData.lastTestError ?? null,
        isActive: configData.isActive !== false,
      };
      current.push(saved);
    }

    if (shouldBeDefault) {
      current.forEach((c) => {
        if (c.id !== saved.id) c.isDefault = false;
      });
    }

    setStoredConfigs(current);
    return saved;
  },

  updateEdcTestResult: (
    id: string,
    result: {
      lastTestStatus: 'CONNECTED' | 'FAILED';
      lastTestedAt: string;
      lastTestError?: string | null;
      terminalId?: string;
      vendorId?: string | null;
      productId?: string | null;
      serialNumber?: string | null;
      manufacturer?: string | null;
      portPath?: string | null;
    },
  ): void => {
    const current = getStoredConfigs();
    const idx = current.findIndex((c) => c.id === id);
    if (idx !== -1) {
      current[idx] = {
        ...current[idx],
        lastTestStatus: result.lastTestStatus,
        lastTestedAt: result.lastTestedAt,
        lastTestError: result.lastTestError || null,
        terminalId: result.terminalId || current[idx].terminalId,
        vendorId: result.vendorId !== undefined ? result.vendorId : current[idx].vendorId || null,
        productId: result.productId !== undefined ? result.productId : current[idx].productId || null,
        serialNumber:
          result.serialNumber !== undefined ? result.serialNumber : current[idx].serialNumber || null,
        manufacturer:
          result.manufacturer !== undefined ? result.manufacturer : current[idx].manufacturer || null,
        portPath: result.portPath || current[idx].portPath,
      };
      setStoredConfigs(current);
    }
  },

  deleteEdcConfiguration: (id: string): void => {
    const current = getStoredConfigs().filter((c) => c.id !== id);
    if (current.length > 0 && !current.some((c) => c.isDefault)) {
      current[0].isDefault = true;
    }
    setStoredConfigs(current);
  },

  setDefaultEdcConfiguration: (id: string): void => {
    const current = getStoredConfigs().map((c) => ({
      ...c,
      isDefault: c.id === id,
    }));
    setStoredConfigs(current);
  },
};
