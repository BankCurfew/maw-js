/**
 * Loops API — REST endpoints for the loop scheduler engine.
 * Ported from v1 server.ts into v2 Elysia module.
 */

import { Elysia, t } from "elysia";
import { LoopEngine } from "../core/loops";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

export const loopEngine = new LoopEngine();

export const loopsApi = new Elysia();

loopsApi.get("/loops", () => {
  return { enabled: loopEngine.isEnabled(), loops: loopEngine.getStatus() };
});

loopsApi.get("/loops/history", ({ query }) => {
  const loopId = query.loopId || undefined;
  const limit = +(query.limit || "50");
  return loopEngine.getHistory(loopId, limit);
}, {
  query: t.Object({
    loopId: t.Optional(t.String()),
    limit: t.Optional(t.String()),
  }),
});

loopsApi.post("/loops/trigger", async ({ body, set }) => {
  const { loopId } = body;
  if (!loopId) { set.status = 400; return { error: "loopId required" }; }
  const result = await loopEngine.triggerLoop(loopId);
  return result;
}, {
  body: t.Object({ loopId: t.Optional(t.String()) }),
});

loopsApi.post("/loops/add", async ({ body, set }) => {
  try {
    const newLoop = body as any;
    if (!newLoop.id || !newLoop.schedule) { set.status = 400; return { error: "id and schedule required" }; }
    const loopsPath = join(process.cwd(), "loops.json");
    const config = JSON.parse(readFileSync(loopsPath, "utf-8"));
    const idx = config.loops.findIndex((l: any) => l.id === newLoop.id);
    if (idx >= 0) {
      config.loops[idx] = { ...config.loops[idx], ...newLoop };
    } else {
      config.loops.push(newLoop);
    }
    writeFileSync(loopsPath, JSON.stringify(config, null, 2), "utf-8");
    return { ok: true, action: idx >= 0 ? "updated" : "added" };
  } catch (e: any) {
    set.status = 400; return { error: e.message };
  }
}, { body: t.Unknown() });

loopsApi.delete("/loops", ({ query, set }) => {
  const loopId = query.id;
  if (!loopId) { set.status = 400; return { error: "id required" }; }
  const loopsPath = join(process.cwd(), "loops.json");
  const config = JSON.parse(readFileSync(loopsPath, "utf-8"));
  const before = config.loops.length;
  config.loops = config.loops.filter((l: any) => l.id !== loopId);
  writeFileSync(loopsPath, JSON.stringify(config, null, 2), "utf-8");
  return { ok: config.loops.length < before };
}, {
  query: t.Object({ id: t.Optional(t.String()) }),
});

loopsApi.post("/loops/toggle", async ({ body }) => {
  const { loopId, enabled } = body;
  if (loopId) {
    const ok = loopEngine.toggleLoop(loopId, enabled);
    return { ok };
  } else {
    loopEngine.toggleEngine(enabled);
    return { ok: true };
  }
}, {
  body: t.Object({ loopId: t.Optional(t.String()), enabled: t.Optional(t.Boolean()) }),
});
