// src/components/CdsSlideFormModal.tsx
import React, { useState, useEffect } from 'react';
import {
  X,
  Upload,
  Image as ImageIcon,
  Save,
  Sparkles,
  Info,
  Check,
} from 'lucide-react';
import type { AdSlide } from '../services/cdsConfigStorage';

interface CdsSlideFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (slide: AdSlide) => void;
  editingSlide?: AdSlide | null;
}

const PRESET_IMAGES = [
  { label: 'SakuPOS Coffee (Hero)', path: '/images/sakupos_hero_coffee.png' },
  { label: 'Kopi Susu Aren', path: '/images/promo_aren.jpg' },
  { label: 'Matcha Latte Artisan', path: '/images/promo_matcha.jpg' },
  { label: 'Artisan Botanical Cooler', path: '/images/promo_cooler.jpg' },
];

export const CdsSlideFormModal: React.FC<CdsSlideFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingSlide,
}) => {
  const [image, setImage] = useState('');
  const [hasEmbeddedTypography, setHasEmbeddedTypography] = useState(false);
  const [categoryLabel, setCategoryLabel] = useState('SAKUPOS - COFFEE');
  const [topRightBadge, setTopRightBadge] = useState('FRESH\nBREW');
  const [headline, setHeadline] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [footerBadge, setFooterBadge] = useState('100% INDONESIAN ARABICA');
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (editingSlide) {
        setImage(editingSlide.image || '');
        setHasEmbeddedTypography(Boolean(editingSlide.hasEmbeddedTypography));
        setCategoryLabel(editingSlide.categoryLabel || 'SAKUPOS - COFFEE');
        setTopRightBadge(editingSlide.topRightBadge || '');
        setHeadline(editingSlide.headline || '');
        setSubtitle(editingSlide.subtitle || '');
        setFooterBadge(editingSlide.footerBadge || '100% INDONESIAN ARABICA');
      } else {
        setImage('/images/promo_aren.jpg');
        setHasEmbeddedTypography(false);
        setCategoryLabel('SAKUPOS - COFFEE');
        setTopRightBadge('SPESIAL\nPENAWARAN');
        setHeadline('Racikan Kopi\nPilihan Terbaik');
        setSubtitle('Nikmati paduan kopi Arabika Nusantara dengan bahan-bahan segar pilihan.');
        setFooterBadge('100% ARABICA PILIHAN');
      }
    }
  }, [isOpen, editingSlide]);

  if (!isOpen) return null;

  // Handle local image file upload directly via FileReader (Base64 Data URL)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('File harus berupa format gambar (JPEG, PNG, WebP).');
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setImage(dataUrl);
      }
      setIsUploading(false);
    };
    reader.onerror = () => {
      alert('Gagal membaca file gambar.');
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!image.trim()) {
      alert('URL atau file gambar slide wajib diisi');
      return;
    }

    const slideData: AdSlide = {
      id: editingSlide?.id || `slide_${Date.now()}`,
      image: image.trim(),
      hasEmbeddedTypography,
      categoryLabel: hasEmbeddedTypography ? undefined : categoryLabel.trim() || undefined,
      topRightBadge: hasEmbeddedTypography ? undefined : topRightBadge.trim() || undefined,
      headline: hasEmbeddedTypography ? undefined : headline.trim() || undefined,
      subtitle: hasEmbeddedTypography ? undefined : subtitle.trim() || undefined,
      footerBadge: hasEmbeddedTypography ? undefined : footerBadge.trim() || undefined,
    };

    onSave(slideData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-700 text-white flex items-center justify-center shadow-xs">
              <ImageIcon size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">
                {editingSlide ? 'Edit Slide Layar Customer' : 'Tambah Slide Promo Baru'}
              </h2>
              <p className="text-xs text-slate-500">
                Kustomisasi gambar banner dan teks promosi di monitor tamu
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 1. Image Selection & Upload */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Gambar Promo / Background Slide
            </label>

            {/* Preview Box */}
            <div className="relative w-full h-44 rounded-2xl bg-[#1a1c18] overflow-hidden border border-slate-200 flex items-center justify-center mb-3">
              {image ? (
                <img
                  src={image}
                  alt="Slide preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center text-slate-500 text-xs">
                  <ImageIcon size={32} className="mx-auto mb-1 opacity-50" />
                  <span>Belum ada gambar terpilih</span>
                </div>
              )}

              {/* Overlay preview if editorial */}
              {!hasEmbeddedTypography && image && (
                <div className="absolute inset-0 bg-black/40 p-4 flex flex-col justify-between pointer-events-none text-white">
                  <div className="flex justify-between items-start text-[9px] uppercase tracking-widest font-bold opacity-80">
                    <span>{categoryLabel || 'SAKUPOS - COFFEE'}</span>
                    <span className="text-right whitespace-pre-line">{topRightBadge}</span>
                  </div>
                  <div>
                    <h4 className="text-lg font-bold leading-tight drop-shadow-sm whitespace-pre-line">
                      {headline || 'Judul Promosi'}
                    </h4>
                    <p className="text-[11px] opacity-80 mt-1 line-clamp-2">{subtitle}</p>
                  </div>
                  <div className="text-[9px] uppercase tracking-widest font-bold opacity-80">
                    {footerBadge}
                  </div>
                </div>
              )}
            </div>

            {/* Presets & Upload Actions */}
            <div className="space-y-3">
              {/* Presets chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-slate-500 mr-1">Preset:</span>
                {PRESET_IMAGES.map((preset) => (
                  <button
                    key={preset.path}
                    type="button"
                    onClick={() => setImage(preset.path)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition cursor-pointer ${
                      image === preset.path
                        ? 'bg-purple-100 text-purple-900 border-purple-300 font-bold'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Upload & Direct Path Input */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                {/* Upload Button */}
                <label className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-purple-300 bg-purple-50 hover:bg-purple-100/80 text-purple-900 text-xs font-bold transition cursor-pointer">
                  <Upload size={16} />
                  <span>{isUploading ? 'Memproses...' : 'Upload Gambar dari Komputer'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                {/* Direct Path Input */}
                <input
                  type="text"
                  value={image.startsWith('data:') ? 'Gambar lokal terupload (Data URL)' : image}
                  onChange={(e) => !image.startsWith('data:') && setImage(e.target.value)}
                  placeholder="/images/promo_custom.jpg atau URL..."
                  disabled={image.startsWith('data:')}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs font-mono bg-slate-50 focus:bg-white focus:outline-none focus:border-purple-600"
                />
              </div>
            </div>
          </div>

          {/* 2. Mode Design Switcher */}
          <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={hasEmbeddedTypography}
              onChange={(e) => setHasEmbeddedTypography(e.target.checked)}
              className="w-4 h-4 text-purple-700 rounded border-slate-300 focus:ring-purple-500"
            />
            <div className="text-xs">
              <span className="font-bold text-slate-900 block">
                Gambar Full Artwork (Teks sudah menyatu di gambar)
              </span>
              <span className="text-[11px] text-slate-500">
                Centang ini jika poster gambar sudah berisi teks desain lengkap sehingga tidak perlu overlay teks tambahan.
              </span>
            </div>
          </label>

          {/* 3. Editorial Text Inputs (if not embedded artwork) */}
          {!hasEmbeddedTypography && (
            <div className="space-y-3.5 p-4 rounded-2xl bg-slate-50/70 border border-slate-200">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <Sparkles size={14} className="text-purple-700" />
                <span>Teks Overlay Editorial SakuPOS - Coffee</span>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Judul Promosi (Headline)
                </label>
                <textarea
                  rows={2}
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  placeholder="Crafted Warmth&#10;in Every Drop"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-purple-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Deskripsi / Subtitle Promosi
                </label>
                <textarea
                  rows={2}
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Rasa alami kopi Nusantara berpadu manis legit gula aren organik Jawa Barat."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-purple-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Label Kategori (Kiri Atas)
                  </label>
                  <input
                    type="text"
                    value={categoryLabel}
                    onChange={(e) => setCategoryLabel(e.target.value)}
                    placeholder="SAKUPOS - COFFEE"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-purple-600"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Footer Badge (Kiri Bawah)
                  </label>
                  <input
                    type="text"
                    value={footerBadge}
                    onChange={(e) => setFooterBadge(e.target.value)}
                    placeholder="100% INDONESIAN ARABICA"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-purple-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Badge Kanan Atas (Pisahkan baris baru)
                </label>
                <input
                  type="text"
                  value={topRightBadge}
                  onChange={(e) => setTopRightBadge(e.target.value)}
                  placeholder="FRESH&#10;BREW"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:border-purple-600"
                />
              </div>
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs transition cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-black text-xs flex items-center gap-2 shadow-xs transition cursor-pointer"
          >
            <Save size={15} />
            <span>Simpan Slide Promo</span>
          </button>
        </div>
      </div>
    </div>
  );
};
