/**
 * Maw Log API — /api/maw-log endpoint.
 * Reads maw-log.jsonl (Oracle-to-Oracle communication log) for the ChatView.
 * Ported from v1's maw-log.ts module.
 */

import { Elysia, t } from "elysia";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const MAW_LOG_PATH = join(homedir(), ".oracle", "maw-log.jsonl");

interface LogEntry {
  ts: string;
  from: string;
  to: string;
  msg: string;
  ch?: string;
  target?: string;
  host?: string;
  sid?: string;
}

const KNOWN_NAMES: Record<string, string> = {
  neo: "neo-oracle", pulse: "pulse-oracle", hermes: "hermes-oracle",
  calliope: "calliope-oracle", nexus: "nexus-oracle", odin: "odin-oracle",
};

/** Parse maw-log.jsonl — handles raw newlines and unescaped quotes in msg field. */
function parseLog(): LogEntry[] {
  if (!existsSync(MAW_LOG_PATH)) return [];
  const raw = readFileSync(MAW_LOG_PATH, "utf-8");
  const entries: LogEntry[] = [];
  const chunks: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.startsWith("{")) {
      chunks.push(line);
    } else if (chunks.length > 0 && line.trim()) {
      chunks[chunks.length - 1] += "\\n" + line;
    }
  }

  for (const chunk of chunks) {
    try {
      entries.push(JSON.parse(chunk));
    } catch {
      // Try to recover malformed JSON (unescaped quotes in msg field)
      const msgStart = chunk.indexOf('"msg":"');
      if (msgStart === -1) continue;
      const contentStart = msgStart + 7;
      const endings = ['","ch"', '","target"', '","host"', '","sid"'];
      let contentEnd = -1;
      for (const end of endings) {
        const idx = chunk.lastIndexOf(end);
        if (idx > contentStart) { contentEnd = idx; break; }
      }
      if (contentEnd === -1) {
        const idx = chunk.lastIndexOf('"}');
        if (idx > contentStart) contentEnd = idx;
      }
      if (contentEnd === -1) continue;
      const msgContent = chunk.substring(contentStart, contentEnd);
      const escapedContent = msgContent.replace(/(?<!\\)"/g, '\\"');
      const fixed = chunk.substring(0, contentStart) + escapedContent + chunk.substring(contentEnd);
      try { entries.push(JSON.parse(fixed)); } catch {}
    }
  }
  return entries;
}

/** Resolve "unknown" sender from message signature */
function resolveUnknown(entries: LogEntry[]): LogEntry[] {
  return entries.map(e => {
    if (e.from !== "unknown" || !e.msg) return e;
    const m = e.msg.match(/—\s+(\w+)\s*(?:\(Oracle|🖋)/) || e.msg.match(/—\s+(\w+)\s*$/);
    if (m) {
      const name = m[1].toLowerCase();
      if (KNOWN_NAMES[name]) return { ...e, from: KNOWN_NAMES[name] };
    }
    return e;
  });
}

/** Detect oracle identity from cli message signature */
function resolveCliSender(msg: string): string {
  if (!msg) return "nat";
  const sigMatch = msg.match(/—\s+(\w+)\s*(?:\(Oracle|🖋)/);
  if (sigMatch) {
    const name = sigMatch[1].toLowerCase();
    if (KNOWN_NAMES[name]) return KNOWN_NAMES[name];
  }
  return "nat";
}

/** Deduplicate cli relay copies — keep unique cli entries, resolve sender */
function dedup(entries: LogEntry[]): LogEntry[] {
  const oracleKeys = new Set<string>();
  for (const e of entries) {
    if (e.from !== "cli") oracleKeys.add(`${e.to}\0${e.msg}`);
  }
  return entries
    .filter(e => e.from !== "cli" || !oracleKeys.has(`${e.to}\0${e.msg}`))
    .map(e => e.from === "cli" ? { ...e, from: resolveCliSender(e.msg) } : e);
}

/** Full pipeline: parse → dedup → resolve */
function readLog(): LogEntry[] {
  return resolveUnknown(dedup(parseLog()));
}

export const mawLogApi = new Elysia();

mawLogApi.get("/maw-log", ({ query }) => {
  const from = query.from || undefined;
  const to = query.to || undefined;
  const limit = Math.min(500, +(query.limit || "200"));
  let entries = readLog();
  if (from) entries = entries.filter(e => e.from === from || e.to === from);
  if (to) entries = entries.filter(e => e.to === to || e.from === to);
  const total = entries.length;
  entries = entries.slice(-limit);
  return { entries, total };
}, {
  query: t.Object({
    from: t.Optional(t.String()),
    to: t.Optional(t.String()),
    limit: t.Optional(t.String()),
  }),
});
