import { capture } from "../core/transport/ssh";
import { tmux } from "../core/transport/tmux";
import type { MawWS } from "../core/types";

type SessionInfo = { name: string; windows: { index: number; name: string; active: boolean }[] };

/** Push terminal capture to a subscribed WebSocket client. */
export async function pushCapture(
  ws: MawWS,
  lastContent: Map<MawWS, string>,
) {
  if (!ws.data.target) return;
  try {
    const content = await capture(ws.data.target, 80);
    const prev = lastContent.get(ws);
    if (content !== prev) {
      lastContent.set(ws, content);
      ws.send(JSON.stringify({ type: "capture", target: ws.data.target, content }));
    }
  } catch (e: any) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}

/** Push preview captures for subscribed targets (15 lines to catch status text like "Compacting"). */
export async function pushPreviews(
  ws: MawWS,
  lastPreviews: Map<MawWS, Map<string, string>>,
) {
  const targets = ws.data.previewTargets;
  if (!targets || targets.size === 0) return;
  const prevMap = lastPreviews.get(ws) || new Map<string, string>();
  const changed: Record<string, string> = {};
  let hasChanges = false;

  await Promise.allSettled([...targets].map(async (target) => {
    try {
      const content = await capture(target, 15);
      const prev = prevMap.get(target);
      if (content !== prev) {
        prevMap.set(target, content);
        changed[target] = content;
        hasChanges = true;
      }
    } catch { /* expected: capture may fail for inactive pane */ }
  }));

  lastPreviews.set(ws, prevMap);
  if (hasChanges) {
    ws.send(JSON.stringify({ type: "previews", data: changed }));
  }
}

/** Broadcast local session list to all dashboard WS clients.
 *  Federation peer info reaches the dashboard via config.agents (synthetic entries).
 *  cache.sessions always holds local-only sessions for status detection / busy-agent scanning.
 */
export async function broadcastSessions(
  clients: Set<MawWS>,
  cache: { sessions: SessionInfo[]; json: string },
): Promise<SessionInfo[]> {
  if (clients.size === 0) return cache.sessions;
  try {
    const local = await tmux.listAll();
    cache.sessions = local;
    cache.json = JSON.stringify(local);
    // Only send local sessions to dashboard WS — peer info comes from config.agents (synthetic entries)
    const msg = JSON.stringify({ type: "sessions", sessions: local });
    for (const ws of clients) ws.send(msg);
    return local;
  } catch {
    return cache.sessions;
  }
}

/** Scan panes for running claude and send `recent` to client. */
export async function sendBusyAgents(ws: MawWS, sessions: SessionInfo[]) {
  const allTargets = sessions.flatMap(s => s.windows.map(w => `${s.name}:${w.index}`));
  const cmds = await tmux.getPaneCommands(allTargets);
  const busy = allTargets
    .filter(t => /claude|codex|node/i.test(cmds[t] || ""))
    .map(t => {
      const [session] = t.split(":");
      const s = sessions.find(x => x.name === session);
      const w = s?.windows.find(w => `${s.name}:${w.index}` === t);
      return { target: t, name: w?.name || t, session };
    });
  if (busy.length > 0) {
    ws.send(JSON.stringify({ type: "recent", agents: busy }));
  }
}
