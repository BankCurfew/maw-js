/**
 * Rooms API — serves room layout config from rooms.json.
 * Ported from v1's /api/rooms (BankCurfew fork).
 */

import { Elysia } from "elysia";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

const roomsPath = join(import.meta.dir, "../..", "rooms.json");

// Safeguard: rooms.json is critical for dashboard layout — auto-restore if missing
if (!existsSync(roomsPath)) {
  console.warn("[rooms] ⚠️  rooms.json MISSING — dashboard will show raw tmux sessions!");
  try {
    const restored = execSync("git show HEAD:rooms.json", { cwd: join(import.meta.dir, "../.."), encoding: "utf-8" });
    if (restored && restored.trim().startsWith("{")) {
      writeFileSync(roomsPath, restored, "utf-8");
      console.log("[rooms] ✓ Auto-restored rooms.json from git HEAD");
    }
  } catch {
    console.error("[rooms] ✗ Could not auto-restore rooms.json from git — dashboard layout broken");
  }
}

export const roomsApi = new Elysia();

roomsApi.get("/rooms", () => {
  try {
    if (!existsSync(roomsPath)) return { rooms: [] };
    return JSON.parse(readFileSync(roomsPath, "utf-8"));
  } catch {
    return { rooms: [] };
  }
});

roomsApi.post("/rooms", async ({ body, set }) => {
  try {
    const data = body as any;
    data.updatedAt = new Date().toISOString();
    writeFileSync(roomsPath, JSON.stringify(data, null, 2), "utf-8");
    return { ok: true };
  } catch (e: any) {
    set.status = 400;
    return { error: e instanceof Error ? e.message : String(e) };
  }
});
