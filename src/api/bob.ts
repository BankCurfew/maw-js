/**
 * BoB Face API — WALL-E eyes emotion SSE + chat via maw hey.
 * Ported from v1's monolithic server.ts into v2 Elysia module.
 */

import { Elysia, t } from "elysia";
import { feedBuffer } from "./feed";
import { activeOracles, type FeedEvent } from "../lib/feed";
import { capture } from "../core/transport/ssh";

export const bobApi = new Elysia();

// --- BoB Face SSE (WALL-E Eyes emotion state) ---
// Emotions: neutral, thinking, happy, alert, confused, working, sleeping, error
bobApi.get("/bob/state", ({ request }) => {
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(`data: ${JSON.stringify(data)}\n\n`); } catch {}
      };

      let lastEmotion = "";
      let idleSince = Date.now();

      const tick = () => {
        const events = feedBuffer;
        const active = activeOracles(events, 5 * 60_000);
        const recent = activeOracles(events, 15_000);
        const activeCount = active.size;
        const recentCount = recent.size;
        const hour = (new Date().getUTCHours() + 7) % 24; // Bangkok hour

        // Check for recent errors (PostToolUseFailure in last 30s)
        const now = Date.now();
        const recentEvents = events.filter(e => now - e.ts < 60_000).slice(-50);
        const hasRecentError = recentEvents.some(
          (e) => e.event === "PostToolUseFailure" && now - e.ts < 30_000,
        );

        // Check for recent task completions (last 10s)
        const hasRecentComplete = recentEvents.some(
          (e) => e.event === "TaskCompleted" && now - e.ts < 10_000,
        );

        // Derive emotion from real fleet state
        let emotion = "neutral";
        let message: string | null = null;

        if (hasRecentError) {
          emotion = "error";
          const errEvent = recentEvents.find(
            (e) => e.event === "PostToolUseFailure" && now - e.ts < 30_000,
          );
          message = errEvent
            ? `${errEvent.oracle}: ${errEvent.message.slice(0, 60)}`
            : "Something went wrong";
        } else if (hasRecentComplete) {
          emotion = "happy";
          const doneEvent = recentEvents.find(
            (e) => e.event === "TaskCompleted" && now - e.ts < 10_000,
          );
          message = doneEvent ? `${doneEvent.oracle} finished a task!` : "Task done!";
        } else if (activeCount === 0 && hour >= 0 && hour < 6) {
          emotion = "sleeping";
          message = "zzZ...";
        } else if (activeCount === 0) {
          const idleDuration = now - idleSince;
          if (idleDuration > 5 * 60_000) {
            emotion = "sleeping";
          } else {
            emotion = "neutral";
          }
        } else if (recentCount >= 3) {
          emotion = "working";
          const names = [...recent.keys()].slice(0, 3).join(", ");
          message = `${recentCount} oracles busy: ${names}`;
        } else if (recentCount >= 1) {
          const latestOracle = [...recent.values()][0];
          const isToolUse = latestOracle?.event === "PreToolUse";
          if (isToolUse) {
            emotion = "thinking";
            message = `${latestOracle.oracle} is working...`;
          } else {
            emotion = "working";
            const names = [...recent.keys()].join(", ");
            message = `watching ${names}`;
          }
        } else if (activeCount >= 1) {
          emotion = "alert";
          const names = [...active.keys()].slice(0, 3).join(", ");
          message = `${activeCount} oracle${activeCount > 1 ? "s" : ""} online: ${names}`;
        }

        if (activeCount > 0) idleSince = now;

        const payload = { emotion, message, activeCount, timestamp: new Date().toISOString() };
        if (emotion !== lastEmotion) {
          send(payload);
          lastEmotion = emotion;
        } else {
          send(payload);
        }
      };

      tick();
      const id = setInterval(tick, 5000);
      request.signal.addEventListener("abort", () => clearInterval(id));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// --- BoB Chat (via maw hey bob) ---
const BOB_PANE = process.env.BOB_PANE || "01-bob:0";

bobApi.post("/bob/chat", async ({ body, set }) => {
  const { message } = body;
  if (!message?.trim()) {
    set.status = 400;
    return { error: "message required" };
  }

  try {
    const before = await capture(BOB_PANE, 40);
    const beforeLines = before.split("\n").length;

    const proc = Bun.spawn(["bun", "src/cli.ts", "hey", "bob", message], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    // Poll for BoB's response (up to 30s)
    let response = "";
    let settled = 0;

    for (let i = 0; i < 30; i++) {
      await Bun.sleep(1000);
      const after = await capture(BOB_PANE, 60);
      const afterLines = after.split("\n");
      const newLines = afterLines.slice(beforeLines).join("\n").trim();
      if (newLines.length > 0) {
        if (newLines === response) {
          settled++;
          if (settled >= 3) break;
        } else {
          response = newLines;
          settled = 0;
        }
      }
    }

    const clean = response.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
    return { response: clean || "(BoB didn't respond — he may be busy)" };
  } catch (err: any) {
    set.status = 500;
    return { error: `maw hey error: ${err.message}` };
  }
}, {
  body: t.Object({ message: t.String() }),
});

import { join } from "path";
