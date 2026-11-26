// src/services/cdsConfigStorage.ts

export interface AdSlide {
  id: string;
  image: string;
  hasEmbeddedTypography?: boolean;
  categoryLabel?: string;
  topRightBadge?: string;
  headline?: string;
  subtitle?: string;
  footerBadge?: string;
}

export const DEFAULT_AD_SLIDES: AdSlide[] = [
  {
    id: 'slide_journey',
    image: '/images/sakupos_hero_coffee.png',
    categoryLabel: 'SAKUPOS - COFFEE',
    topRightBadge: 'FRESHLY\nBREWED\nEVERY CUP',
    headline: 'Good Coffee\nfor Every Moment',
    subtitle: 'Racikan kopi Nusantara pilihan, diseduh segar setiap hari untuk menemani aktivitas Anda.',
    footerBadge: '100% INDONESIAN ARABICA',
  },
  {
    id: 'slide_aren',
    image: '/images/promo_aren.jpg',
    categoryLabel: 'SAKUPOS - COFFEE',
    topRightBadge: 'SIGNATURE\nGOODNESS\nIN EVERY CUP',
    headline: 'Crafted Warmth\nin Every Drop',
    subtitle: 'Rasa autentik kopi Nusantara berpadu manis legit gula aren organik pilihan.',
    footerBadge: '100% INDONESIAN ARABICA',
  },
  {
    id: 'slide_matcha',
    image: '/images/promo_matcha.jpg',
    categoryLabel: 'SAKUPOS - COFFEE',
    topRightBadge: 'AUTHENTIC\nARTISAN\nPAIRING',
    headline: 'Pagi Hangat di\nSakuPOS Coffee',
    subtitle: 'French butter croissant hangat dipadu kelembutan matcha latte kualitas upacara.',
    footerBadge: '100% CEREMONIAL GRADE',
  },
  {
    id: 'slide_cooler',
    image: '/images/promo_cooler.jpg',
    categoryLabel: 'SAKUPOS - COFFEE',
    topRightBadge: 'SLOW CRAFT\nBOTANICAL\nSERIES',
    headline: 'Artisan Citrus &\nBotanicals',
    subtitle: 'Ekstraksi dingin 18 jam berpadu kesegaran buah dan teh pilihan penyejuk dahaga.',
    footerBadge: '100% FRESH INGREDIENTS',
  },
];

const STORAGE_KEY_SLIDES = 'sakupos_cds_slides';
const STORAGE_KEY_INTERVAL = 'sakupos_cds_interval_sec';
const DEFAULT_INTERVAL_SEC = 8;

let memorySlides: AdSlide[] = [...DEFAULT_AD_SLIDES];
let memoryIntervalSec = DEFAULT_INTERVAL_SEC;

function broadcastChange(slides: AdSlide[], intervalSec: number) {
  try {
    const channel = new BroadcastChannel('sakupos_cds');
    channel.postMessage({
      type: 'UPDATE_SLIDES',
      payload: { slides, intervalSeconds: intervalSec },
    });
  } catch {
    // fallback
  }

  const win = typeof window !== 'undefined' ? (window as any) : null;
  if (win?.electronAPI?.sendCdsMessage) {
    try {
      win.electronAPI.sendCdsMessage({
        type: 'UPDATE_SLIDES',
        payload: { slides, intervalSeconds: intervalSec },
      });
    } catch {
      // fallback
    }
  }
}

export const cdsConfigStorage = {
  getSlides: (): AdSlide[] => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY_SLIDES);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      }
    } catch {
      // fallback to memory
    }
    return memorySlides;
  },

  saveSlides: (slides: AdSlide[]): void => {
    memorySlides = [...slides];
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY_SLIDES, JSON.stringify(slides));
      }
    } catch {
      // ignore
    }
    broadcastChange(slides, cdsConfigStorage.getIntervalSeconds());
  },

  getIntervalSeconds: (): number => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(STORAGE_KEY_INTERVAL);
        if (raw) {
          const val = Number(raw);
          if (val >= 3 && val <= 60) return val;
        }
      }
    } catch {
      // fallback
    }
    return memoryIntervalSec;
  },

  saveIntervalSeconds: (sec: number): void => {
    memoryIntervalSec = sec;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY_INTERVAL, String(sec));
      }
    } catch {
      // ignore
    }
    broadcastChange(cdsConfigStorage.getSlides(), sec);
  },

  resetToDefaults: (): AdSlide[] => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(STORAGE_KEY_SLIDES);
        window.localStorage.removeItem(STORAGE_KEY_INTERVAL);
      }
    } catch {
      // ignore
    }
    memorySlides = [...DEFAULT_AD_SLIDES];
    memoryIntervalSec = DEFAULT_INTERVAL_SEC;
    broadcastChange(DEFAULT_AD_SLIDES, DEFAULT_INTERVAL_SEC);
    return DEFAULT_AD_SLIDES;
  },
};
