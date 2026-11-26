// src/components/ModifierModal.tsx
import React, { useState } from 'react';
import { X, Plus, Minus, Check, Coffee } from 'lucide-react';
import type {
  Product,
  ModifierGroup,
  ModifierOption,
  SelectedModifier,
  CartItem,
} from '../services/api';

interface ModifierModalProps {
  product: Product;
  modifierGroups: ModifierGroup[];
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
}

export const ModifierModal: React.FC<ModifierModalProps> = ({
  product,
  modifierGroups,
  onClose,
  onAddToCart,
}) => {
  const [variantSize, setVariantSize] = useState<'Regular' | 'Large'>('Regular');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const applicableGroups = modifierGroups.filter((g) =>
    product.modifierGroupIds.includes(g.id),
  );

  const [selectedMap, setSelectedMap] = useState<Record<string, SelectedModifier[]>>(() => {
    const init: Record<string, SelectedModifier[]> = {};
    for (const group of applicableGroups) {
      const defaultOpt = group.options.find((o) => o.default) || (group.required ? group.options[0] : null);
      if (defaultOpt) {
        init[group.id] = [{
          groupId: group.id,
          groupName: group.name,
          optionId: defaultOpt.id,
          optionName: defaultOpt.name,
          price: defaultOpt.price,
        }];
      } else {
        init[group.id] = [];
      }
    }
    return init;
  });

  const basePrice = variantSize === 'Large' ? product.basePriceLarge : product.basePriceRegular;

  let totalModifierPrice = 0;
  for (const mods of Object.values(selectedMap)) {
    for (const m of mods) {
      totalModifierPrice += m.price;
    }
  }

  const unitPrice = basePrice + totalModifierPrice;
  const subtotal = unitPrice * quantity;

  const handleSelectOption = (group: ModifierGroup, option: ModifierOption) => {
    setSelectedMap((prev) => {
      const current = prev[group.id] || [];
      if (group.maxSelection === 1) {
        return {
          ...prev,
          [group.id]: [{
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            price: option.price,
          }],
        };
      }

      const existsIndex = current.findIndex((m) => m.optionId === option.id);
      if (existsIndex >= 0) {
        return {
          ...prev,
          [group.id]: current.filter((m) => m.optionId !== option.id),
        };
      }
      if (current.length < group.maxSelection) {
        return {
          ...prev,
          [group.id]: [...current, {
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            price: option.price,
          }],
        };
      }
      return prev;
    });
  };

  const handleAdd = () => {
    const flattenedModifiers: SelectedModifier[] = [];
    for (const mods of Object.values(selectedMap)) {
      flattenedModifiers.push(...mods);
    }

    onAddToCart({
      uid: `${product.id}-${Date.now()}-${Math.random()}`,
      productId: product.id,
      productName: product.name,
      variantSize,
      basePrice,
      modifiers: flattenedModifiers,
      unitPrice,
      quantity,
      subtotal,
      notes,
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-800 shadow-2xs">
              <Coffee size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 leading-tight">{product.name}</h2>
              <p className="text-xs text-emerald-800 font-semibold">{product.category}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 hover:text-slate-900 transition cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-2.5">
              Pilih Ukuran Gelas (Size)
            </label>
            <div className="grid grid-cols-2 gap-3.5">
              <button
                type="button"
                onClick={() => setVariantSize('Regular')}
                className={`p-4 rounded-2xl border-2 flex flex-col items-start transition cursor-pointer ${
                  variantSize === 'Regular'
                    ? 'border-emerald-600 bg-emerald-50/50 text-slate-900 shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-sm">Regular (12 oz)</span>
                  {variantSize === 'Regular' && <Check size={18} className="text-emerald-700 font-black" />}
                </div>
                <span className="text-xs text-emerald-800 mt-1 font-bold font-mono">
                  Rp {product.basePriceRegular.toLocaleString('id-ID')}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setVariantSize('Large')}
                className={`p-4 rounded-2xl border-2 flex flex-col items-start transition cursor-pointer ${
                  variantSize === 'Large'
                    ? 'border-emerald-600 bg-emerald-50/50 text-slate-900 shadow-xs'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-sm">Large (16 oz)</span>
                  {variantSize === 'Large' && <Check size={18} className="text-emerald-700 font-black" />}
                </div>
                <span className="text-xs text-emerald-800 mt-1 font-bold font-mono">
                  Rp {product.basePriceLarge.toLocaleString('id-ID')}
                </span>
              </button>
            </div>
          </div>

          {applicableGroups.map((group) => {
            const currentSelected = selectedMap[group.id] || [];
            return (
              <div key={group.id}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    {group.name}
                  </label>
                  {group.required ? (
                    <span className="text-[10px] font-bold text-emerald-800 uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Wajib</span>
                  ) : (
                    <span className="text-[10px] text-slate-400 uppercase font-medium">Opsional</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {group.options.map((opt) => {
                    const isSelected = currentSelected.some((m) => m.optionId === opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelectOption(group, opt)}
                        className={`p-3.5 rounded-xl border-2 text-left flex items-center justify-between transition cursor-pointer ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50 text-slate-900 font-semibold shadow-2xs'
                            : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-medium">{opt.name}</div>
                          {opt.price > 0 && (
                            <div className="text-[11px] text-amber-700 font-bold mt-0.5 font-mono">
                              +Rp {opt.price.toLocaleString('id-ID')}
                            </div>
                          )}
                        </div>
                        {isSelected && <Check size={16} className="text-emerald-700" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block mb-2">
              Catatan Khusus Barista
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contoh: Pisah es, extra panas, sedotan kertas..."
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white transition"
            />
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              className="w-10 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center text-slate-700 transition cursor-pointer"
            >
              <Minus size={18} />
            </button>
            <span className="font-bold text-base px-3 w-8 text-center text-slate-900">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity(quantity + 1)}
              className="w-10 h-10 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-700 transition cursor-pointer"
            >
              <Plus size={18} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleAdd}
            className="flex-1 py-4 px-6 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black text-sm flex items-center justify-between shadow-lg shadow-emerald-700/20 transition transform active:scale-98 cursor-pointer"
          >
            <span>Tambahkan ke Pesanan</span>
            <span className="text-amber-200 font-mono text-base font-bold">
              Rp {subtotal.toLocaleString('id-ID')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
