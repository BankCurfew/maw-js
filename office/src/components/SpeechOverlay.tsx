import { memo, useState, useRef, useEffect, useCallback } from "react";
import { roomStyle } from "../lib/constants";

interface SpeechOverlayProps {
  target: string;
  agentName?: string;
  agentSession?: string;
  send: (msg: object) => void;
  onClose: () => void;
}

export const SpeechOverlay = memo(function SpeechOverlay({
  target, agentName, agentSession, send, onClose,
}: SpeechOverlayProps) {
  const rs = agentSession ? roomStyle(agentSession) : { accent: "#fbbf24" };
  const displayName = agentName?.replace(/-oracle$/, "").replace(/-/g, " ") || target;
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus → keyboard opens with dictation mic
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    send({ type: "send", target, text: text.trim() });
    setTimeout(() => send({ type: "send", target, text: "\r" }), 50);
    setText("");
    setSent(true);
    setTimeout(() => onClose(), 800);
  }, [text, target, send, onClose]);

  if (sent) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center" style={{ background: "rgba(0,0,0,0.9)" }}>
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#22C55E25" }}>
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <span className="mt-3 text-[14px] font-mono" style={{ color: "#22C55E" }}>Sent to {displayName}</span>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "rgba(0,0,0,0.92)" }}
    >
      {/* Top: close + agent info */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <button
          className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer active:scale-90"
          style={{ background: "rgba(255,255,255,0.08)" }}
          onClick={onClose}
        >
          <svg width={18} height={18} viewBox="0 0 16 16" fill="none" stroke="#999" strokeWidth={2} strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
        <div className="w-3.5 h-3.5 rounded-full" style={{ background: rs.accent, boxShadow: `0 0 10px ${rs.accent}` }} />
        <span className="text-[17px] font-semibold" style={{ color: rs.accent }}>{displayName}</span>
      </div>

      {/* Center: spacer that pushes input down for thumb reach */}
      <div className="flex-1" onClick={onClose} />

      {/* Bottom: input */}
      <div className="px-4 pb-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom, 16px), 16px)" }}>
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSend(); if (e.key === "Escape") onClose(); }}
            placeholder={`Talk to ${displayName}...`}
            className="flex-1 px-5 py-4 rounded-2xl text-[16px] text-white outline-none placeholder:text-white/25 [&::-webkit-search-cancel-button]:hidden [&::-webkit-clear-button]:hidden [&::-ms-clear]:hidden"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: `1px solid ${rs.accent}25`,
              WebkitAppearance: "none" as const,
            }}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="off"
          />
          <button
            className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 cursor-pointer transition-all active:scale-90"
            style={{
              background: text.trim() ? rs.accent : `${rs.accent}20`,
              boxShadow: text.trim() ? `0 0 16px ${rs.accent}60` : "none",
            }}
            onClick={handleSend}
          >
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
              stroke={text.trim() ? "#000" : `${rs.accent}50`}
              strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});
