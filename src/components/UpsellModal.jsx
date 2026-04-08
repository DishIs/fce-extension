import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Crown, Check, ArrowRight, Shield, Zap, Bitcoin, X } from 'lucide-react';

const PRO_BULLETS = [
  { icon: <Shield className="h-3.5 w-3.5" />, label: "Emails kept forever + 5 GB storage" },
  { icon: <Zap className="h-3.5 w-3.5" />, label: "Auto OTP extraction & verify links" },
  { icon: <Crown className="h-3.5 w-3.5" />, label: "Custom domains & private inboxes" },
  { icon: <Bitcoin className="h-3.5 w-3.5" />, label: "Pay securely with Crypto or Card" },
];

export function UpsellModal({ isOpen, onClose, featureName = "Pro Features" }) {
  if (!isOpen) return null;

  const onCta = () => {
    window.open("https://www.freecustom.email/pricing?source=extension", "_blank");
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="bg-bg border border-bbg rounded-xl shadow-2xl w-full max-w-[340px] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="p-5 border-b border-bbg relative">
            <button onClick={onClose} className="absolute right-4 top-4 text-gray-500 hover:text-fg transition-colors">
              <X size={18} />
            </button>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-lg bg-logo/10 border border-logo/20 flex items-center justify-center text-logo">
                <Crown size={22} />
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <div className="w-1 h-3 bg-logo rounded-full" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-logo font-bold">
                    Pro Feature
                  </span>
                </div>
                <h3 className="text-base font-bold text-fg leading-tight">Unlock {featureName}</h3>
              </div>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              {featureName} is available exclusively to Pro members. Try it free for 3 days — no charge until day 4.
            </p>
          </div>

          {/* Bullets */}
          <div className="flex-1 overflow-y-auto py-2">
            {PRO_BULLETS.map((bullet, idx) => (
              <div key={idx} className="flex items-center gap-3 px-5 py-2.5 hover:bg-bbg/30 transition-colors">
                <span className="text-logo/70">{bullet.icon}</span>
                <span className="text-xs text-fg/80">{bullet.label}</span>
                <Check className="ml-auto h-3.5 w-3.5 text-logo/50" />
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-5 border-t border-bbg bg-bbg/10 space-y-3">
            <button
              onClick={onCta}
              className="w-full bg-logo hover:bg-logo/90 text-white font-bold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-logo/20"
            >
              Start 3-day free trial
              <ArrowRight size={16} />
            </button>
            <button
              onClick={onClose}
              className="w-full text-center text-[10px] font-mono uppercase tracking-widest text-gray-500 hover:text-fg transition-colors"
            >
              Maybe later
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
