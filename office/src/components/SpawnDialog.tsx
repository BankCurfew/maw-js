import { useState, useRef, useEffect } from "react";

interface SpawnDialogProps {
  sessions: string[];
  defaultSession: string;
  send: (msg: object) => void;
  onClose: () => void;
}

export function SpawnDialog({ sessions, defaultSession, send, onClose }: SpawnDialogProps) {
  const [session, setSession] = useState(defaultSession);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("claude");
  const [cwd, setCwd] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSpawn = () => {
    if (!name.trim()) return;
    send({
      type: "spawn",
      session,
      name: name.trim(),
      command: command || undefined,
      cwd: cwd.trim() || undefined,
    });
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0" style={{ zIndex: 50, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)" }} onClick={onClose} />
      {/* Dialog */}
      <div className="fixed" style={{
        zIndex: 51,
        left: "50%", top: "50%", transform: "translate(-50%, -50%)",
        width: 380, background: "#16161e", borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.1)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div className="px-6 py-5 border-b border-white/[0.06]">
          <h2 className="text-base font-bold text-white/90 tracking-wide">Spawn Agent</h2>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5">
          {/* Session */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider">Session</span>
            <select value={session} onChange={e => setSession(e.target.value)}
              className="px-3 py-2.5 rounded-lg text-[14px] text-white outline-none"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", WebkitAppearance: "none" as const }}>
              {sessions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {/* Name */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider">Window Name</span>
            <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSpawn(); if (e.key === "Escape") onClose(); }}
              placeholder="e.g. claude-zeta"
              className="px-3 py-2.5 rounded-lg text-[14px] text-white outline-none placeholder:text-white/20 [&::-webkit-search-cancel-button]:hidden [&::-webkit-clear-button]:hidden [&::-ms-clear]:hidden"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", WebkitAppearance: "none" as const }}
              autoComplete="off" autoCorrect="off" />
          </label>
          {/* Command */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider">Command</span>
            <div className="flex gap-2">
              {["claude", "codex", ""].map(c => (
                <button key={c} onClick={() => setCommand(c)}
                  className="px-3 py-2 rounded-lg text-[12px] font-mono cursor-pointer transition-colors"
                  style={{
                    background: command === c ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.04)",
                    color: command === c ? "#22c55e" : "#94A3B8",
                    border: command === c ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.06)",
                  }}>
                  {c || "shell"}
                </button>
              ))}
            </div>
          </label>
          {/* CWD */}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono text-white/40 uppercase tracking-wider">Working Dir <span className="text-white/20">(optional)</span></span>
            <input type="text" value={cwd} onChange={e => setCwd(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSpawn(); if (e.key === "Escape") onClose(); }}
              placeholder="/path/to/project"
              className="px-3 py-2.5 rounded-lg text-[14px] text-white outline-none placeholder:text-white/20 [&::-webkit-search-cancel-button]:hidden [&::-webkit-clear-button]:hidden [&::-ms-clear]:hidden"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", WebkitAppearance: "none" as const }}
              autoComplete="off" autoCorrect="off" />
          </label>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/[0.06]">
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-[13px] font-mono cursor-pointer transition-colors"
            style={{ color: "#94A3B8", background: "rgba(255,255,255,0.04)" }}>
            Cancel
          </button>
          <button onClick={handleSpawn} disabled={!name.trim()}
            className="px-5 py-2.5 rounded-lg text-[13px] font-mono font-bold cursor-pointer transition-all active:scale-95"
            style={{
              background: name.trim() ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.04)",
              color: name.trim() ? "#22c55e" : "#64748B",
              border: name.trim() ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.06)",
            }}>
            Spawn
          </button>
        </div>
      </div>
    </>
  );
}
