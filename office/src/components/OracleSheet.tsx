import { memo, useState, useEffect, useRef, useCallback } from "react";
import { agentColor, guessCommand } from "../lib/constants";
import { ansiToHtml, processCapture } from "../lib/ansi";
import { useFileAttach, FileInput, AttachmentChips } from "../hooks/useFileAttach";
import type { AgentState } from "../lib/types";

interface OracleSheetProps {
  agent: AgentState;
  send: (msg: object) => void;
  onClose: () => void;
  onFullscreen: () => void;
  siblings: AgentState[];
  onSelectSibling: (agent: AgentState) => void;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  busy: { color: "#fdd835", bg: "rgba(253,216,53,0.12)", label: "BUSY" },
  ready: { color: "#4caf50", bg: "rgba(76,175,80,0.12)", label: "READY" },
  idle: { color: "#666", bg: "rgba(102,102,102,0.12)", label: "IDLE" },
};

function cleanName(name: string) {
  return name.replace(/-oracle$/i, "").replace(/-/g, " ");
}

// Shared styles injected once
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    .oracle-sheet { will-change: transform; }
    .oracle-sheet-enter { animation: os-slide-up .2s ease-out both; }
    @keyframes os-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
  `;
  document.head.appendChild(s);
}

export const OracleSheet = memo(function OracleSheet({
  agent,
  send,
  onClose,
  onFullscreen,
  siblings,
  onSelectSibling,
}: OracleSheetProps) {
  const accent = agentColor(agent.name);
  const status = STATUS_CONFIG[agent.status] || STATUS_CONFIG.idle;
  const displayName = cleanName(agent.name);
  const nativeInputRef = useRef<HTMLInputElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const expandedRef = useRef(false);
  const [expanded, _setExpanded] = useState(false);
  const { uploading, attachments, inputRef: fileInputRef, pickFile, onFileChange, removeAttachment, clearAttachments, buildMessage } = useFileAttach();

  const setExpanded = useCallback((val: boolean) => {
    expandedRef.current = val;
    _setExpanded(val);
    // Use transform for GPU-accelerated position change
    const el = sheetRef.current;
    if (el) {
      const h = val ? window.innerHeight : Math.round(window.innerHeight * 0.6);
      el.style.height = h + "px";
      el.style.borderRadius = val ? "0" : "16px 16px 0 0";
    }
  }, []);

  // Inject CSS once
  useEffect(injectStyles, []);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ─── Swipe gesture ───
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);
  const isDragging = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    // Only handle swipe on the drag handle area (first 40px)
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touchY = e.touches[0].clientY;
    const relY = touchY - rect.top;
    if (relY > 50) return; // Only swipe from top 50px of sheet
    touchStartY.current = touchY;
    touchStartTime.current = Date.now();
    isDragging.current = true;
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    const dt = Date.now() - touchStartTime.current;
    const velocity = Math.abs(dy) / Math.max(1, dt);

    // Fast swipe or long drag
    if (dy < -50 || (dy < -20 && velocity > 0.3)) {
      // Swipe up → expand
      setExpanded(true);
    } else if (dy > 80 || (dy > 30 && velocity > 0.4)) {
      // Swipe down → minimize or close
      if (expandedRef.current) {
        setExpanded(false);
      } else {
        onClose();
      }
    }
  }, [setExpanded, onClose]);

  // ─── Terminal capture (throttled) ───
  const contentRef = useRef("");
  const termHtmlRef = useRef("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/capture?target=${encodeURIComponent(agent.target)}`);
        const data = await res.json();
        if (active && data.content !== contentRef.current) {
          contentRef.current = data.content || "";
          const html = ansiToHtml(processCapture(contentRef.current));
          termHtmlRef.current = html;
          const el = termRef.current;
          if (el) {
            el.innerHTML = html;
            requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
          }
        }
      } catch {}
      if (active) timer = setTimeout(poll, 1200); // Slower poll for mobile perf
    }
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [agent.target]);

  // ─── Send command (reads from native input, no React state) ───
  const handleSend = useCallback(() => {
    const input = nativeInputRef.current;
    if (!input) return;
    const val = input.value;
    const msg = buildMessage(val);
    if (msg) {
      send({ type: "send", target: agent.target, text: msg + "\r" });
    } else {
      send({ type: "send", target: agent.target, text: "\r" });
    }
    input.value = "";
    clearAttachments();
    input.focus();
  }, [agent.target, send, buildMessage, clearAttachments]);

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  // Quick command — no re-render needed
  const sendCmd = useCallback((text: string) => {
    send({ type: "send", target: agent.target, text });
  }, [agent.target, send]);

  const initHeight = Math.round(window.innerHeight * 0.6);

  return (
    <div className="fixed inset-0 z-50" style={{ touchAction: "none" }} onClick={onClose}>
      {/* Backdrop — no blur for perf */}
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onTouchMove={(e) => e.preventDefault()} />

      {/* Bottom sheet */}
      <div
        ref={sheetRef}
        className="oracle-sheet oracle-sheet-enter absolute bottom-0 left-0 right-0 border-t flex flex-col overflow-hidden"
        style={{
          background: "#0a0a14",
          borderColor: `${accent}30`,
          height: initHeight,
          borderRadius: "16px 16px 0 0",
          overscrollBehavior: "contain",
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-1 flex-shrink-0" style={{ touchAction: "none" }}>
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${accent}15` }}>
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold text-white"
            style={{ background: accent }}
          >
            {displayName.substring(0, 2).toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-base font-bold truncate" style={{ color: accent }}>{displayName}</div>
            <div className="text-[10px] text-white/40 font-mono truncate">{agent.target}</div>
          </div>

          <div
            className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold"
            style={{ background: status.bg, color: status.color }}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: status.color }} />
            {status.label}
          </div>

          <button
            onClick={() => setExpanded(!expandedRef.current)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white/40 active:scale-90 text-sm"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            {expanded ? "⌄" : "⌃"}
          </button>

          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-white/50 active:scale-90 text-lg"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            ✕
          </button>
        </div>

        {/* Preview */}
        {agent.preview && (
          <div className="mx-3 mt-1.5 px-3 py-2 rounded-lg text-[11px] font-mono text-white/50 leading-relaxed flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.02)" }}
          >
            {agent.preview.slice(0, 150)}
          </div>
        )}

        {/* Terminal */}
        <div className="mx-3 mt-1.5 flex-1 min-h-0 rounded-lg overflow-hidden flex flex-col"
          style={{ background: "#08080c" }}
        >
          <div className="flex items-center px-3 py-1 border-b border-white/[0.03] flex-shrink-0">
            <span className="text-[8px] text-white/25 tracking-widest uppercase font-mono">Terminal</span>
            <span className="w-1.5 h-1.5 rounded-full ml-auto" style={{ background: "#4caf50" }} />
            <button onClick={onFullscreen} className="ml-2 text-[9px] text-white/30 font-mono active:text-white/60">⛶</button>
          </div>
          <div
            ref={termRef}
            className="flex-1 overflow-y-auto px-2 py-1 font-mono text-[9px] leading-[1.3] text-[#cdd6f4]"
            style={{ wordBreak: "break-word", whiteSpace: "pre-wrap", overscrollBehavior: "contain", touchAction: "pan-y" }}
          />
        </div>

        {/* Attachment chips */}
        {(attachments.length > 0 || uploading) && (
          <div className="px-3 py-1 flex-shrink-0" style={{ background: "#0e0e18" }}>
            <AttachmentChips attachments={attachments} onRemove={removeAttachment} uploading={uploading} />
          </div>
        )}

        {/* Talk input — uncontrolled for zero input lag */}
        <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0" style={{ background: "#0e0e18", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <FileInput inputRef={fileInputRef} onChange={onFileChange} />
          <button
            onClick={pickFile}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg active:scale-90"
            style={{ background: "rgba(255,255,255,0.06)", color: uploading ? "#22d3ee" : "rgba(255,255,255,0.4)" }}
            title="Attach file"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <input
            ref={nativeInputRef}
            type="text"
            defaultValue=""
            onKeyDown={handleInputKeyDown}
            className="flex-1 bg-transparent text-white/90 outline-none font-mono text-sm"
            style={{ caretColor: "#22d3ee" }}
            inputMode="text"
            enterKeyHint="send"
            spellCheck={false}
            autoComplete="off"
            placeholder="talk to oracle..."
          />
          <button
            onClick={handleSend}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-cyan-500 text-black text-xs font-bold active:bg-cyan-600"
          >
            SEND
          </button>
        </div>

        {/* Quick commands */}
        <div className="flex items-center gap-1 px-3 py-1.5 flex-shrink-0 overflow-x-auto" style={{ background: "#0a0a12", borderTop: "1px solid rgba(255,255,255,0.03)", touchAction: "pan-x" }}>
          {[
            { label: "y", text: "y\r", color: "#22C55E" },
            { label: "n", text: "n\r", color: "#ef5350" },
            { label: "↑", text: "\x1b[A", color: "#64748B" },
            { label: "↓", text: "\x1b[B", color: "#64748B" },
            { label: "↵", text: "\r", color: "#64748B" },
            { label: "/recap", text: "/recap\r", color: "#fbbf24" },
            { label: "^C", text: "\x03", color: "#ef5350" },
          ].map(cmd => (
            <button
              key={cmd.label}
              onClick={() => sendCmd(cmd.text)}
              className="shrink-0 px-2.5 py-1 rounded text-[10px] font-mono active:scale-90"
              style={{ background: `${cmd.color}12`, color: cmd.color, border: `1px solid ${cmd.color}20` }}
            >
              {cmd.label}
            </button>
          ))}
          <div className="w-px h-4 bg-white/[0.05] mx-0.5 shrink-0" />
          <button onClick={() => sendCmd(guessCommand(agent.name))} className="shrink-0 px-2.5 py-1 rounded text-[10px] font-mono active:scale-90" style={{ background: "rgba(76,175,80,0.1)", color: "#4caf50" }}>Wake</button>
          <button onClick={() => send({ type: "sleep", target: agent.target })} className="shrink-0 px-2.5 py-1 rounded text-[10px] font-mono active:scale-90" style={{ background: "rgba(100,100,100,0.1)", color: "#888" }}>Sleep</button>
          <button onClick={() => { if (confirm(`Restart ${cleanName(agent.name)}?`)) send({ type: "restart", target: agent.target }); }} className="shrink-0 px-2.5 py-1 rounded text-[10px] font-mono active:scale-90" style={{ background: "rgba(255,152,0,0.1)", color: "#ff9800", border: "1px solid rgba(255,152,0,0.2)" }}>Restart</button>
        </div>

        {/* Siblings */}
        {siblings.length > 1 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 flex-shrink-0 overflow-x-auto" style={{ background: "#08080e", borderTop: "1px solid rgba(255,255,255,0.03)", touchAction: "pan-x" }}>
            <span className="text-[8px] uppercase tracking-wider text-white/20 shrink-0">Room:</span>
            {siblings.filter(s => s.target !== agent.target).map((s) => {
              const sColor = agentColor(s.name);
              const sStatus = STATUS_CONFIG[s.status] || STATUS_CONFIG.idle;
              return (
                <button
                  key={s.target}
                  onClick={() => onSelectSibling(s)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap active:scale-95 shrink-0"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: sStatus.color }} />
                  <span style={{ color: sColor }}>{cleanName(s.name)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
