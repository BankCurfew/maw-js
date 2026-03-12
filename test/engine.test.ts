import { describe, test, expect, mock, beforeEach } from "bun:test";

// --- Mocks ---

let sshResult = "";
let sshCommands: string[] = [];

mock.module("../src/ssh", () => ({
  ssh: async (cmd: string) => { sshCommands.push(cmd); return sshResult; },
  capture: async () => "",
  listSessions: async () => [],
  findWindow: () => null,
  selectWindow: async () => {},
  sendKeys: async () => {},
}));

// Must import after mocking
const { MawEngine } = await import("../src/engine");
const { FeedTailer } = await import("../src/feed-tail");

/** Minimal WebSocket stub that records sent messages */
function makeWS(): { ws: any; messages: any[] } {
  const messages: any[] = [];
  const ws = {
    data: { target: null, previewTargets: new Set() },
    send: (msg: string) => messages.push(JSON.parse(msg)),
  };
  return { ws, messages };
}

describe("MawEngine", () => {
  beforeEach(() => {
    sshResult = "";
    sshCommands = [];
  });

  describe("handleOpen — no stale recent agents", () => {
    test("warm cache sends sessions instantly without recent message", () => {
      const feedTailer = new FeedTailer();
      const engine = new MawEngine({ feedTailer });

      // Simulate warm cache by setting it via broadcastSessions flow
      // @ts-ignore — access private for testing
      engine.cachedSessions = [
        { name: "oracles", windows: [{ index: 1, name: "pulse-oracle", active: true }] },
      ];

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);

      // Should send sessions + feed-history, but NOT recent
      const types = messages.map(m => m.type);
      expect(types).toContain("sessions");
      expect(types).toContain("feed-history");
      expect(types).not.toContain("recent"); // <-- the bug fix
    });

    test("cold cache fetches via tmux.listAll, no recent message", async () => {
      sshResult = "oracles:1:pulse-oracle:1\nhermes:1:hermes-oracle:0";

      const feedTailer = new FeedTailer();
      const engine = new MawEngine({ feedTailer });

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);

      // Wait for async listAll to resolve
      await new Promise(r => setTimeout(r, 50));

      const types = messages.map(m => m.type);
      expect(types).toContain("sessions");
      expect(types).toContain("feed-history");
      expect(types).not.toContain("recent"); // <-- no stale recent
    });
  });

  describe("broadcastSessions — no terminal scraping", () => {
    test("broadcasts sessions without recent message", async () => {
      sshResult = "oracles:1:pulse-oracle:1";

      const feedTailer = new FeedTailer();
      const engine = new MawEngine({ feedTailer });

      const { ws, messages } = makeWS();
      engine.handleOpen(ws as any);
      messages.length = 0; // clear initial messages

      // Trigger broadcast
      // @ts-ignore — access private for testing
      await engine.broadcastSessions();

      const types = messages.map(m => m.type);
      // Should only send sessions (if changed), never recent
      expect(types).not.toContain("recent");

      // Should NOT have spawned capture commands for terminal scraping
      const captureCommands = sshCommands.filter(c => c.includes("capture-pane"));
      expect(captureCommands.length).toBe(0);
    });

    test("uses single tmux list-windows -a command", async () => {
      sshResult = "oracles:1:pulse-oracle:1\noracles:2:volt-oracle:0";

      const feedTailer = new FeedTailer();
      const engine = new MawEngine({ feedTailer });

      const { ws } = makeWS();
      engine.handleOpen(ws as any);

      // Wait for cold fetch
      await new Promise(r => setTimeout(r, 50));

      // Should use list-windows -a (single command), not list-sessions + N list-windows
      const listCmds = sshCommands.filter(c => c.includes("list-"));
      expect(listCmds.length).toBe(1);
      expect(listCmds[0]).toContain("list-windows");
      expect(listCmds[0]).toContain("-a");
    });
  });
});
