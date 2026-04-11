import { memo, useState, useEffect, useCallback, useRef } from "react";

// 8 WALL-E emotion states (Designer Spec)
export type BobEmotion =
  | "neutral"
  | "thinking"
  | "happy"
  | "alert"
  | "confused"
  | "working"
  | "sleeping"
  | "error";

const ALL_EMOTIONS: BobEmotion[] = [
  "neutral", "thinking", "happy", "alert",
  "confused", "working", "sleeping", "error",
];

// Labels for SR-only live region
const EMOTION_LABELS: Record<BobEmotion, string> = {
  neutral: "BoB is idle",
  thinking: "BoB is thinking...",
  happy: "BoB is happy!",
  alert: "BoB is alert",
  confused: "BoB is confused",
  working: "BoB is working",
  sleeping: "BoB is sleeping",
  error: "BoB encountered an error",
};

// SSE hook for real-time emotion state from server
function useBoBState() {
  const [emotion, setEmotion] = useState<BobEmotion>("neutral");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/brain/feed/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Map BobVisualState mood to our emotion
        if (data.emotion && ALL_EMOTIONS.includes(data.emotion)) {
          setEmotion(data.emotion);
        } else if (data.mood) {
          // BobVisualState mood parser fallback
          const mapped = mapMoodToEmotion(data.mood);
          if (mapped) setEmotion(mapped);
        }
        if (data.message !== undefined) setMessage(data.message);
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      setEmotion("neutral");
    };
    return () => es.close();
  }, []);

  return { emotion, message };
}

function mapMoodToEmotion(mood: string): BobEmotion | null {
  const m = mood.toLowerCase();
  if (m.includes("think") || m.includes("process")) return "thinking";
  if (m.includes("happy") || m.includes("success") || m.includes("done")) return "happy";
  if (m.includes("alert") || m.includes("warn") || m.includes("urgent")) return "alert";
  if (m.includes("confus") || m.includes("error_parse")) return "confused";
  if (m.includes("work") || m.includes("busy") || m.includes("execut")) return "working";
  if (m.includes("sleep") || m.includes("idle") || m.includes("away")) return "sleeping";
  if (m.includes("error") || m.includes("fail") || m.includes("crash")) return "error";
  return null;
}

// Idle timer: 5 min no activity → sleeping, activity → alert then neutral
function useIdleTimer(
  sseEmotion: BobEmotion,
  setOverride: (e: BobEmotion | null) => void,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasAsleep = useRef(false);

  useEffect(() => {
    // Reset idle timer on any SSE emotion change
    if (timerRef.current) clearTimeout(timerRef.current);
    wasAsleep.current = false;
    setOverride(null);

    timerRef.current = setTimeout(() => {
      wasAsleep.current = true;
      setOverride("sleeping");
    }, 5 * 60 * 1000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [sseEmotion, setOverride]);

  // Wake up effect
  useEffect(() => {
    if (wasAsleep.current && sseEmotion !== "sleeping") {
      wasAsleep.current = false;
      setOverride("alert");
      const t = setTimeout(() => setOverride(null), 2000);
      return () => clearTimeout(t);
    }
  }, [sseEmotion, setOverride]);
}

export const BoBFaceView = memo(function BoBFaceView() {
  const { emotion: sseEmotion, message } = useBoBState();
  const [manualEmotion, setManualEmotion] = useState<BobEmotion | null>(null);
  const [idleOverride, setIdleOverride] = useState<BobEmotion | null>(null);

  const stableSetIdleOverride = useCallback(
    (e: BobEmotion | null) => setIdleOverride(e),
    [],
  );
  useIdleTimer(sseEmotion, stableSetIdleOverride);

  const activeEmotion = manualEmotion || idleOverride || sseEmotion;

  return (
    <div
      className="bob-face"
      style={{
        width: "var(--bob-face-width, 80px)",
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 50,
        background:
          "linear-gradient(180deg, rgba(13,13,26,0.95) 0%, rgba(20,20,40,0.90) 100%)",
        borderRight: "1px solid rgba(42, 42, 58, 0.8)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Eyes */}
      <div
        className="bob-eyes"
        data-emotion={activeEmotion}
        aria-hidden="true"
      >
        <div className="bob-eye bob-eye--left">
          <div className="bob-pupil" />
        </div>
        <div className="bob-eye bob-eye--right">
          <div className="bob-pupil" />
        </div>
      </div>

      {/* SR-only live region */}
      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }} aria-live="polite">
        {EMOTION_LABELS[activeEmotion]}
      </span>

      {/* Chat bubble */}
      {message && (
        <div
          style={{
            position: "absolute",
            left: "calc(var(--bob-face-width, 80px) + 12px)",
            top: "50%",
            transform: "translateY(-50%)",
            maxWidth: 220,
            padding: "8px 14px",
            borderRadius: 12,
            background: "rgba(30, 41, 59, 0.9)",
            border: "1px solid rgba(51, 65, 85, 0.5)",
            color: "#cbd5e1",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            animation: "fadeSlideIn 0.3s ease-out",
          }}
        >
          {message}
        </div>
      )}

      {/* Emotion label (debug) */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 9,
          fontFamily: "monospace",
          color: "rgba(100, 116, 139, 0.6)",
          userSelect: "none",
        }}
      >
        {activeEmotion}
      </div>

      {/* Debug: emotion switcher */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          alignItems: "center",
        }}
      >
        {ALL_EMOTIONS.map((e) => (
          <button
            key={e}
            onClick={() => setManualEmotion(e === manualEmotion ? null : e)}
            style={{
              padding: "1px 4px",
              borderRadius: 3,
              fontSize: 7,
              fontFamily: "monospace",
              border: "none",
              cursor: "pointer",
              background:
                activeEmotion === e
                  ? "rgba(71, 85, 105, 0.8)"
                  : "rgba(30, 41, 59, 0.4)",
              color:
                activeEmotion === e
                  ? "#e2e8f0"
                  : "rgba(100, 116, 139, 0.5)",
              lineHeight: 1.2,
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
});
