import { memo, useState, useEffect, useCallback } from "react";
import { useDevice } from "../hooks/useDevice";

// 8 emotion states — Designer will provide SVG specs per state
export type BoBEmotion =
  | "neutral"    // default resting state
  | "curious"    // wide eyes — new activity detected
  | "thinking"   // squinted — oracles processing
  | "happy"      // curved/smiling — tasks completed
  | "alert"      // sharp/focused — errors or urgent items
  | "tired"      // droopy — late night / low activity
  | "excited"    // sparkle — milestone reached
  | "worried";   // slight shake — blockers detected

interface EmotionConfig {
  pupilScale: number;    // 0.3–1.0 (small–large)
  lidTop: number;        // 0–40 (pixels drooped from top)
  lidBottom: number;     // 0–30 (pixels raised from bottom)
  irisY: number;         // vertical offset (-10 to 10)
  highlight: boolean;    // sparkle in eye
  brow: number;          // -15 to 15 (angle degrees)
  color: string;         // iris glow color
}

const EMOTIONS: Record<BoBEmotion, EmotionConfig> = {
  neutral:  { pupilScale: 0.6, lidTop: 0,  lidBottom: 0,  irisY: 0,   highlight: false, brow: 0,   color: "#60a5fa" },
  curious:  { pupilScale: 0.9, lidTop: 0,  lidBottom: 0,  irisY: -3,  highlight: true,  brow: -10, color: "#60a5fa" },
  thinking: { pupilScale: 0.5, lidTop: 15, lidBottom: 10, irisY: 5,   highlight: false, brow: 5,   color: "#818cf8" },
  happy:    { pupilScale: 0.7, lidTop: 0,  lidBottom: 20, irisY: -2,  highlight: true,  brow: -5,  color: "#34d399" },
  alert:    { pupilScale: 0.4, lidTop: 0,  lidBottom: 0,  irisY: 0,   highlight: false, brow: -15, color: "#f87171" },
  tired:    { pupilScale: 0.5, lidTop: 25, lidBottom: 5,  irisY: 8,   highlight: false, brow: 10,  color: "#94a3b8" },
  excited:  { pupilScale: 1.0, lidTop: 0,  lidBottom: 0,  irisY: -5,  highlight: true,  brow: -12, color: "#fbbf24" },
  worried:  { pupilScale: 0.55,lidTop: 5,  lidBottom: 0,  irisY: 3,   highlight: false, brow: 12,  color: "#fb923c" },
};

function Eye({ emotion, side }: { emotion: BoBEmotion; side: "left" | "right" }) {
  const cfg = EMOTIONS[emotion];
  const eyeSize = "min(35vw, 35vh)";
  const mirror = side === "right" ? -1 : 1;

  return (
    <div
      className="relative rounded-full overflow-hidden transition-all duration-700 ease-in-out"
      style={{
        width: eyeSize,
        height: eyeSize,
        background: "radial-gradient(ellipse at 40% 40%, #1e293b 0%, #0f172a 70%, #020617 100%)",
        border: `3px solid ${cfg.color}33`,
        boxShadow: `0 0 40px ${cfg.color}22, inset 0 0 60px ${cfg.color}11`,
      }}
    >
      {/* Top eyelid */}
      <div
        className="absolute top-0 left-0 right-0 z-20 transition-all duration-500"
        style={{
          height: `${cfg.lidTop}%`,
          background: "#020617",
          borderRadius: "0 0 50% 50%",
        }}
      />
      {/* Bottom eyelid */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 transition-all duration-500"
        style={{
          height: `${cfg.lidBottom}%`,
          background: "#020617",
          borderRadius: "50% 50% 0 0",
        }}
      />
      {/* Iris */}
      <div
        className="absolute inset-0 flex items-center justify-center z-10 transition-all duration-500"
        style={{ transform: `translateY(${cfg.irisY}px)` }}
      >
        <div
          className="rounded-full transition-all duration-500"
          style={{
            width: `${cfg.pupilScale * 55}%`,
            height: `${cfg.pupilScale * 55}%`,
            background: `radial-gradient(circle at 40% 35%, ${cfg.color} 0%, ${cfg.color}88 40%, ${cfg.color}33 70%, transparent 100%)`,
            boxShadow: `0 0 30px ${cfg.color}66`,
          }}
        >
          {/* Pupil */}
          <div
            className="absolute inset-0 m-auto rounded-full bg-black"
            style={{
              width: "40%",
              height: "40%",
            }}
          />
          {/* Highlight */}
          {cfg.highlight && (
            <div
              className="absolute rounded-full bg-white/80 animate-pulse"
              style={{
                width: "15%",
                height: "15%",
                top: "20%",
                right: "25%",
              }}
            />
          )}
        </div>
      </div>
      {/* Brow (subtle arc above eye) */}
      <div
        className="absolute -top-2 left-[10%] right-[10%] h-1 rounded-full z-30 transition-all duration-500"
        style={{
          background: `${cfg.color}44`,
          transform: `rotate(${cfg.brow * mirror}deg)`,
        }}
      />
    </div>
  );
}

// SSE hook for real-time emotion state from server
function useBoBState() {
  const [emotion, setEmotion] = useState<BoBEmotion>("neutral");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/bob/state");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.emotion) setEmotion(data.emotion);
        if (data.message !== undefined) setMessage(data.message);
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      // Fallback: cycle through idle emotions
      setEmotion("neutral");
    };
    return () => es.close();
  }, []);

  return { emotion, message };
}

export const BoBFaceView = memo(function BoBFaceView() {
  const device = useDevice();
  const { emotion, message } = useBoBState();
  const [manualEmotion, setManualEmotion] = useState<BoBEmotion | null>(null);
  const activeEmotion = manualEmotion || emotion;

  // Portrait mode hint
  if (!device.isLandscape && (device.isMobile || device.isTablet)) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#020617] text-slate-500">
        <div className="text-center space-y-4">
          <div className="text-6xl">📱↔️</div>
          <p className="text-lg">Rotate to landscape to see BoB</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center h-screen select-none"
      style={{ background: "#020617" }}
    >
      {/* Eyes container */}
      <div className="flex items-center gap-[5vw]">
        <Eye emotion={activeEmotion} side="left" />
        <Eye emotion={activeEmotion} side="right" />
      </div>

      {/* Chat bubble */}
      {message && (
        <div className="mt-8 max-w-md px-6 py-3 rounded-2xl bg-slate-800/80 border border-slate-700/50 text-slate-300 text-sm text-center animate-fade-in">
          {message}
        </div>
      )}

      {/* Emotion label (dev mode / debug) */}
      <div className="absolute bottom-4 left-4 text-xs text-slate-700 font-mono">
        {activeEmotion}
      </div>

      {/* Debug: emotion switcher (remove in production) */}
      <div className="absolute bottom-4 right-4 flex gap-1 flex-wrap max-w-xs">
        {(Object.keys(EMOTIONS) as BoBEmotion[]).map((e) => (
          <button
            key={e}
            onClick={() => setManualEmotion(e === manualEmotion ? null : e)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
              activeEmotion === e
                ? "bg-slate-600 text-white"
                : "bg-slate-800/50 text-slate-600 hover:text-slate-400"
            }`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
});
