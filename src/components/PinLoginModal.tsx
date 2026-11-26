// src/components/PinLoginModal.tsx
import React, { useState, useEffect } from 'react';
import { Delete, AlertCircle, Sparkles } from 'lucide-react';
import { api, type User } from '../services/api';
import { SakuPosLogo } from './SakuPosLogo';

/** PIN Kasir Lokal 5 digit. */
const LOCAL_PIN_LENGTH = 5;

interface PinLoginModalProps {
  onSuccess: (user: User) => void;
  currentCashierName?: string;
  isLockScreen?: boolean;
  /** Hanya true jika kasir menekan "Kunci" — bukan saat pertama buka app. */
  allowCancelLock?: boolean;
  onCancelLock?: () => void;
}

export const PinLoginModal: React.FC<PinLoginModalProps> = ({
  onSuccess,
  currentCashierName,
  isLockScreen = false,
  allowCancelLock = false,
  onCancelLock,
}) => {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleKeyPress = (num: string) => {
    if (pin.length < LOCAL_PIN_LENGTH) {
      const nextPin = pin + num;
      setPin(nextPin);
      setErrorMsg(null);
      if (nextPin.length === LOCAL_PIN_LENGTH) {
        verifyPin(nextPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleClear = () => {
    setPin('');
    setErrorMsg(null);
  };

  const verifyPin = async (pinToVerify = pin) => {
    if (!pinToVerify) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.loginPin(pinToVerify);
      onSuccess(res.user);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'PIN tidak valid. Silakan coba lagi.');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Escape') {
        handleClear();
      } else if (e.key === 'Enter') {
        verifyPin();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4 select-none">
      <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 overflow-hidden flex flex-col items-center p-6 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Brand Logo & Outlet Info */}
        <div className="flex flex-col items-center mb-4 text-center">
          <SakuPosLogo height={32} />
          <div className="mt-2 text-[11px] font-bold text-amber-800 tracking-wider uppercase">
            Grab & Go Counter • Terminal TERM-01
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {isLockScreen ? 'Kunci Layar Kasir Aktif' : `Masukkan PIN Kasir Lokal (${LOCAL_PIN_LENGTH} digit)`}
          </div>
        </div>

        {/* PIN Dots Indicator */}
        <div className="flex items-center justify-center gap-3 my-3">
          {Array.from({ length: LOCAL_PIN_LENGTH }, (_, idx) => idx).map(idx => (
            <div
              key={idx}
              className={`w-4 h-4 rounded-full transition-all duration-150 ${
                pin.length > idx
                  ? 'bg-amber-600 scale-110 shadow-sm'
                  : 'bg-slate-200 border-2 border-slate-300'
              }`}
            />
          ))}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="w-full mt-1 mb-2 p-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs text-center font-bold flex items-center justify-center gap-1.5">
            <AlertCircle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2.5 w-full mt-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
            <button
              key={digit}
              type="button"
              onClick={() => handleKeyPress(digit)}
              disabled={isLoading}
              className="h-14 rounded-2xl bg-slate-50 hover:bg-amber-50 active:bg-amber-100 border border-slate-200 hover:border-amber-400 text-xl font-bold text-slate-800 transition flex items-center justify-center shadow-xs cursor-pointer active:scale-95"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            disabled={isLoading || pin.length === 0}
            className="h-14 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 border border-slate-200 text-xs font-bold text-slate-600 transition flex items-center justify-center cursor-pointer active:scale-95"
          >
            CLEAR
          </button>
          <button
            type="button"
            onClick={() => handleKeyPress('0')}
            disabled={isLoading}
            className="h-14 rounded-2xl bg-slate-50 hover:bg-amber-50 active:bg-amber-100 border border-slate-200 hover:border-amber-400 text-xl font-bold text-slate-800 transition flex items-center justify-center shadow-xs cursor-pointer active:scale-95"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isLoading || pin.length === 0}
            className="h-14 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 border border-slate-200 text-slate-600 transition flex items-center justify-center cursor-pointer active:scale-95"
          >
            <Delete size={20} />
          </button>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 w-full text-center text-[11px] text-slate-500 font-medium">
          <div className="flex items-center justify-center gap-1">
            <Sparkles size={12} className="text-amber-600" />
            <span>Autentikasi 100% Lokal (SQLite) — PIN 5 digit</span>
          </div>
        </div>

        {isLockScreen && allowCancelLock && onCancelLock && (
          <button
            type="button"
            onClick={onCancelLock}
            className="mt-3 text-xs text-slate-400 hover:text-slate-600 font-medium cursor-pointer"
          >
            Kembali ke sesi {currentCashierName || 'Kasir'}
          </button>
        )}
      </div>
    </div>
  );
};
