#!/usr/bin/env bun
// @bun
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = import.meta.require;

// src/config.ts
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
function loadConfig() {
  if (cached)
    return cached;
  const configPath = join(import.meta.dir, "../maw.config.json");
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    cached = { ...DEFAULTS, ...raw };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}
function resetConfig() {
  cached = null;
}
function saveConfig(update) {
  const configPath = join(import.meta.dir, "../maw.config.json");
  const current = loadConfig();
  const merged = { ...current, ...update };
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + `
`, "utf-8");
  resetConfig();
  return loadConfig();
}
function configForDisplay() {
  const config = loadConfig();
  const envMasked = {};
  for (const [k, v] of Object.entries(config.env)) {
    if (v.length <= 4) {
      envMasked[k] = "\u2022".repeat(v.length);
    } else {
      envMasked[k] = v.slice(0, 3) + "\u2022".repeat(Math.min(v.length - 3, 20));
    }
  }
  return { ...config, env: {}, envMasked };
}
function matchGlob(pattern, name) {
  if (pattern === name)
    return true;
  if (pattern.startsWith("*") && name.endsWith(pattern.slice(1)))
    return true;
  if (pattern.endsWith("*") && name.startsWith(pattern.slice(0, -1)))
    return true;
  return false;
}
function buildCommand(agentName) {
  const config = loadConfig();
  let cmd = config.commands.default || "claude";
  for (const [pattern, command] of Object.entries(config.commands)) {
    if (pattern === "default")
      continue;
    if (matchGlob(pattern, agentName)) {
      cmd = command;
      break;
    }
  }
  const prefix = 'command -v direnv >/dev/null && direnv allow . && eval "$(direnv export zsh)"; unset CLAUDECODE 2>/dev/null;';
  if (cmd.includes("--continue")) {
    const fallback = cmd.replace(/\s*--continue\b/, "");
    return `${prefix} ${cmd} || ${prefix} ${fallback}`;
  }
  return `${prefix} ${cmd}`;
}
function getEnvVars() {
  return loadConfig().env || {};
}
var DEFAULTS, cached = null;
var init_config = __esm(() => {
  DEFAULTS = {
    host: "local",
    port: 3456,
    ghqRoot: join(homedir(), "repos/github.com"),
    oracleUrl: "http://localhost:47779",
    env: {},
    commands: { default: "claude" },
    sessions: {}
  };
});

// src/tmux.ts
var exports_tmux = {};
__export(exports_tmux, {
  tmux: () => tmux,
  Tmux: () => Tmux
});
function q(s) {
  const str = String(s);
  if (/^[a-zA-Z0-9_.:\-\/]+$/.test(str))
    return str;
  return `'${str.replace(/'/g, "'\\''")}'`;
}

class Tmux {
  host;
  constructor(host) {
    this.host = host;
  }
  async run(subcommand, ...args) {
    const cmd = `tmux ${subcommand} ${args.map(q).join(" ")} 2>/dev/null`;
    return ssh(cmd, this.host);
  }
  async tryRun(subcommand, ...args) {
    return this.run(subcommand, ...args).catch(() => "");
  }
  async listSessions() {
    const raw = await this.run("list-sessions", "-F", "#{session_name}");
    const sessions = [];
    for (const s of raw.split(`
`).filter(Boolean)) {
      const windows = await this.listWindows(s);
      sessions.push({ name: s, windows });
    }
    return sessions;
  }
  async listAll() {
    const raw = await this.run("list-windows", "-a", "-F", "#{session_name}|||#{window_index}|||#{window_name}|||#{window_active}|||#{pane_current_path}");
    const map = new Map;
    for (const line of raw.split(`
`).filter(Boolean)) {
      const [session, idx, name, active, cwd] = line.split("|||");
      if (!map.has(session))
        map.set(session, []);
      map.get(session).push({ index: +idx, name, active: active === "1", cwd: cwd || undefined });
    }
    return [...map.entries()].map(([name, windows]) => ({ name, windows }));
  }
  async hasSession(name) {
    try {
      await this.run("has-session", "-t", name);
      return true;
    } catch {
      return false;
    }
  }
  async newSession(name, opts = {}) {
    const args = [];
    if (opts.detached !== false)
      args.push("-d");
    args.push("-s", name);
    if (opts.window)
      args.push("-n", opts.window);
    if (opts.cwd)
      args.push("-c", opts.cwd);
    await this.run("new-session", ...args);
  }
  async newGroupedSession(parent, name, opts) {
    await this.run("new-session", "-d", "-t", parent, "-s", name, "-x", opts.cols, "-y", opts.rows);
    if (opts.window)
      await this.selectWindow(`${name}:${opts.window}`);
  }
  async killSession(name) {
    await this.tryRun("kill-session", "-t", name);
  }
  async listWindows(session) {
    const raw = await this.run("list-windows", "-t", session, "-F", "#{window_index}:#{window_name}:#{window_active}");
    return raw.split(`
`).filter(Boolean).map((w) => {
      const [idx, name, active] = w.split(":");
      return { index: +idx, name, active: active === "1" };
    });
  }
  async newWindow(session, name, opts = {}) {
    const args = ["-t", session, "-n", name];
    if (opts.cwd)
      args.push("-c", opts.cwd);
    await this.run("new-window", ...args);
  }
  async selectWindow(target) {
    await this.tryRun("select-window", "-t", target);
  }
  async killWindow(target) {
    await this.tryRun("kill-window", "-t", target);
  }
  async getPaneCommand(target) {
    const raw = await this.run("list-panes", "-t", target, "-F", "#{pane_current_command}");
    return raw.split(`
`)[0] || "";
  }
  async getPaneCommands(targets) {
    const result = {};
    await Promise.allSettled(targets.map(async (t) => {
      try {
        result[t] = await this.getPaneCommand(t);
      } catch {}
    }));
    return result;
  }
  async getPaneInfo(target) {
    const raw = await this.run("list-panes", "-t", target, "-F", "#{pane_current_command}\t#{pane_current_path}");
    const [command = "", cwd = ""] = raw.split(`
`)[0].split("\t");
    return { command, cwd };
  }
  async getPaneInfos(targets) {
    const result = {};
    await Promise.allSettled(targets.map(async (t) => {
      try {
        result[t] = await this.getPaneInfo(t);
      } catch {}
    }));
    return result;
  }
  async capture(target, lines = 80) {
    if (lines > 50) {
      return this.run("capture-pane", "-t", target, "-e", "-p", "-S", -lines);
    }
    const cmd = `tmux capture-pane -t ${q(target)} -e -p 2>/dev/null | tail -${lines}`;
    return ssh(cmd, this.host);
  }
  async resizePane(target, cols, rows) {
    const c = Math.max(1, Math.min(500, Math.floor(cols)));
    const r = Math.max(1, Math.min(200, Math.floor(rows)));
    await this.tryRun("resize-pane", "-t", target, "-x", c, "-y", r);
  }
  async splitWindow(target) {
    await this.run("split-window", "-t", target);
  }
  async selectPane(target, opts = {}) {
    const args = ["-t", target];
    if (opts.title)
      args.push("-T", opts.title);
    await this.run("select-pane", ...args);
  }
  async selectLayout(target, layout) {
    await this.run("select-layout", "-t", target, layout);
  }
  async sendKeys(target, ...keys) {
    await this.run("send-keys", "-t", target, ...keys);
  }
  async sendKeysLiteral(target, text) {
    await this.run("send-keys", "-t", target, "-l", text);
  }
  async loadBuffer(text) {
    const escaped = text.replace(/'/g, "'\\''");
    const cmd = `printf '%s' '${escaped}' | tmux load-buffer -`;
    await ssh(cmd, this.host);
  }
  async pasteBuffer(target) {
    await this.run("paste-buffer", "-t", target);
  }
  async sendText(target, text) {
    if (text.includes(`
`) || text.length > 500) {
      await this.loadBuffer(text);
      await this.pasteBuffer(target);
      await this.sendKeys(target, "Enter");
      await new Promise((r) => setTimeout(r, 500));
      await this.sendKeys(target, "Enter");
      await new Promise((r) => setTimeout(r, 1000));
      await this.sendKeys(target, "Enter");
    } else {
      await this.sendKeysLiteral(target, text);
      await this.sendKeys(target, "Enter");
      await new Promise((r) => setTimeout(r, 500));
      await this.sendKeys(target, "Enter");
      await new Promise((r) => setTimeout(r, 1000));
      await this.sendKeys(target, "Enter");
    }
  }
  async setEnvironment(session, key, value) {
    await this.run("set-environment", "-t", session, key, value);
  }
  async setOption(target, option, value) {
    await this.tryRun("set-option", "-t", target, option, value);
  }
  async set(target, option, value) {
    await this.tryRun("set", "-t", target, option, value);
  }
}
var tmux;
var init_tmux = __esm(() => {
  init_ssh();
  tmux = new Tmux;
});

// src/ssh.ts
var exports_ssh = {};
__export(exports_ssh, {
  ssh: () => ssh,
  sendKeys: () => sendKeys,
  selectWindow: () => selectWindow,
  listSessions: () => listSessions,
  getPaneInfos: () => getPaneInfos,
  getPaneCommands: () => getPaneCommands,
  getPaneCommand: () => getPaneCommand,
  findWindow: () => findWindow,
  capture: () => capture
});
async function ssh(cmd, host = DEFAULT_HOST) {
  const local = host === "local" || host === "localhost" || IS_LOCAL;
  const args = local ? IS_WINDOWS_BUN ? ["wsl.exe", "bash", "-lc", cmd] : ["bash", "-c", cmd] : ["ssh", host, cmd];
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(err.trim() || `exit ${code}`);
  }
  return text.trim();
}
async function listSessions(host) {
  let raw;
  try {
    raw = await ssh("tmux list-sessions -F '#{session_name}' 2>/dev/null", host);
  } catch {
    return [];
  }
  const sessions = [];
  for (const s of raw.split(`
`).filter(Boolean)) {
    const winRaw = await ssh(`tmux list-windows -t '${s}' -F '#{window_index}:#{window_name}:#{window_active}' 2>/dev/null`, host);
    const windows = winRaw.split(`
`).filter(Boolean).map((w) => {
      const [idx, name, active] = w.split(":");
      return { index: +idx, name, active: active === "1" };
    });
    sessions.push({ name: s, windows });
  }
  return sessions;
}
function findWindow(sessions, query) {
  const q2 = query.toLowerCase();
  for (const s of sessions) {
    for (const w of s.windows) {
      if (w.name.toLowerCase().includes(q2))
        return `${s.name}:${w.index}`;
    }
  }
  if (query.includes(":"))
    return query;
  return null;
}
async function capture(target, lines = 80, host) {
  if (lines > 50) {
    return ssh(`tmux capture-pane -t '${target}' -e -p -S -${lines} 2>/dev/null`, host);
  }
  return ssh(`tmux capture-pane -t '${target}' -e -p 2>/dev/null | tail -${lines}`, host);
}
async function selectWindow(target, host) {
  await ssh(`tmux select-window -t '${target}' 2>/dev/null`, host);
}
async function getPaneCommand(target, host) {
  const { Tmux: Tmux2 } = await Promise.resolve().then(() => (init_tmux(), exports_tmux));
  const t = new Tmux2(host);
  return t.getPaneCommand(target);
}
async function getPaneCommands(targets, host) {
  const { Tmux: Tmux2 } = await Promise.resolve().then(() => (init_tmux(), exports_tmux));
  const t = new Tmux2(host);
  return t.getPaneCommands(targets);
}
async function getPaneInfos(targets, host) {
  const { Tmux: Tmux2 } = await Promise.resolve().then(() => (init_tmux(), exports_tmux));
  const t = new Tmux2(host);
  return t.getPaneInfos(targets);
}
async function sendKeys(target, text, host) {
  const { Tmux: Tmux2 } = await Promise.resolve().then(() => (init_tmux(), exports_tmux));
  const t = new Tmux2(host);
  const SPECIAL_KEYS = {
    "\x1B": "Escape",
    "\x1B[A": "Up",
    "\x1B[B": "Down",
    "\x1B[C": "Right",
    "\x1B[D": "Left",
    "\r": "Enter",
    "\n": "Enter",
    "\b": "BSpace",
    "\x15": "C-u"
  };
  if (SPECIAL_KEYS[text]) {
    await t.sendKeys(target, SPECIAL_KEYS[text]);
    return;
  }
  const endsWithEnter = text.endsWith("\r") || text.endsWith(`
`);
  const body = endsWithEnter ? text.slice(0, -1) : text;
  if (!body) {
    await t.sendKeys(target, "Enter");
    return;
  }
  if (body.startsWith("/")) {
    for (const ch of body) {
      await t.sendKeysLiteral(target, ch);
    }
    await t.sendKeys(target, "Enter");
  } else {
    await t.sendText(target, body);
  }
}
var DEFAULT_HOST, IS_LOCAL, IS_WINDOWS_BUN;
var init_ssh = __esm(() => {
  init_config();
  DEFAULT_HOST = process.env.MAW_HOST || loadConfig().host || "white.local";
  IS_LOCAL = DEFAULT_HOST === "local" || DEFAULT_HOST === "localhost";
  IS_WINDOWS_BUN = process.platform === "win32";
});

// src/find-window.ts
function matchSession(sessions, part, strict = false) {
  const p = part.toLowerCase();
  if (!p)
    return null;
  for (const s of sessions)
    if (s.name.toLowerCase() === p)
      return s;
  for (const s of sessions)
    if (s.name.toLowerCase().replace(/^\d+-/, "") === p)
      return s;
  if (!strict) {
    for (const s of sessions)
      if (s.name.toLowerCase().includes(p))
        return s;
  }
  return null;
}
function findWindow2(sessions, query) {
  const q2 = query.toLowerCase();
  if (query.includes(":")) {
    const [sessPart, winPart] = q2.split(":", 2);
    const sess = matchSession(sessions, sessPart, true);
    if (sess) {
      if (!winPart) {
        if (sess.windows.length > 0)
          return `${sess.name}:${sess.windows[0].index}`;
      } else {
        for (const w of sess.windows) {
          if (w.name.toLowerCase().includes(winPart))
            return `${sess.name}:${w.index}`;
        }
      }
    }
  }
  for (const s of sessions) {
    for (const w of s.windows) {
      if (w.name.toLowerCase().includes(q2))
        return `${s.name}:${w.index}`;
    }
  }
  for (const s of sessions) {
    if (s.name.toLowerCase().includes(q2) && s.windows.length > 0) {
      return `${s.name}:${s.windows[0].index}`;
    }
  }
  if (query.includes(":")) {
    const [sessPart] = query.toLowerCase().split(":", 2);
    const sessExists = matchSession(sessions, sessPart, true);
    return sessExists ? query : null;
  }
  return null;
}

// src/commands/overview.ts
function buildTargets(sessions, filters) {
  let targets = sessions.filter((s) => /^\d+-/.test(s.name) && s.name !== "0-overview").map((s) => {
    const active = s.windows.find((w) => w.active) || s.windows[0];
    const oracleName = s.name.replace(/^\d+-/, "");
    return { session: s.name, window: active?.index ?? 1, windowName: active?.name ?? oracleName, oracle: oracleName };
  });
  if (filters.length) {
    targets = targets.filter((t) => filters.some((f) => t.oracle.includes(f) || t.session.includes(f)));
  }
  return targets;
}
function paneColor(index) {
  return PANE_COLORS[index % PANE_COLORS.length];
}
function paneTitle(t) {
  return `${t.oracle} (${t.session}:${t.window})`;
}
function processMirror(raw, lines) {
  const sep = "\u2500".repeat(60);
  const filtered = raw.replace(/[\u2500\u2501]{6,}/g, sep).split(`
`).filter((l) => l.trim() !== "");
  const visible = filtered.slice(-lines);
  const pad = Math.max(0, lines - visible.length);
  return `
`.repeat(pad) + visible.join(`
`);
}
function mirrorCmd(t) {
  const target = encodeURIComponent(`${t.session}:${t.window}`);
  const port = process.env.MAW_PORT || "3456";
  return `watch --color -t -n0.5 'curl -s "http://localhost:${port}/api/mirror?target=${target}&lines=\\$(tput lines)"'`;
}
function pickLayout(count) {
  if (count <= 2)
    return "even-horizontal";
  return "tiled";
}
function chunkTargets(targets) {
  const pages = [];
  for (let i = 0;i < targets.length; i += PANES_PER_PAGE) {
    pages.push(targets.slice(i, i + PANES_PER_PAGE));
  }
  return pages;
}
async function cmdOverview(filterArgs) {
  const kill = filterArgs.includes("--kill") || filterArgs.includes("-k");
  const filters = filterArgs.filter((a) => !a.startsWith("-"));
  try {
    await ssh("tmux kill-session -t 0-overview 2>/dev/null");
  } catch {}
  if (kill) {
    console.log("overview killed");
    return;
  }
  const sessions = await listSessions();
  const targets = buildTargets(sessions, filters);
  if (!targets.length) {
    console.error("no oracle sessions found");
    return;
  }
  const pages = chunkTargets(targets);
  await ssh("tmux new-session -d -s 0-overview -n page-1");
  await ssh("tmux set -t 0-overview pane-border-status top");
  await ssh('tmux set -t 0-overview pane-border-format " #{pane_title} "');
  await ssh("tmux set -t 0-overview pane-border-style fg=colour238");
  await ssh("tmux set -t 0-overview pane-active-border-style fg=colour45");
  await ssh("tmux set -t 0-overview status-style bg=colour235,fg=colour248");
  await ssh("tmux set -t 0-overview status-left-length 40");
  await ssh("tmux set -t 0-overview status-right-length 60");
  await ssh(`tmux set -t 0-overview status-left '#[fg=colour16,bg=colour204,bold] \u2588 MAW #[fg=colour204,bg=colour238] #[fg=colour255,bg=colour238] ${targets.length} oracles #[fg=colour238,bg=colour235] '`);
  await ssh(`tmux set -t 0-overview status-right '#[fg=colour238,bg=colour235]#[fg=colour114,bg=colour238] \u25CF live #[fg=colour81,bg=colour238] %H:%M #[fg=colour16,bg=colour81,bold] %d-%b '`);
  await ssh("tmux set -t 0-overview status-justify centre");
  await ssh("tmux set -t 0-overview window-status-format '#[fg=colour248,bg=colour235] #I:#W '");
  await ssh("tmux set -t 0-overview window-status-current-format '#[fg=colour16,bg=colour45,bold] #I:#W '");
  for (let p = 0;p < pages.length; p++) {
    const page = pages[p];
    const winName = `page-${p + 1}`;
    if (p > 0) {
      await ssh(`tmux new-window -t 0-overview -n ${winName}`);
    }
    const baseIdx = p * PANES_PER_PAGE;
    const pane0 = `0-overview:${winName}.0`;
    const color0 = paneColor(baseIdx);
    await ssh(`tmux select-pane -t ${pane0} -T '#[fg=${color0},bold]${paneTitle(page[0])}#[default]'`);
    await ssh(`tmux send-keys -t ${pane0} "${mirrorCmd(page[0]).replace(/"/g, "\\\"")}" Enter`);
    for (let i = 1;i < page.length; i++) {
      await ssh(`tmux split-window -t 0-overview:${winName}`);
      const paneId = `0-overview:${winName}.${i}`;
      const color = paneColor(baseIdx + i);
      await ssh(`tmux select-pane -t ${paneId} -T '#[fg=${color},bold]${paneTitle(page[i])}#[default]'`);
      await ssh(`tmux send-keys -t ${paneId} "${mirrorCmd(page[i]).replace(/"/g, "\\\"")}" Enter`);
      await ssh(`tmux select-layout -t 0-overview:${winName} tiled`);
    }
    const layout = pickLayout(page.length);
    await ssh(`tmux select-layout -t 0-overview:${winName} ${layout}`);
  }
  await ssh("tmux select-window -t 0-overview:page-1");
  console.log(`\x1B[32m\u2705\x1B[0m overview: ${targets.length} oracles across ${pages.length} page${pages.length > 1 ? "s" : ""}`);
  for (let p = 0;p < pages.length; p++) {
    console.log(`  page-${p + 1}: ${pages[p].map((t) => t.oracle).join(", ")}`);
  }
  console.log(`
  attach: tmux attach -t 0-overview`);
  if (pages.length > 1)
    console.log(`  navigate: Ctrl-b n/p (next/prev page)`);
}
var PANES_PER_PAGE = 9, PANE_COLORS;
var init_overview = __esm(() => {
  init_ssh();
  PANE_COLORS = [
    "colour204",
    "colour114",
    "colour81",
    "colour220",
    "colour177",
    "colour208",
    "colour44",
    "colour196",
    "colour83",
    "colour141"
  ];
});

// src/commands/wake.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync3 } from "fs";
import { join as join5 } from "path";
async function fetchIssuePrompt(issueNum, repo) {
  let repoSlug = repo;
  if (!repoSlug) {
    try {
      const remote = await ssh("git remote get-url origin 2>/dev/null");
      const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
      if (m)
        repoSlug = m[1];
    } catch {}
  }
  if (!repoSlug)
    throw new Error("Could not detect repo \u2014 pass --repo org/name");
  const json = await ssh(`gh issue view ${issueNum} --repo '${repoSlug}' --json title,body,labels`);
  const issue = JSON.parse(json);
  const labels = (issue.labels || []).map((l) => l.name).join(", ");
  const parts = [
    `Work on issue #${issueNum}: ${issue.title}`,
    labels ? `Labels: ${labels}` : "",
    "",
    issue.body || "(no description)"
  ];
  return parts.filter(Boolean).join(`
`);
}
async function resolveOracle(oracle) {
  let ghqOut = "";
  try {
    ghqOut = await ssh(`ghq list --full-path 2>/dev/null | grep -i '/${oracle}[^/]*-oracle$' | head -1`);
  } catch {}
  if (!ghqOut?.trim()) {
    try {
      ghqOut = await ssh(`ls -d $HOME/repos/github.com/BankCurfew/${oracle}*-Oracle $HOME/repos/github.com/BankCurfew/${oracle}*-oracle 2>/dev/null | head -1`);
    } catch {}
  }
  if (ghqOut?.trim()) {
    const repoPath = ghqOut.trim();
    const repoName = repoPath.split("/").pop();
    const parentDir = repoPath.replace(/\/[^/]+$/, "");
    return { repoPath, repoName, parentDir };
  }
  const fleetDir = join5(import.meta.dir, "../../fleet");
  try {
    for (const file of readdirSync2(fleetDir).filter((f) => f.endsWith(".json"))) {
      const config = JSON.parse(readFileSync3(join5(fleetDir, file), "utf-8"));
      const oracleLower = oracle.toLowerCase();
      const win = (config.windows || []).find((w) => {
        const wl = w.name.toLowerCase();
        return wl === `${oracleLower}-oracle` || wl.startsWith(`${oracleLower}`) && wl.endsWith("-oracle");
      });
      if (win?.repo) {
        let repoPath = "";
        try {
          const fullPath = await ssh(`ghq list --full-path | grep -i '/${win.repo.replace(/^[^/]+\//, "")}$' | head -1`);
          if (fullPath?.trim())
            repoPath = fullPath.trim();
        } catch {}
        if (!repoPath) {
          const repoName = win.repo.replace(/^[^/]+\//, "");
          const candidates = [
            `$HOME/repos/github.com/${win.repo}`,
            `$HOME/${repoName}`
          ];
          for (const c of candidates) {
            try {
              const resolved = await ssh(`eval echo ${c}`);
              const exists = await ssh(`test -d "${resolved}" && echo "${resolved}"`);
              if (exists?.trim()) {
                repoPath = exists.trim();
                break;
              }
            } catch {}
          }
        }
        if (repoPath) {
          const repoName = repoPath.split("/").pop();
          const parentDir = repoPath.replace(/\/[^/]+$/, "");
          return { repoPath, repoName, parentDir };
        }
      }
    }
  } catch {}
  console.error(`oracle repo not found: ${oracle} (tried ${oracle}-oracle pattern and fleet configs)`);
  process.exit(1);
}
async function findWorktrees(parentDir, repoName) {
  const lsOut = await ssh(`ls -d ${parentDir}/${repoName}.wt-* 2>/dev/null || true`);
  return lsOut.split(`
`).filter(Boolean).map((p) => {
    const base = p.split("/").pop();
    const suffix = base.replace(`${repoName}.wt-`, "");
    return { path: p, name: suffix };
  });
}
function getSessionMap() {
  return loadConfig().sessions;
}
function resolveFleetSession(oracle) {
  const fleetDir = join5(import.meta.dir, "../../fleet");
  try {
    for (const file of readdirSync2(fleetDir).filter((f) => f.endsWith(".json") && !f.endsWith(".disabled"))) {
      const config = JSON.parse(readFileSync3(join5(fleetDir, file), "utf-8"));
      const hasOracleWindow = (config.windows || []).some((w) => w.name === `${oracle}-oracle` || w.name === oracle);
      if (hasOracleWindow)
        return config.name;
    }
  } catch {}
  return null;
}
async function detectSession(oracle) {
  const sessions = await tmux.listSessions();
  const mapped = getSessionMap()[oracle];
  if (mapped) {
    const exists = sessions.find((s) => s.name === mapped);
    if (exists)
      return mapped;
  }
  const patternMatch = sessions.find((s) => /^\d+-/.test(s.name) && s.name.endsWith(`-${oracle}`))?.name || sessions.find((s) => s.name === oracle)?.name;
  if (patternMatch)
    return patternMatch;
  const fleetSession = resolveFleetSession(oracle);
  if (fleetSession) {
    const exists = sessions.find((s) => s.name === fleetSession);
    if (exists)
      return fleetSession;
  }
  return null;
}
async function setSessionEnv(session) {
  for (const [key, val] of Object.entries(getEnvVars())) {
    await tmux.setEnvironment(session, key, val);
  }
}
async function cmdWake(oracle, opts) {
  const { repoPath, repoName, parentDir } = await resolveOracle(oracle);
  let session = await detectSession(oracle);
  if (!session) {
    session = getSessionMap()[oracle] || resolveFleetSession(oracle) || oracle;
    const mainWindowName = `${oracle}-oracle`;
    await tmux.newSession(session, { window: mainWindowName, cwd: repoPath });
    await setSessionEnv(session);
    await new Promise((r) => setTimeout(r, 300));
    await tmux.sendText(`${session}:${mainWindowName}`, buildCommand(mainWindowName));
    console.log(`\x1B[32m+\x1B[0m created session '${session}' (main: ${mainWindowName})`);
    const allWt = await findWorktrees(parentDir, repoName);
    for (const wt of allWt) {
      const wtWindowName = `${oracle}-${wt.name}`;
      await tmux.newWindow(session, wtWindowName, { cwd: wt.path });
      await new Promise((r) => setTimeout(r, 300));
      await tmux.sendText(`${session}:${wtWindowName}`, buildCommand(wtWindowName));
      console.log(`\x1B[32m+\x1B[0m window: ${wtWindowName}`);
    }
  } else {
    await setSessionEnv(session);
  }
  let targetPath = repoPath;
  let windowName = `${oracle}-oracle`;
  if (opts.newWt || opts.task) {
    const name = opts.newWt || opts.task;
    const worktrees = await findWorktrees(parentDir, repoName);
    const match = worktrees.find((w) => w.name.endsWith(`-${name}`) || w.name === name);
    if (match) {
      console.log(`\x1B[33m\u26A1\x1B[0m reusing worktree: ${match.path}`);
      targetPath = match.path;
      windowName = `${oracle}-${name}`;
    } else {
      const nums = worktrees.map((w) => parseInt(w.name) || 0);
      const nextNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
      const wtName = `${nextNum}-${name}`;
      const wtPath = `${parentDir}/${repoName}.wt-${wtName}`;
      const branch = `agents/${wtName}`;
      try {
        await ssh(`git -C '${repoPath}' branch -D '${branch}' 2>/dev/null`);
      } catch {}
      await ssh(`git -C '${repoPath}' worktree add '${wtPath}' -b '${branch}'`);
      console.log(`\x1B[32m+\x1B[0m worktree: ${wtPath} (${branch})`);
      targetPath = wtPath;
      windowName = `${oracle}-${name}`;
    }
  }
  try {
    const windows = await tmux.listWindows(session);
    const windowNames = windows.map((w) => w.name);
    const nameSuffix = windowName.replace(`${oracle}-`, "");
    const wLower = windowName.toLowerCase();
    const oLower = oracle.toLowerCase();
    const existingWindow = windowNames.find((w) => w.toLowerCase() === wLower) || windowNames.find((w) => w.toLowerCase().startsWith(oLower) && w.toLowerCase().endsWith("-oracle")) || windowNames.find((w) => new RegExp(`^${oracle}-\\d+-${nameSuffix}$`, "i").test(w));
    if (existingWindow) {
      const target = `${session}:${existingWindow}`;
      if (opts.prompt) {
        let isClaudeRunning = false;
        try {
          const paneCmd = await ssh(`tmux display-message -t '${target}' -p '#{pane_current_command}' 2>/dev/null`);
          isClaudeRunning = /claude|node/i.test(paneCmd);
        } catch {}
        if (isClaudeRunning) {
          console.log(`\x1B[33m\u26A1\x1B[0m '${existingWindow}' has active Claude \u2014 sending message`);
          await tmux.selectWindow(target);
          const { sendKeys: sk } = await Promise.resolve().then(() => (init_ssh(), exports_ssh));
          await sk(target, opts.prompt);
          return target;
        } else {
          console.log(`\x1B[33m\u26A1\x1B[0m '${existingWindow}' exists, starting claude with prompt`);
          await tmux.selectWindow(target);
          const cmd2 = buildCommand(existingWindow);
          const escaped = opts.prompt.replace(/'/g, "'\\''");
          await tmux.sendText(target, `${cmd2} -p '${escaped}'`);
          return target;
        }
      }
      console.log(`\x1B[33m\u26A1\x1B[0m '${existingWindow}' already running in ${session}`);
      await tmux.selectWindow(target);
      return target;
    }
  } catch {}
  await tmux.newWindow(session, windowName, { cwd: targetPath });
  await new Promise((r) => setTimeout(r, 300));
  const cmd = buildCommand(windowName);
  if (opts.prompt) {
    const escaped = opts.prompt.replace(/'/g, "'\\''");
    await tmux.sendText(`${session}:${windowName}`, `${cmd} -p '${escaped}'`);
  } else {
    await tmux.sendText(`${session}:${windowName}`, cmd);
  }
  console.log(`\x1B[32m\u2705\x1B[0m woke '${windowName}' in ${session} \u2192 ${targetPath}`);
  return `${session}:${windowName}`;
}
var init_wake = __esm(() => {
  init_ssh();
  init_tmux();
  init_config();
});

// src/oracle-health.ts
function oracleToSession(oracle) {
  return ORACLE_SESSIONS[oracle] || oracle;
}
function alertId(type, oracle, from) {
  return `${type}:${oracle}:${from || ""}`;
}
function getTier(waitingMin) {
  if (waitingMin >= TIER_THRESHOLDS[3])
    return 3;
  if (waitingMin >= TIER_THRESHOLDS[2])
    return 2;
  if (waitingMin >= TIER_THRESHOLDS[1])
    return 1;
  return 0;
}
function isTrackableSender(from) {
  if (IGNORE_SENDERS.has(from))
    return false;
  return EXPECTED_ORACLES.has(from) || from.endsWith("-oracle") || from === "nat";
}
var ORACLE_SESSIONS, EXPECTED_ORACLES, IGNORE_SENDERS, TIER_THRESHOLDS, RESTART_COOLDOWN_MS = 300000;
var init_oracle_health = __esm(() => {
  ORACLE_SESSIONS = {
    bob: "01-bob",
    dev: "02-dev",
    qa: "03-qa",
    researcher: "04-researcher",
    writer: "05-writer",
    designer: "06-designer",
    hr: "07-hr",
    aia: "08-aia",
    data: "09-data",
    admin: "10-admin",
    botdev: "11-botdev",
    creator: "12-creator",
    doc: "13-doc",
    editor: "14-editor",
    security: "15-security",
    fe: "16-fe",
    pa: "17-pa"
  };
  EXPECTED_ORACLES = new Set(Object.keys(ORACLE_SESSIONS));
  IGNORE_SENDERS = new Set(["cli", "nat", "human", ""]);
  TIER_THRESHOLDS = { 1: 15, 2: 30, 3: 120 };
});

// src/maw-log.ts
import { readFileSync as readFileSync4, existsSync } from "fs";
import { join as join6 } from "path";
import { homedir as homedir4 } from "os";
function parseLog() {
  if (!existsSync(MAW_LOG_PATH))
    return [];
  const raw = readFileSync4(MAW_LOG_PATH, "utf-8");
  const entries = [];
  const chunks = [];
  for (const line of raw.split(`
`)) {
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
      const msgStart = chunk.indexOf('"msg":"');
      if (msgStart === -1)
        continue;
      const contentStart = msgStart + 7;
      const endings = ['","ch"', '","target"', '","host"', '","sid"'];
      let contentEnd = -1;
      for (const end of endings) {
        const idx = chunk.lastIndexOf(end);
        if (idx > contentStart) {
          contentEnd = idx;
          break;
        }
      }
      if (contentEnd === -1) {
        const idx = chunk.lastIndexOf('"}');
        if (idx > contentStart)
          contentEnd = idx;
      }
      if (contentEnd === -1)
        continue;
      const msgContent = chunk.substring(contentStart, contentEnd);
      const escapedContent = msgContent.replace(/(?<!\\)"/g, "\\\"");
      const fixed = chunk.substring(0, contentStart) + escapedContent + chunk.substring(contentEnd);
      try {
        entries.push(JSON.parse(fixed));
      } catch {}
    }
  }
  return entries;
}
function resolveUnknown(entries) {
  return entries.map((e) => {
    if (e.from !== "unknown" || !e.msg)
      return e;
    const m = e.msg.match(/\u2014\s+(\w+)\s*(?:\(Oracle|\uD83D\uDD8B)/) || e.msg.match(/\u2014\s+(\w+)\s*$/);
    if (m) {
      const name = m[1].toLowerCase();
      if (KNOWN_NAMES[name])
        return { ...e, from: KNOWN_NAMES[name] };
    }
    return e;
  });
}
function resolveCliSender(msg) {
  if (!msg)
    return "nat";
  const sigMatch = msg.match(/\u2014\s+(\w+)\s*(?:\(Oracle|\uD83D\uDD8B)/);
  if (sigMatch) {
    const name = sigMatch[1].toLowerCase();
    if (KNOWN_NAMES[name])
      return KNOWN_NAMES[name];
  }
  return "nat";
}
function dedup(entries) {
  const oracleKeys = new Set;
  for (const e of entries) {
    if (e.from !== "cli")
      oracleKeys.add(`${e.to}\x00${e.msg}`);
  }
  return entries.filter((e) => e.from !== "cli" || !oracleKeys.has(`${e.to}\x00${e.msg}`)).map((e) => e.from === "cli" ? { ...e, from: resolveCliSender(e.msg) } : e);
}
function readLog() {
  return resolveUnknown(dedup(parseLog()));
}
var MAW_LOG_PATH, KNOWN_NAMES;
var init_maw_log = __esm(() => {
  MAW_LOG_PATH = join6(homedir4(), ".oracle", "maw-log.jsonl");
  KNOWN_NAMES = {
    neo: "neo-oracle",
    pulse: "pulse-oracle",
    hermes: "hermes-oracle",
    calliope: "calliope-oracle",
    nexus: "nexus-oracle",
    odin: "odin-oracle"
  };
});

// src/lib/feed.ts
function parseLine(line) {
  if (!line || !line.includes(" | "))
    return null;
  const parts = line.split(" | ").map((s) => s.trim());
  if (parts.length < 5)
    return null;
  const timestamp = parts[0];
  const oracle = parts[1];
  const host = parts[2];
  const event = parts[3];
  const project = parts[4];
  const rest = parts.slice(5).join(" | ");
  let sessionId = "";
  let message = "";
  const guiIdx = rest.indexOf(" \xBB ");
  if (guiIdx !== -1) {
    sessionId = rest.slice(0, guiIdx).trim();
    message = rest.slice(guiIdx + 3).trim();
  } else {
    sessionId = rest.trim();
  }
  const ts = new Date(timestamp.replace(" ", "T") + "+07:00").getTime();
  if (isNaN(ts))
    return null;
  return { timestamp, oracle, host, event, project, sessionId, message, ts };
}
function activeOracles(events, windowMs = 5 * 60000) {
  const cutoff = Date.now() - windowMs;
  const map = new Map;
  for (const e of events) {
    if (e.ts < cutoff)
      continue;
    const prev = map.get(e.oracle);
    if (!prev || e.ts > prev.ts)
      map.set(e.oracle, e);
  }
  return map;
}
function describeActivity(event) {
  switch (event.event) {
    case "PreToolUse": {
      const colonIdx = event.message.indexOf(":");
      const tool = colonIdx > 0 ? event.message.slice(0, colonIdx).trim() : event.message.split(" ")[0];
      const icon = TOOL_ICONS[tool] || "\uD83D\uDD27";
      const detail = colonIdx > 0 ? event.message.slice(colonIdx + 1).trim() : "";
      const short = detail.length > 60 ? detail.slice(0, 57) + "..." : detail;
      return short ? `${icon} ${tool}: ${short}` : `${icon} ${tool}`;
    }
    case "PostToolUse":
    case "PostToolUseFailure": {
      const ok = event.event === "PostToolUse";
      const tool = event.message.replace(/ [\u2713\u2717].*$/, "").trim() || "Tool";
      return ok ? `\u2713 ${tool} done` : `\u2717 ${tool} failed`;
    }
    case "UserPromptSubmit": {
      const short = event.message.length > 60 ? event.message.slice(0, 57) + "..." : event.message;
      return `\uD83D\uDCAC ${short || "New prompt"}`;
    }
    case "SubagentStart":
      return `\uD83E\uDD16 Subagent started`;
    case "SubagentStop":
      return `\uD83E\uDD16 Subagent done`;
    case "SessionStart":
      return `\uD83D\uDFE2 Session started`;
    case "SessionEnd":
      return `\u23F9 Session ended`;
    case "Stop": {
      const short = event.message.length > 60 ? event.message.slice(0, 57) + "..." : event.message;
      return `\u23F9 ${short || "Stopped"}`;
    }
    case "Notification":
      return `\uD83D\uDD14 ${event.message || "Notification"}`;
    default:
      return event.message || event.event;
  }
}
var TOOL_ICONS;
var init_feed = __esm(() => {
  TOOL_ICONS = {
    Bash: "\u26A1",
    Read: "\uD83D\uDCD6",
    Edit: "\u270F\uFE0F",
    Write: "\uD83D\uDCDD",
    Grep: "\uD83D\uDD0D",
    Glob: "\uD83D\uDCC2",
    Agent: "\uD83E\uDD16",
    WebFetch: "\uD83C\uDF10",
    WebSearch: "\uD83D\uDD0E"
  };
});

// src/anti-patterns.ts
var exports_anti_patterns = {};
__export(exports_anti_patterns, {
  runAntiPatternScan: () => runAntiPatternScan,
  formatScanResult: () => formatScanResult,
  detectZombies: () => detectZombies,
  detectIslands: () => detectIslands,
  cmdPulseScan: () => cmdPulseScan
});
import { readFileSync as readFileSync5, existsSync as existsSync2 } from "fs";
import { join as join7 } from "path";
import { homedir as homedir5 } from "os";
import { execSync } from "child_process";
function hoursAgo(ms) {
  return (Date.now() - ms) / (1000 * 60 * 60);
}
function daysAgo(ms) {
  return hoursAgo(ms) / 24;
}
function getLiveSessions() {
  try {
    const out = execSync("tmux list-sessions -F '#{session_name}'", { encoding: "utf-8", timeout: 5000 });
    return new Set(out.trim().split(`
`).filter(Boolean));
  } catch {
    return new Set;
  }
}
function getEnabledLoops() {
  const map = new Map;
  try {
    if (!existsSync2(LOOPS_PATH))
      return map;
    const data = JSON.parse(readFileSync5(LOOPS_PATH, "utf-8"));
    const loops = Array.isArray(data) ? data : data.loops || [];
    for (const loop of loops) {
      if (loop.enabled) {
        map.set(loop.oracle, (map.get(loop.oracle) || 0) + 1);
      }
    }
  } catch {}
  return map;
}
function getLastFeedEvents() {
  const map = new Map;
  try {
    if (!existsSync2(FEED_PATH))
      return map;
    const stat = __require("fs").statSync(FEED_PATH);
    const size = stat.size;
    const chunkSize = Math.min(size, 500000);
    const fd = __require("fs").openSync(FEED_PATH, "r");
    const buf = Buffer.alloc(chunkSize);
    __require("fs").readSync(fd, buf, 0, chunkSize, size - chunkSize);
    __require("fs").closeSync(fd);
    const lines = buf.toString("utf-8").split(`
`).filter(Boolean);
    for (const line of lines) {
      const event = parseLine(line);
      if (event) {
        map.set(event.oracle, event.ts);
      }
    }
  } catch {}
  return map;
}
function getRecentLogEntries(days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const entries = parseLog();
  return entries.filter((e) => {
    const ts = new Date(e.ts).getTime();
    return ts > cutoff;
  });
}
function getRecentCommits(oracle, days) {
  try {
    const sessionName = ORACLE_SESSIONS[oracle];
    if (!sessionName)
      return 0;
    const ghqRoot = join7(homedir5(), "repos/github.com/BankCurfew");
    const oracleName = oracle.charAt(0).toUpperCase() + oracle.slice(1);
    const repoPaths = [
      join7(ghqRoot, `${oracleName}-Oracle`),
      join7(ghqRoot, `${oracle}-oracle`)
    ];
    let total = 0;
    for (const repoPath of repoPaths) {
      try {
        if (!existsSync2(repoPath))
          continue;
        const out = execSync(`git -C "${repoPath}" log --since="${days} days ago" --oneline 2>/dev/null | wc -l`, { encoding: "utf-8", timeout: 5000 });
        total += parseInt(out.trim()) || 0;
      } catch {}
    }
    return total;
  } catch {
    return 0;
  }
}
function detectZombies() {
  const flags = [];
  const liveSessions = getLiveSessions();
  const enabledLoops = getEnabledLoops();
  const lastFeedEvents = getLastFeedEvents();
  const feedByKey = new Map;
  for (const [name, ts] of lastFeedEvents) {
    let key = name.replace("-Oracle", "").toLowerCase();
    key = FEED_NAME_ALIASES[key] || key;
    const existing = feedByKey.get(key) || 0;
    if (ts > existing)
      feedByKey.set(key, ts);
  }
  for (const oracle of EXPECTED_ORACLES) {
    const sessionName = ORACLE_SESSIONS[oracle];
    const hasSession = liveSessions.has(sessionName);
    const hasLoops = (enabledLoops.get(oracle) || 0) > 0;
    const lastActivity = feedByKey.get(oracle);
    if (!hasSession && !hasLoops)
      continue;
    if (!lastActivity) {
      if (hasLoops) {
        flags.push({
          type: "zombie",
          oracle,
          severity: "critical",
          reasons: [`No feed activity recorded`, `${enabledLoops.get(oracle)} loops still enabled`],
          action: "Review and disable loops if oracle is not operational"
        });
      }
      continue;
    }
    const hours = hoursAgo(lastActivity);
    if (hours >= ZOMBIE_SEVERE_H && (hasSession || hasLoops)) {
      flags.push({
        type: "zombie",
        oracle,
        severity: "critical",
        reasons: [
          `No activity for ${Math.round(hours / 24)}d`,
          hasSession ? "tmux session alive" : "",
          hasLoops ? `${enabledLoops.get(oracle)} loops active` : ""
        ].filter(Boolean),
        action: "Auto-disable loops, flag for manual review"
      });
    } else if (hours >= ZOMBIE_CRITICAL_H && (hasSession || hasLoops)) {
      flags.push({
        type: "zombie",
        oracle,
        severity: "warning",
        reasons: [
          `No activity for ${Math.round(hours)}h`,
          hasLoops ? `${enabledLoops.get(oracle)} loops still running` : ""
        ].filter(Boolean),
        action: "Notify Bob to check oracle status"
      });
    } else if (hours >= ZOMBIE_WARNING_H && hasLoops) {
      flags.push({
        type: "zombie",
        oracle,
        severity: "notice",
        reasons: [`No activity for ${Math.round(hours)}h`, `${enabledLoops.get(oracle)} loops enabled`]
      });
    }
  }
  return flags;
}
function detectIslands() {
  const flags = [];
  const logEntries = getRecentLogEntries(ISLAND_COMMS_DAYS);
  const lastFeedEvents = getLastFeedEvents();
  const feedByKey = new Map;
  for (const [name, ts] of lastFeedEvents) {
    let key = name.replace("-Oracle", "").toLowerCase();
    key = FEED_NAME_ALIASES[key] || key;
    const existing = feedByKey.get(key) || 0;
    if (ts > existing)
      feedByKey.set(key, ts);
  }
  for (const oracle of EXPECTED_ORACLES) {
    const lastActivity = feedByKey.get(oracle);
    if (!lastActivity || hoursAgo(lastActivity) > ZOMBIE_CRITICAL_H)
      continue;
    const reasons = [];
    let criteriaCount = 0;
    const oracleVariants = new Set([oracle, `${oracle}-oracle`]);
    if (oracle === "doc") {
      oracleVariants.add("doccon");
      oracleVariants.add("doccon-oracle");
    }
    const sessionPrefix = ORACLE_SESSIONS[oracle];
    const bobMessages = logEntries.filter((e) => {
      const to = (e.to || "").toLowerCase();
      if (to !== "bob" && to !== "bob-oracle")
        return false;
      if (sessionPrefix && (e.target || "").startsWith(sessionPrefix))
        return true;
      const msg = (e.msg || "").toLowerCase();
      const oracleTitleCase = oracle.charAt(0).toUpperCase() + oracle.slice(1);
      return msg.includes(`${oracleTitleCase}-Oracle`) || msg.includes(`from ${oracle}`) || msg.includes(`cc: ${oracle}`);
    });
    const tasksDone = logEntries.filter((e) => {
      const to = (e.to || "").replace("-oracle", "").toLowerCase();
      if (!oracleVariants.has(to) && !oracleVariants.has((e.to || "").toLowerCase()))
        return false;
      const msg = (e.msg || "").toLowerCase();
      return msg.includes("done") || msg.includes("\u0E40\u0E2A\u0E23\u0E47\u0E08") || msg.includes("complete");
    });
    if (tasksDone.length >= ISLAND_TASKS_NO_CC && bobMessages.length === 0) {
      reasons.push(`${tasksDone.length} task completions but 0 cc bob`);
      criteriaCount++;
    }
    const messagesReceived = logEntries.filter((e) => {
      const to = (e.to || "").replace("-oracle", "").toLowerCase();
      return oracleVariants.has(to) || oracleVariants.has((e.to || "").toLowerCase());
    });
    const messagesSent = logEntries.filter((e) => {
      const sessionPrefix2 = ORACLE_SESSIONS[oracle];
      if (sessionPrefix2 && (e.target || "").startsWith(sessionPrefix2))
        return true;
      const msg = (e.msg || "").toLowerCase();
      const oracleTitleCase = oracle.charAt(0).toUpperCase() + oracle.slice(1);
      return msg.includes(`${oracleTitleCase}-Oracle`) || msg.includes(`from ${oracle}`) || msg.includes(`\u2014 ${oracle}`);
    });
    const recentReceived = messagesReceived.filter((e) => daysAgo(new Date(e.ts).getTime()) <= ISLAND_THREAD_DAYS);
    const recentSent = messagesSent.filter((e) => daysAgo(new Date(e.ts).getTime()) <= ISLAND_THREAD_DAYS);
    if (recentReceived.length === 0 && recentSent.length === 0) {
      reasons.push(`No cross-oracle comms in ${ISLAND_THREAD_DAYS}d`);
      criteriaCount++;
    }
    const recentCommits = getRecentCommits(oracle, ISLAND_COMMS_DAYS);
    if (recentCommits > ISLAND_COMMITS_NO_LINK) {
      reasons.push(`${recentCommits} commits in ${ISLAND_COMMS_DAYS}d (verify task links)`);
    }
    if (criteriaCount >= 2) {
      flags.push({ type: "island", oracle, severity: "warning", reasons });
    } else if (criteriaCount === 1) {
      flags.push({ type: "island", oracle, severity: "notice", reasons });
    }
    if (messagesReceived.length === 0 && messagesSent.length === 0 && lastActivity && daysAgo(lastActivity) <= 2) {
      flags.push({
        type: "island",
        oracle,
        severity: "critical",
        reasons: [`Active oracle with ZERO cross-oracle communication in ${ISLAND_COMMS_DAYS}d`],
        action: "Escalate to Bob \u2014 oracle may be working in isolation"
      });
    }
  }
  return flags;
}
function runAntiPatternScan() {
  const zombies = detectZombies();
  const islands = detectIslands();
  const parasites = [];
  const clones = [];
  return {
    timestamp: new Date().toISOString(),
    zombies,
    islands,
    parasites,
    clones,
    total: zombies.length + islands.length + parasites.length + clones.length
  };
}
function formatScanResult(result) {
  const lines = [];
  lines.push(`\x1B[36m\uD83C\uDFE5 ANTI-PATTERN SCAN\x1B[0m \u2014 ${result.timestamp.split("T")[0]}`);
  lines.push("\u2501".repeat(50));
  const sections = [
    ["zombie", result.zombies],
    ["island", result.islands],
    ["parasite", result.parasites],
    ["clone", result.clones]
  ];
  for (const [type, flags] of sections) {
    const emoji = EMOJI[type];
    const label = type.charAt(0).toUpperCase() + type.slice(1) + "s";
    if (flags.length === 0) {
      lines.push(`${emoji} ${label} (0): \x1B[32mnone\x1B[0m`);
    } else {
      lines.push(`${emoji} ${label} (${flags.length}):`);
      for (const flag of flags) {
        const color = SEVERITY_COLOR[flag.severity];
        const severityTag = `${color}${flag.severity.toUpperCase()}\x1B[0m`;
        lines.push(`   ${severityTag} ${flag.oracle} \u2014 ${flag.reasons.join(", ")}`);
        if (flag.action) {
          lines.push(`     \u2192 ${flag.action}`);
        }
      }
    }
  }
  lines.push("\u2501".repeat(50));
  if (result.total === 0) {
    lines.push(`\x1B[32m\u2713 All clear \u2014 no anti-patterns detected\x1B[0m`);
  } else {
    const critical = [...result.zombies, ...result.islands, ...result.parasites, ...result.clones].filter((f) => f.severity === "critical").length;
    lines.push(`Total: ${result.total} issue${result.total > 1 ? "s" : ""}${critical > 0 ? ` \u2014 \x1B[31m${critical} critical\x1B[0m` : ""}`);
  }
  return lines.join(`
`);
}
function cmdPulseScan(opts) {
  const result = runAntiPatternScan();
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatScanResult(result));
  }
}
var __dirname = "/home/mbank/maw-js/src", FEED_PATH, LOOPS_PATH, LOW_COMMIT_ROLES, FEED_NAME_ALIASES, ZOMBIE_WARNING_H = 24, ZOMBIE_CRITICAL_H = 48, ZOMBIE_SEVERE_H = 168, ISLAND_THREAD_DAYS = 7, ISLAND_COMMS_DAYS = 14, ISLAND_TASKS_NO_CC = 3, ISLAND_COMMITS_NO_LINK = 5, EMOJI, SEVERITY_COLOR;
var init_anti_patterns = __esm(() => {
  init_oracle_health();
  init_maw_log();
  init_feed();
  FEED_PATH = join7(homedir5(), ".oracle", "feed.log");
  LOOPS_PATH = join7(__dirname, "../loops.json");
  LOW_COMMIT_ROLES = new Set(["hr", "doc", "researcher", "editor"]);
  FEED_NAME_ALIASES = {
    doccon: "doc",
    "doccon-oracle": "doc",
    bob: "bob"
  };
  EMOJI = {
    zombie: "\uD83E\uDDDF",
    island: "\uD83C\uDFDD\uFE0F",
    parasite: "\uD83E\uDDA0",
    clone: "\uD83E\uDDEC"
  };
  SEVERITY_COLOR = {
    notice: "\x1B[33m",
    warning: "\x1B[38;5;208m",
    critical: "\x1B[31m"
  };
});

// src/token-index.ts
import { readdirSync as readdirSync8, readFileSync as readFileSync10, writeFileSync as writeFileSync5, existsSync as existsSync7, statSync } from "fs";
import { join as join15, basename as basename2 } from "path";
import { homedir as homedir10 } from "os";
import { execSync as execSync2 } from "child_process";
function projectName(dirName) {
  const parts = dirName.split("-");
  const comIdx = parts.lastIndexOf("com");
  if (comIdx >= 0 && parts.length > comIdx + 2) {
    return parts.slice(comIdx + 2).join("-");
  }
  return dirName.slice(0, 30);
}
function scanSession(filePath) {
  try {
    const raw = readFileSync10(filePath, "utf-8");
    let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheCreate = 0, turns = 0;
    let firstTs = "", lastTs = "";
    for (const line of raw.split(`
`)) {
      if (!line)
        continue;
      try {
        const d = JSON.parse(line);
        if (d.type === "assistant" && d.message?.usage) {
          const u = d.message.usage;
          inputTokens += u.input_tokens || 0;
          outputTokens += u.output_tokens || 0;
          cacheRead += u.cache_read_input_tokens || 0;
          cacheCreate += u.cache_creation_input_tokens || 0;
          turns++;
          const ts = d.timestamp || "";
          if (!firstTs || ts < firstTs)
            firstTs = ts;
          if (!lastTs || ts > lastTs)
            lastTs = ts;
        }
      } catch {}
    }
    if (turns === 0)
      return null;
    return { sessionId: basename2(filePath, ".jsonl"), inputTokens, outputTokens, cacheRead, cacheCreate, turns, firstTs, lastTs };
  } catch {
    return null;
  }
}
function loadIndex() {
  if (!existsSync7(INDEX_PATH))
    return { updatedAt: "", sessions: [] };
  try {
    return JSON.parse(readFileSync10(INDEX_PATH, "utf-8"));
  } catch {
    return { updatedAt: "", sessions: [] };
  }
}
function saveIndex(index) {
  writeFileSync5(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
}
function buildIndex(verbose = false) {
  const existing = loadIndex();
  const existingMap = new Map;
  for (const s of existing.sessions)
    existingMap.set(s.sessionId, s);
  const sessions = [];
  let scanned = 0, skipped = 0, total = 0;
  if (!existsSync7(CLAUDE_PROJECTS))
    return { updatedAt: new Date().toISOString(), sessions: [] };
  for (const projDir of readdirSync8(CLAUDE_PROJECTS)) {
    const projPath = join15(CLAUDE_PROJECTS, projDir);
    if (!statSync(projPath).isDirectory())
      continue;
    const project = projectName(projDir);
    let files;
    try {
      files = readdirSync8(projPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      total++;
      const fp = join15(projPath, file);
      const sid = basename2(file, ".jsonl");
      const mtime = statSync(fp).mtimeMs;
      const prev = existingMap.get(sid);
      if (prev && prev.mtimeMs === mtime) {
        sessions.push(prev);
        skipped++;
        continue;
      }
      const result = scanSession(fp);
      if (result) {
        sessions.push({ ...result, project, mtimeMs: mtime });
        scanned++;
      }
    }
  }
  if (verbose) {
    console.log(`  scanned: ${scanned}, skipped: ${skipped}, total: ${total}`);
  }
  const index = { updatedAt: new Date().toISOString(), sessions };
  saveIndex(index);
  return index;
}
function summarize(index) {
  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheCreate = 0, totalTurns = 0;
  const byProject = new Map;
  const byDate = new Map;
  for (const s of index.sessions) {
    const inp = s.inputTokens + s.cacheRead;
    totalInput += inp;
    totalOutput += s.outputTokens;
    totalCacheRead += s.cacheRead;
    totalCacheCreate += s.cacheCreate;
    totalTurns += s.turns;
    const p = byProject.get(s.project) || { input: 0, output: 0, turns: 0 };
    p.input += inp;
    p.output += s.outputTokens;
    p.turns += s.turns;
    byProject.set(s.project, p);
    const date = s.lastTs?.slice(0, 10) || "unknown";
    const d = byDate.get(date) || { input: 0, output: 0, turns: 0 };
    d.input += inp;
    d.output += s.outputTokens;
    d.turns += s.turns;
    byDate.set(date, d);
  }
  return {
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheCreate,
    totalTurns,
    sessionCount: index.sessions.length,
    byProject: [...byProject.entries()].map(([project, v]) => ({ project, ...v })).sort((a, b) => b.input + b.output - (a.input + a.output)),
    byDate: [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => b.date.localeCompare(a.date))
  };
}
function realtimeRate(windowSeconds = 300) {
  const now = Date.now();
  const cached2 = _rateCache.get(windowSeconds);
  if (cached2 && now - cached2.ts < RATE_CACHE_TTL)
    return cached2.result;
  const cutoff = now - windowSeconds * 1000;
  const mmin = Math.ceil(windowSeconds / 60) + 1;
  let inputTokens = 0, outputTokens = 0, turns = 0;
  const byProject = new Map;
  if (!existsSync7(CLAUDE_PROJECTS))
    return emptyRate(windowSeconds);
  let recentFiles;
  try {
    const out = execSync2(`find ${CLAUDE_PROJECTS} -name "*.jsonl" -not -path "*/subagent*" -mmin -${mmin} 2>/dev/null`, { encoding: "utf-8", timeout: 3000 });
    recentFiles = out.trim().split(`
`).filter(Boolean);
  } catch {
    return emptyRate(windowSeconds);
  }
  for (const fp of recentFiles) {
    const parts = fp.replace(CLAUDE_PROJECTS + "/", "").split("/");
    const project = projectName(parts[0] || "unknown");
    try {
      const raw = readFileSync10(fp, "utf-8").slice(-200000);
      for (const line of raw.split(`
`)) {
        if (!line || line[0] !== "{")
          continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== "assistant" || !d.timestamp)
            continue;
          const ts = new Date(d.timestamp).getTime();
          if (isNaN(ts) || ts < cutoff)
            continue;
          const u = d.message?.usage;
          if (!u)
            continue;
          const inp = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
          const out = u.output_tokens || 0;
          inputTokens += inp;
          outputTokens += out;
          turns++;
          const p = byProject.get(project) || { input: 0, output: 0, turns: 0 };
          p.input += inp;
          p.output += out;
          p.turns++;
          byProject.set(project, p);
        } catch {}
      }
    } catch {}
  }
  const minutes = windowSeconds / 60;
  const totalTokens = inputTokens + outputTokens;
  const result = {
    windowSeconds,
    inputTokens,
    outputTokens,
    totalTokens,
    inputPerMin: Math.round(inputTokens / minutes),
    outputPerMin: Math.round(outputTokens / minutes),
    totalPerMin: Math.round(totalTokens / minutes),
    turns,
    byProject: [...byProject.entries()].map(([project, v]) => ({ project, ...v })).sort((a, b) => b.input + b.output - (a.input + a.output))
  };
  _rateCache.set(windowSeconds, { ts: now, result });
  return result;
}
function emptyRate(windowSeconds) {
  return { windowSeconds, inputTokens: 0, outputTokens: 0, totalTokens: 0, inputPerMin: 0, outputPerMin: 0, totalPerMin: 0, turns: 0, byProject: [] };
}
var CLAUDE_PROJECTS, INDEX_PATH, _rateCache, RATE_CACHE_TTL = 15000;
var init_token_index = __esm(() => {
  CLAUDE_PROJECTS = join15(homedir10(), ".claude", "projects");
  INDEX_PATH = join15(homedir10(), ".oracle", "token-index.json");
  _rateCache = new Map;
});

// package.json
var require_package = __commonJS((exports, module) => {
  module.exports = {
    name: "maw",
    version: "1.1.0",
    type: "module",
    bin: {
      maw: "./src/cli.ts"
    },
    scripts: {
      "build:office": "cd $HOME/repos/github.com/BankCurfew/office-v2 && bun run build && cp -r dist/* $HOME/maw-js/dist-office/",
      "build:cf": "cd office && bunx vite build --base / --outDir ../dist-cf",
      "deploy:cf": "bun run build:cf && bunx wrangler deploy",
      dev: `pm2 start ecosystem.config.cjs && echo '\u2192 maw backend (watch src/) on :3456
\u2192 maw-dev vite HMR on :5173
\u2192 pm2 logs to follow'`,
      "dev:office": "cd $HOME/repos/github.com/BankCurfew/office-v2 && bunx vite",
      "dev:stop": "pm2 delete maw maw-dev 2>/dev/null; echo '\u2192 dev stopped'",
      deploy: "bun install && bun run build:office && pm2 delete maw-dev 2>/dev/null; pm2 restart maw",
      "build:8bit": "cd office-8bit && bash build.sh",
      "deploy:remote": "bun run build:office && rsync -az dist-office/ white.local:~/Code/github.com/Soul-Brews-Studio/maw-js/dist-office/ && rsync -az dist-8bit-office/ white.local:~/Code/github.com/Soul-Brews-Studio/maw-js/dist-8bit-office/ && rsync -az src/ white.local:~/Code/github.com/Soul-Brews-Studio/maw-js/src/ && ssh white.local 'export PATH=$HOME/.bun/bin:$PATH && pm2 restart maw' && echo '\u2192 deployed to white.local:3456'"
    },
    description: "maw.js \u2014 Multi-Agent Workflow in Bun/TS. Remote tmux orchestra control. CLI + Web UI.",
    dependencies: {
      "@monaco-editor/react": "^4.7.0",
      "@xterm/addon-fit": "^0.10.0",
      "@xterm/addon-web-links": "^0.12.0",
      "@xterm/xterm": "^5.5.0",
      hono: "^4.12.5",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      three: "^0.183.2",
      zustand: "^5.0.11"
    },
    devDependencies: {
      "@resvg/resvg-js": "^2.6.2",
      "@tailwindcss/vite": "^4.2.1",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@types/three": "^0.183.1",
      "@vitejs/plugin-react": "^4.3.0",
      tailwindcss: "^4.2.1",
      vite: "^6.0.0"
    }
  };
});

// src/task-log.ts
import { readFileSync as readFileSync11, appendFileSync as appendFileSync4, existsSync as existsSync8, mkdirSync as mkdirSync5, readdirSync as readdirSync9 } from "fs";
import { join as join17 } from "path";
function ensureDir() {
  if (!existsSync8(LOG_DIR))
    mkdirSync5(LOG_DIR, { recursive: true });
}
function logPath(taskId) {
  const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join17(LOG_DIR, `${safe}.jsonl`);
}
function appendActivity(activity) {
  ensureDir();
  const ts = new Date().toISOString();
  const id = `${ts.replace(/[:.]/g, "-")}-${activity.oracle || "system"}`;
  const full = { ...activity, id, ts };
  appendFileSync4(logPath(activity.taskId), JSON.stringify(full) + `
`, "utf-8");
  return full;
}
function readTaskLog(taskId) {
  const path = logPath(taskId);
  if (!existsSync8(path))
    return [];
  const lines = readFileSync11(path, "utf-8").split(`
`).filter(Boolean);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}
function getTaskLogSummary(taskId) {
  const activities = readTaskLog(taskId);
  if (activities.length === 0)
    return null;
  const last = activities[activities.length - 1];
  const contributors = [...new Set(activities.map((a) => a.oracle).filter(Boolean))];
  const hasBlockers = activities.some((a) => a.type === "blocker" && !a.meta?.resolved);
  return {
    taskId,
    count: activities.length,
    lastActivity: last.ts,
    lastOracle: last.oracle,
    hasBlockers,
    contributors
  };
}
function getAllLogSummaries() {
  ensureDir();
  const summaries = {};
  try {
    const files = readdirSync9(LOG_DIR).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const taskId = file.replace(/\.jsonl$/, "");
      const summary = getTaskLogSummary(taskId);
      if (summary)
        summaries[taskId] = summary;
    }
  } catch {}
  return summaries;
}
var LOG_DIR;
var init_task_log = __esm(() => {
  LOG_DIR = join17(process.env.HOME || "/home/mbank", ".maw", "task-logs");
});

// src/autopilot.ts
import { join as join18 } from "path";
function routeTask(title) {
  const lower = title.toLowerCase();
  for (const rule of ROUTING_RULES) {
    if (rule.keywords.some((k) => lower.includes(k)))
      return rule.oracle;
  }
  return "dev";
}
async function getProjectMeta(owner, project) {
  if (cachedProjectMeta)
    return cachedProjectMeta;
  const projectJson = await ssh(`gh project view ${project} --owner ${owner} --format json`);
  const proj = JSON.parse(projectJson);
  const fieldsJson = await ssh(`gh project field-list ${project} --owner ${owner} --format json`);
  const fields = JSON.parse(fieldsJson);
  const statusField = fields.fields.find((f) => f.name === "Status");
  const options = {};
  for (const opt of statusField?.options || [])
    options[opt.name] = opt.id;
  cachedProjectMeta = { projectId: proj.id, statusFieldId: statusField?.id || "", options };
  return cachedProjectMeta;
}
async function setItemStatus(owner, project, itemId, status) {
  const meta = await getProjectMeta(owner, project);
  if (!meta.statusFieldId)
    return;
  const optionId = meta.options[status];
  if (!optionId)
    return;
  await ssh(`gh project item-edit --project-id '${meta.projectId}' --id '${itemId}' --field-id '${meta.statusFieldId}' --single-select-option-id '${optionId}'`);
}
async function commentResult(repo, issueNumber, resultSummary) {
  const escaped = resultSummary.replace(/'/g, "'\\''");
  await ssh(`gh issue comment ${issueNumber} --repo '${repo}' --body '${escaped}'`);
}
async function closeIssue(repo, issueNumber) {
  await ssh(`gh issue close ${issueNumber} --repo '${repo}' --reason completed`);
}
var FEED_LOG2, ORACLE_MAP, ROUTING_RULES, cachedProjectMeta = null;
var init_autopilot = __esm(() => {
  init_ssh();
  init_wake();
  init_config();
  FEED_LOG2 = join18(process.env.HOME || "/home/mbank", ".oracle", "feed.log");
  ORACLE_MAP = {
    bob: "BoB-Oracle",
    dev: "Dev-Oracle",
    qa: "QA-Oracle",
    researcher: "Researcher-Oracle",
    writer: "Writer-Oracle",
    designer: "Designer-Oracle",
    hr: "HR-Oracle"
  };
  ROUTING_RULES = [
    { keywords: ["code", "api", "feature", "implement", "build", "deploy", "rest", "backend", "frontend"], oracle: "dev" },
    { keywords: ["test", "qa", "quality", "bug", "fix", "suite"], oracle: "qa" },
    { keywords: ["research", "analyze", "benchmark", "compare", "competitor", "explore"], oracle: "researcher" },
    { keywords: ["write", "blog", "content", "document", "readme", "post", "article"], oracle: "writer" },
    { keywords: ["design", "ui", "ux", "mockup", "logo", "brand", "visual", "creative"], oracle: "designer" },
    { keywords: ["hire", "recruit", "onboard", "interview", "candidate", "guide", "people"], oracle: "hr" }
  ];
});

// src/board.ts
var exports_board = {};
__export(exports_board, {
  setFieldByName: () => setFieldByName,
  scanUntracked: () => scanUntracked,
  scanMine: () => scanMine,
  invalidateBoardCache: () => invalidateBoardCache,
  getTimelineData: () => getTimelineData,
  fetchFields: () => fetchFields,
  fetchBoardData: () => fetchBoardData,
  clearDate: () => clearDate,
  autoAssign: () => autoAssign,
  addItem: () => addItem,
  addField: () => addField
});
import { readFileSync as readFileSync12, writeFileSync as writeFileSync6, existsSync as existsSync9, mkdirSync as mkdirSync6 } from "fs";
import { join as join19 } from "path";
function getOwnerProject() {
  return { owner: OWNER, project: PROJECT };
}
async function getProjectMeta2() {
  if (cachedProjectMeta2)
    return cachedProjectMeta2;
  const { owner, project } = getOwnerProject();
  const projectJson = await ssh(`gh project view ${project} --owner ${owner} --format json`);
  const proj = JSON.parse(projectJson);
  const fields = await fetchFields(true);
  cachedProjectMeta2 = { projectId: proj.id, fields };
  return cachedProjectMeta2;
}
async function fetchBoardData(filter) {
  const now = Date.now();
  if (boardCache && now - boardCache.ts < BOARD_CACHE_TTL && !filter) {
    return boardCache.items;
  }
  const { owner, project } = getOwnerProject();
  const json = await ssh(`gh project item-list ${project} --owner ${owner} --format json --limit 100`);
  const data = JSON.parse(json);
  const rawItems = data.items || [];
  const items = rawItems.map((item, i) => ({
    id: item.id,
    index: i + 1,
    title: item.title || item.content?.title || "",
    status: item.status || "",
    oracle: item.oracle || "",
    priority: item.priority || "",
    client: item.client || "",
    startDate: item.startDate || item["start date"] || "",
    targetDate: item.targetDate || item["target date"] || "",
    content: {
      body: item.content?.body || "",
      number: item.content?.number || 0,
      repository: item.content?.repository || "",
      title: item.content?.title || "",
      type: item.content?.type || "",
      url: item.content?.url || ""
    }
  }));
  let filtered = items;
  if (filter) {
    const lower = filter.toLowerCase();
    filtered = items.filter((item) => item.title.toLowerCase().includes(lower) || item.oracle.toLowerCase().includes(lower) || item.status.toLowerCase().includes(lower) || item.priority.toLowerCase().includes(lower) || item.client.toLowerCase().includes(lower));
  }
  if (!filter) {
    boardCache = { items, ts: now };
  }
  return filtered;
}
function invalidateBoardCache() {
  boardCache = null;
}
async function fetchFields(force = false) {
  const now = Date.now();
  if (!force && fieldsCache && now - fieldsCache.ts < FIELDS_CACHE_TTL) {
    return fieldsCache.fields;
  }
  const { owner, project } = getOwnerProject();
  const json = await ssh(`gh project field-list ${project} --owner ${owner} --format json`);
  const data = JSON.parse(json);
  const fields = (data.fields || []).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    options: f.options?.map((o) => ({ id: o.id, name: o.name })) || undefined
  }));
  fieldsCache = { fields, ts: now };
  return fields;
}
async function setFieldByName(itemId, fieldName, value) {
  const meta = await getProjectMeta2();
  const field = meta.fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
  if (!field)
    throw new Error(`Field "${fieldName}" not found`);
  const isSingleSelect = field.type.includes("SingleSelect") || field.type === "single_select";
  const isDate = field.name.toLowerCase().includes("date");
  if (isSingleSelect && field.options) {
    const option = field.options.find((o) => o.name.toLowerCase() === value.toLowerCase());
    if (!option)
      throw new Error(`Option "${value}" not found for field "${fieldName}"`);
    await ssh(`gh project item-edit --project-id '${meta.projectId}' --id '${itemId}' --field-id '${field.id}' --single-select-option-id '${option.id}'`);
  } else if (isDate) {
    await ssh(`gh project item-edit --project-id '${meta.projectId}' --id '${itemId}' --field-id '${field.id}' --date '${value}'`);
  } else if (field.type === "number") {
    await ssh(`gh project item-edit --project-id '${meta.projectId}' --id '${itemId}' --field-id '${field.id}' --number ${value}`);
  } else {
    await ssh(`gh project item-edit --project-id '${meta.projectId}' --id '${itemId}' --field-id '${field.id}' --text '${value.replace(/'/g, "'\\''")}'`);
  }
  invalidateBoardCache();
}
async function addItem(title, opts) {
  const { owner, project } = getOwnerProject();
  const oracle = opts?.oracle || routeTask(title);
  const oracleName = ORACLE_MAP[oracle.toLowerCase()] || oracle;
  const repo = opts?.repo || `${owner}/${oracleName}`;
  const escapedTitle = title.replace(/'/g, "'\\''");
  const body = `Task added from BoB's Office Board.

Assigned to: ${oracleName}`;
  const escapedBody = body.replace(/'/g, "'\\''");
  const issueUrl = (await ssh(`gh issue create --repo '${repo}' --title '${escapedTitle}' --body '${escapedBody}'`)).trim();
  let itemId = "";
  try {
    itemId = (await ssh(`gh project item-add ${project} --owner ${owner} --url '${issueUrl}'`)).trim();
  } catch {}
  if (itemId && oracle) {
    try {
      await setFieldByName(itemId, "Oracle", oracle);
    } catch {}
  }
  if (itemId) {
    try {
      appendActivity({
        taskId: itemId,
        type: "note",
        oracle: "bob",
        content: `Task created: "${title}", assigned to ${oracleName}`
      });
    } catch {}
  }
  invalidateBoardCache();
  return { itemId, issueUrl };
}
async function clearDate(itemId, which) {
  const meta = await getProjectMeta2();
  const fieldName = which === "start" ? "Start Date" : "Target Date";
  const field = meta.fields.find((f) => f.name.toLowerCase() === fieldName.toLowerCase()) || meta.fields.find((f) => f.name.toLowerCase() === which.toLowerCase() + " date" || f.name.toLowerCase() === which.toLowerCase() + "date");
  if (!field)
    throw new Error(`Date field "${fieldName}" not found`);
  await ssh(`gh api graphql -f query='mutation { updateProjectV2ItemFieldValue(input: { projectId: "${meta.projectId}", itemId: "${itemId}", fieldId: "${field.id}", value: { date: null } }) { projectV2Item { id } } }'`);
  invalidateBoardCache();
}
async function scanUntracked() {
  const { owner } = getOwnerProject();
  const boardItems = await fetchBoardData();
  const boardTitles = new Set(boardItems.map((i) => i.title.toLowerCase()));
  const results = [];
  for (const [key, repoName] of Object.entries(ORACLE_MAP)) {
    const repo = `${owner}/${repoName}`;
    try {
      const issuesJson = await ssh(`gh issue list --repo '${repo}' --state open --json number,title,url,labels --limit 30`);
      const issues = JSON.parse(issuesJson);
      const untracked = issues.filter((i) => !boardTitles.has(i.title.toLowerCase())).map((i) => ({
        number: i.number,
        title: i.title,
        url: i.url,
        labels: i.labels.map((l) => l.name)
      }));
      if (untracked.length > 0) {
        results.push({ repo, issues: untracked });
      }
    } catch {}
  }
  return results;
}
async function scanMine() {
  const today = new Date().toISOString().slice(0, 10);
  const cachePath = join19(SCAN_MINE_CACHE_DIR, `scan-mine-${today}.json`);
  if (existsSync9(cachePath)) {
    try {
      const cached2 = JSON.parse(readFileSync12(cachePath, "utf-8"));
      if (Date.now() - cached2.ts < 300000)
        return cached2.results;
    } catch {}
  }
  const ghqRoot = loadConfig().ghqRoot;
  const results = [];
  for (const [key, repoName] of Object.entries(ORACLE_MAP)) {
    const repoPath = `${ghqRoot}/BankCurfew/${repoName}`;
    try {
      const log = await ssh(`git -C '${repoPath}' log --oneline --since='${today} 00:00:00' --format='%h|%s|%ai'`);
      const commits = log.split(`
`).filter(Boolean).map((line) => {
        const [hash, ...rest] = line.split("|");
        const message = rest.slice(0, -1).join("|");
        const date = rest[rest.length - 1] || "";
        return { hash, message, date };
      });
      if (commits.length > 0) {
        results.push({ oracle: key, oracleName: repoName, commits });
      }
    } catch {}
  }
  try {
    if (!existsSync9(SCAN_MINE_CACHE_DIR)) {
      mkdirSync6(SCAN_MINE_CACHE_DIR, { recursive: true });
    }
    writeFileSync6(cachePath, JSON.stringify({ ts: Date.now(), results }), "utf-8");
  } catch {}
  return results;
}
async function autoAssign(dryRun = false) {
  const items = await fetchBoardData();
  const assigned = [];
  const skipped = [];
  for (const item of items) {
    if (item.oracle)
      continue;
    const oracle = routeTask(item.title);
    if (!oracle) {
      skipped.push(item.title);
      continue;
    }
    if (!dryRun) {
      try {
        await setFieldByName(item.id, "Oracle", oracle);
        assigned.push({ itemId: item.id, title: item.title, oracle });
      } catch {
        skipped.push(item.title);
      }
    } else {
      assigned.push({ itemId: item.id, title: item.title, oracle });
    }
  }
  if (!dryRun)
    invalidateBoardCache();
  return { assigned, skipped };
}
async function getTimelineData(filter) {
  const items = await fetchBoardData(filter);
  const withDates = items.filter((i) => i.startDate || i.targetDate);
  if (withDates.length === 0)
    return [];
  const allDates = withDates.flatMap((i) => [i.startDate, i.targetDate].filter(Boolean));
  const minDate = new Date(Math.min(...allDates.map((d) => new Date(d).getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => new Date(d).getTime())));
  const totalSpan = Math.max(maxDate.getTime() - minDate.getTime(), 86400000);
  return withDates.map((item) => {
    const start = item.startDate ? new Date(item.startDate) : new Date(item.targetDate);
    const end = item.targetDate ? new Date(item.targetDate) : new Date(item.startDate);
    const startOffset = (start.getTime() - minDate.getTime()) / totalSpan * 100;
    const width = Math.max((end.getTime() - start.getTime()) / totalSpan * 100, 2);
    return {
      id: item.id,
      title: item.title,
      oracle: item.oracle,
      priority: item.priority,
      status: item.status,
      startDate: item.startDate,
      targetDate: item.targetDate,
      startOffset,
      width
    };
  });
}
async function addField(name, type) {
  const meta = await getProjectMeta2();
  await ssh(`gh api graphql -f query='mutation { addProjectV2Field(input: { projectId: "${meta.projectId}", dataType: ${type.toUpperCase()}, name: "${name.replace(/"/g, "\\\"")}" }) { projectV2Field { id } } }'`);
  fieldsCache = null;
  cachedProjectMeta2 = null;
}
var OWNER = "BankCurfew", PROJECT = 1, boardCache = null, BOARD_CACHE_TTL = 30000, fieldsCache = null, FIELDS_CACHE_TTL = 300000, cachedProjectMeta2 = null, SCAN_MINE_CACHE_DIR;
var init_board = __esm(() => {
  init_ssh();
  init_config();
  init_autopilot();
  init_task_log();
  SCAN_MINE_CACHE_DIR = join19(process.env.HOME || "/home/mbank", ".maw", "cache");
});

// src/commands/task-log.ts
var exports_task_log = {};
__export(exports_task_log, {
  cmdTaskShow: () => cmdTaskShow,
  cmdTaskLs: () => cmdTaskLs,
  cmdTaskLog: () => cmdTaskLog,
  cmdTaskComment: () => cmdTaskComment
});
async function resolveTaskId(ref) {
  const num = ref.replace(/^#/, "");
  if (/^\d+$/.test(num)) {
    try {
      const items = await fetchBoardData();
      const item = items.find((i) => i.content.number === +num);
      if (item)
        return { taskId: item.id, item };
    } catch {}
  }
  return { taskId: ref };
}
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
async function cmdTaskLog(args) {
  const ref = args[0];
  if (!ref) {
    console.error('usage: maw task log <issue#> "message" [--commit "hash msg"] [--blocker "desc"]');
    process.exit(1);
  }
  const { taskId, item } = await resolveTaskId(ref);
  let type = "note";
  let content = "";
  let meta;
  for (let i = 1;i < args.length; i++) {
    if (args[i] === "--commit" && args[i + 1]) {
      type = "commit";
      const commitStr = args[++i];
      const spaceIdx = commitStr.indexOf(" ");
      if (spaceIdx > 0) {
        meta = { commitHash: commitStr.slice(0, spaceIdx) };
        content = commitStr.slice(spaceIdx + 1);
      } else {
        meta = { commitHash: commitStr };
        content = commitStr;
      }
    } else if (args[i] === "--blocker" && args[i + 1]) {
      type = "blocker";
      content = args[++i];
    } else if (args[i] === "--status" && args[i + 1]) {
      type = "status_change";
      content = args[++i];
    } else if (!content) {
      content = args[i];
    }
  }
  if (!content) {
    console.error('usage: maw task log <issue#> "message"');
    process.exit(1);
  }
  const oracle = process.env.MAW_ORACLE || "cli";
  const activity = appendActivity({ taskId, type, oracle, content, meta });
  const label = item ? `#${item.content.number} ${item.title}` : taskId;
  console.log(`\x1B[32m\u2713\x1B[0m Logged ${type} on ${label}`);
  console.log(`  ${TYPE_ICONS[type]} ${content}`);
}
async function cmdTaskLs() {
  const summaries = getAllLogSummaries();
  let items = [];
  try {
    items = await fetchBoardData();
  } catch {
    console.error("\x1B[33m\u26A0\x1B[0m Could not fetch board data");
  }
  if (items.length === 0 && Object.keys(summaries).length === 0) {
    console.log("No tasks or activity logs found.");
    return;
  }
  console.log(`
\x1B[36mTask Board + Activity\x1B[0m
`);
  console.log(`  ${"#".padEnd(6)} ${"Title".padEnd(40)} ${"Oracle".padEnd(12)} ${"Status".padEnd(14)} ${"Logs".padEnd(6)} ${"Last"}`);
  console.log("  " + "\u2500".repeat(100));
  for (const item of items) {
    const summary = summaries[item.id];
    const logCount = summary ? String(summary.count) : "-";
    const lastTime = summary ? formatDate(summary.lastActivity) + " " + formatTime(summary.lastActivity) : "-";
    const blockerFlag = summary?.hasBlockers ? " \x1B[31m!\x1B[0m" : "";
    const num = item.content.number > 0 ? `#${item.content.number}` : "-";
    console.log(`  ${num.padEnd(6)} ${item.title.slice(0, 38).padEnd(40)} ${(item.oracle || "-").padEnd(12)} ${(item.status || "-").padEnd(14)} ${logCount.padEnd(6)} ${lastTime}${blockerFlag}`);
  }
  const boardIds = new Set(items.map((i) => i.id));
  const orphaned = Object.entries(summaries).filter(([id]) => !boardIds.has(id));
  if (orphaned.length > 0) {
    console.log(`
  \x1B[33mOrphaned logs:\x1B[0m`);
    for (const [id, s] of orphaned) {
      console.log(`  ${id.slice(0, 20).padEnd(22)} ${String(s.count).padEnd(6)} ${formatDate(s.lastActivity)} (${s.contributors.join(", ")})`);
    }
  }
  console.log();
}
async function cmdTaskComment(args) {
  const ref = args[0];
  const message = args[1];
  if (!ref || !message) {
    console.error('usage: maw task comment <issue#> "message"');
    process.exit(1);
  }
  const { taskId, item } = await resolveTaskId(ref);
  const oracle = process.env.MAW_ORACLE || "cli";
  appendActivity({ taskId, type: "comment", oracle, content: message });
  const label = item ? `#${item.content.number} ${item.title}` : taskId;
  console.log(`\x1B[32m\u2713\x1B[0m Comment on ${label}`);
  console.log(`  \x1B[34m\uD83D\uDCAC\x1B[0m \x1B[36m${oracle}\x1B[0m: ${message}`);
}
async function cmdTaskShow(args) {
  const ref = args[0];
  if (!ref) {
    console.error("usage: maw task show <issue#>");
    process.exit(1);
  }
  const { taskId, item } = await resolveTaskId(ref);
  const activities = readTaskLog(taskId);
  if (activities.length === 0) {
    console.log(`No activity log for ${ref}`);
    return;
  }
  const title = item ? `#${item.content.number} ${item.title}` : taskId;
  console.log(`
\x1B[36m${title}\x1B[0m`);
  if (item) {
    console.log(`  Status: ${item.status || "-"} | Oracle: ${item.oracle || "-"} | Priority: ${item.priority || "-"}`);
    if (item.content.url)
      console.log(`  ${item.content.url}`);
  }
  console.log();
  let lastDate = "";
  for (const a of activities) {
    const date = formatDate(a.ts);
    if (date !== lastDate) {
      console.log(`  \x1B[90m\u2500\u2500 ${date} \u2500\u2500\x1B[0m`);
      lastDate = date;
    }
    const icon = TYPE_ICONS[a.type] || "\xB7";
    const time = formatTime(a.ts);
    const oracle = a.oracle ? `\x1B[36m${a.oracle}\x1B[0m` : "";
    let extra = "";
    if (a.type === "commit" && a.meta?.commitHash) {
      extra = ` \x1B[33m${a.meta.commitHash}\x1B[0m`;
    }
    if (a.type === "blocker") {
      extra = a.meta?.resolved ? " \x1B[32m(resolved)\x1B[0m" : " \x1B[31m(open)\x1B[0m";
    }
    console.log(`  ${time}  ${icon} ${oracle} ${a.content}${extra}`);
  }
  const contributors = [...new Set(activities.map((a) => a.oracle).filter(Boolean))];
  console.log(`
  Contributors: ${contributors.join(", ")}`);
  console.log();
}
var TYPE_ICONS;
var init_task_log2 = __esm(() => {
  init_task_log();
  init_board();
  TYPE_ICONS = {
    message: "\x1B[34m\uD83D\uDCAC\x1B[0m",
    commit: "\x1B[32m\uD83D\uDCE6\x1B[0m",
    status_change: "\x1B[33m\uD83D\uDD04\x1B[0m",
    note: "\x1B[37m\uD83D\uDCDD\x1B[0m",
    blocker: "\x1B[31m\uD83D\uDEAB\x1B[0m",
    comment: "\x1B[34m\uD83D\uDDE8\x1B[0m"
  };
});

// src/projects.ts
import { readFileSync as readFileSync13, writeFileSync as writeFileSync7, existsSync as existsSync10, mkdirSync as mkdirSync7 } from "fs";
import { join as join20 } from "path";
function ensureDir2() {
  if (!existsSync10(MAW_DIR))
    mkdirSync7(MAW_DIR, { recursive: true });
}
function loadProjects() {
  ensureDir2();
  if (!existsSync10(PROJECTS_PATH))
    return { projects: [], _taskIndex: {} };
  try {
    const data = JSON.parse(readFileSync13(PROJECTS_PATH, "utf-8"));
    data._taskIndex = {};
    for (const p of data.projects) {
      for (const t of p.tasks) {
        data._taskIndex[t.taskId] = p.id;
      }
    }
    return data;
  } catch {
    return { projects: [], _taskIndex: {} };
  }
}
function saveProjects(data) {
  ensureDir2();
  const { _taskIndex, ...clean } = data;
  writeFileSync7(PROJECTS_PATH, JSON.stringify(clean, null, 2), "utf-8");
}
function createProject(id, name, description = "") {
  const data = loadProjects();
  if (data.projects.some((p) => p.id === id)) {
    throw new Error(`Project "${id}" already exists`);
  }
  const project = {
    id,
    name,
    description,
    tasks: [],
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  data.projects.push(project);
  saveProjects(data);
  return project;
}
function getProject(id) {
  return loadProjects().projects.find((p) => p.id === id);
}
function updateProject(id, updates) {
  const data = loadProjects();
  const project = data.projects.find((p) => p.id === id);
  if (!project)
    throw new Error(`Project "${id}" not found`);
  Object.assign(project, updates, { updatedAt: new Date().toISOString() });
  saveProjects(data);
  return project;
}
function addTaskToProject(projectId, taskId, parentTaskId) {
  const data = loadProjects();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project)
    throw new Error(`Project "${projectId}" not found`);
  for (const p of data.projects) {
    p.tasks = p.tasks.filter((t) => t.taskId !== taskId);
  }
  const maxOrder = project.tasks.length > 0 ? Math.max(...project.tasks.map((t) => t.order)) : 0;
  project.tasks.push({ taskId, parentTaskId, order: maxOrder + 1 });
  project.updatedAt = new Date().toISOString();
  saveProjects(data);
}
function removeTaskFromProject(projectId, taskId) {
  const data = loadProjects();
  const project = data.projects.find((p) => p.id === projectId);
  if (!project)
    throw new Error(`Project "${projectId}" not found`);
  project.tasks = project.tasks.filter((t) => t.taskId !== taskId && t.parentTaskId !== taskId);
  project.updatedAt = new Date().toISOString();
  saveProjects(data);
}
function getProjectTree(projectId) {
  const project = getProject(projectId);
  if (!project)
    return null;
  const sorted = [...project.tasks].sort((a, b) => a.order - b.order);
  const topLevel = sorted.filter((t) => !t.parentTaskId);
  const tree = topLevel.map((task) => ({
    task,
    subtasks: sorted.filter((t) => t.parentTaskId === task.taskId)
  }));
  const allChildIds = new Set(sorted.filter((t) => t.parentTaskId).map((t) => t.taskId));
  const allParentRefs = new Set(sorted.filter((t) => t.parentTaskId).map((t) => t.parentTaskId));
  const topLevelIds = new Set(topLevel.map((t) => t.taskId));
  for (const t of sorted) {
    if (t.parentTaskId && !topLevelIds.has(t.parentTaskId) && !allChildIds.has(t.taskId)) {
      tree.push({ task: t, subtasks: [] });
    }
  }
  return { project, tree };
}
function getProjectBoardData(boardItems) {
  const data = loadProjects();
  const boardMap = new Map(boardItems.map((i) => [i.id, i]));
  const assigned = new Set;
  const projects = data.projects.map((p) => ({
    ...p,
    enrichedTasks: p.tasks.sort((a, b) => a.order - b.order).map((t) => {
      assigned.add(t.taskId);
      return { ...t, boardItem: boardMap.get(t.taskId) };
    })
  }));
  const unassigned = boardItems.filter((i) => !assigned.has(i.id));
  return { projects, unassigned };
}
function autoGroupItems(boardItems) {
  const groups = {};
  for (const item of boardItems) {
    const title = item.title.toLowerCase();
    const repo = item.content.repository?.split("/").pop()?.toLowerCase() || "";
    let projectSlug = "general";
    const oracleMatch = title.match(/^(dev|qa|researcher|writer|designer|hr|bob):\s*/i);
    if (oracleMatch) {
      const rest = title.slice(oracleMatch[0].length);
      if (rest.includes("system optimization") || rest.includes("maintenance") || rest.includes("health"))
        projectSlug = "system-maintenance";
      else if (rest.includes("design system") || rest.includes("brand"))
        projectSlug = "design-system";
      else if (rest.includes("testing") || rest.includes("quality"))
        projectSlug = "quality-assurance";
      else if (rest.includes("okr") || rest.includes("onboarding") || rest.includes("performance"))
        projectSlug = "team-ops";
      else if (rest.includes("style guide") || rest.includes("content"))
        projectSlug = "content-strategy";
      else if (rest.includes("market research") || rest.includes("weekly"))
        projectSlug = "research";
      else
        projectSlug = `${oracleMatch[1].toLowerCase()}-tasks`;
    } else if (title.includes("bob's office") || title.includes("dashboard") || title.includes("board"))
      projectSlug = "bobs-office";
    else if (title.includes("pulse") || title.includes("cli"))
      projectSlug = "pulse-cli";
    else if (title.includes("oracle") || title.includes("agent"))
      projectSlug = "oracle-system";
    else if (title.includes("health") || title.includes("monitor"))
      projectSlug = "system-maintenance";
    else if (title.includes("knowledge") || title.includes("aia"))
      projectSlug = "knowledge-base";
    else if (repo && repo !== "general")
      projectSlug = repo;
    if (!groups[projectSlug])
      groups[projectSlug] = [];
    groups[projectSlug].push(item.id);
  }
  return groups;
}
function autoOrganize(boardItems) {
  const groups = autoGroupItems(boardItems);
  const data = loadProjects();
  const existing = new Set(data.projects.map((p) => p.id));
  const alreadyAssigned = new Set;
  for (const p of data.projects) {
    for (const t of p.tasks)
      alreadyAssigned.add(t.taskId);
  }
  const created = [];
  let moved = 0;
  const NAMES = {
    "bobs-office": "BoB's Office",
    "pulse-cli": "Pulse CLI",
    "oracle-system": "Oracle System",
    "system-maintenance": "System Maintenance",
    "design-system": "Design System",
    "quality-assurance": "Quality Assurance",
    "team-ops": "Team Operations",
    "content-strategy": "Content Strategy",
    research: "Research",
    "knowledge-base": "Knowledge Base",
    general: "General"
  };
  for (const [slug, taskIds] of Object.entries(groups)) {
    if (!existing.has(slug)) {
      const name = NAMES[slug] || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      data.projects.push({
        id: slug,
        name,
        description: "",
        tasks: [],
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      created.push(slug);
      existing.add(slug);
    }
    const project = data.projects.find((p) => p.id === slug);
    const maxOrder = project.tasks.length > 0 ? Math.max(...project.tasks.map((t) => t.order)) : 0;
    let order = maxOrder;
    for (const taskId of taskIds) {
      if (!alreadyAssigned.has(taskId)) {
        order++;
        project.tasks.push({ taskId, order });
        alreadyAssigned.add(taskId);
        moved++;
      }
    }
    if (order > maxOrder)
      project.updatedAt = new Date().toISOString();
  }
  saveProjects(data);
  return { created, moved };
}
var MAW_DIR, PROJECTS_PATH;
var init_projects = __esm(() => {
  MAW_DIR = join20(process.env.HOME || "/home/mbank", ".maw");
  PROJECTS_PATH = join20(MAW_DIR, "projects.json");
});

// src/commands/project.ts
var exports_project = {};
__export(exports_project, {
  cmdProjectShow: () => cmdProjectShow,
  cmdProjectSetStatus: () => cmdProjectSetStatus,
  cmdProjectRemove: () => cmdProjectRemove,
  cmdProjectLs: () => cmdProjectLs,
  cmdProjectCreate: () => cmdProjectCreate,
  cmdProjectComment: () => cmdProjectComment,
  cmdProjectAutoOrganize: () => cmdProjectAutoOrganize,
  cmdProjectAdd: () => cmdProjectAdd
});
function statusIcon(status) {
  if (status === "Done")
    return "\x1B[32m\u2713\x1B[0m";
  if (status === "In Progress")
    return "\x1B[33m\u25CF\x1B[0m";
  if (status === "Todo")
    return "\x1B[37m\u25CB\x1B[0m";
  return "\x1B[90m\xB7\x1B[0m";
}
function projectStatusColor(status) {
  if (status === "active")
    return "\x1B[32m";
  if (status === "completed")
    return "\x1B[36m";
  return "\x1B[90m";
}
async function resolveItem(ref) {
  const num = ref.replace(/^#/, "");
  if (/^\d+$/.test(num)) {
    const items = await fetchBoardData();
    return items.find((i) => i.content.number === +num);
  }
  return;
}
async function cmdProjectLs() {
  const data = loadProjects();
  let items = [];
  try {
    items = await fetchBoardData();
  } catch {}
  const boardMap = new Map(items.map((i) => [i.id, i]));
  if (data.projects.length === 0) {
    console.log('No projects yet. Use \x1B[36mmaw project create <id> "Name"\x1B[0m to create one.');
    console.log("Or use \x1B[36mmaw project auto-organize\x1B[0m to auto-group existing tasks.");
    return;
  }
  console.log(`
\x1B[36mProjects\x1B[0m
`);
  for (const project of data.projects) {
    const color = projectStatusColor(project.status);
    const taskCount = project.tasks.length;
    const topLevel = project.tasks.filter((t) => !t.parentTaskId);
    const subtaskCount = project.tasks.filter((t) => t.parentTaskId).length;
    let done = 0, inProgress = 0, todo = 0;
    for (const t of project.tasks) {
      const item = boardMap.get(t.taskId);
      if (!item)
        continue;
      if (item.status === "Done")
        done++;
      else if (item.status === "In Progress")
        inProgress++;
      else
        todo++;
    }
    const progress = taskCount > 0 ? Math.round(done / taskCount * 100) : 0;
    const progressBar = "\u2588".repeat(Math.round(progress / 10)) + "\u2591".repeat(10 - Math.round(progress / 10));
    console.log(`  ${color}${project.status.toUpperCase().padEnd(10)}\x1B[0m \x1B[1m${project.name}\x1B[0m \x1B[90m(${project.id})\x1B[0m`);
    console.log(`  ${" ".repeat(10)} ${taskCount} tasks (${topLevel.length} top + ${subtaskCount} sub) | \x1B[32m${done}\x1B[0m done \x1B[33m${inProgress}\x1B[0m wip \x1B[37m${todo}\x1B[0m todo`);
    console.log(`  ${" ".repeat(10)} [${progressBar}] ${progress}%`);
    if (project.description)
      console.log(`  ${" ".repeat(10)} \x1B[90m${project.description}\x1B[0m`);
    console.log();
  }
  const assigned = new Set;
  for (const p of data.projects)
    for (const t of p.tasks)
      assigned.add(t.taskId);
  const unassigned = items.filter((i) => !assigned.has(i.id));
  if (unassigned.length > 0) {
    console.log(`  \x1B[33m${unassigned.length} unassigned task${unassigned.length !== 1 ? "s" : ""}\x1B[0m \u2014 use \x1B[36mmaw project auto-organize\x1B[0m or \x1B[36mmaw project add <project> #<issue>\x1B[0m`);
    console.log();
  }
}
async function cmdProjectShow(args) {
  const projectId = args[0];
  if (!projectId) {
    console.error("usage: maw project show <project-id>");
    process.exit(1);
  }
  const tree = getProjectTree(projectId);
  if (!tree) {
    console.error(`Project "${projectId}" not found`);
    process.exit(1);
  }
  let items = [];
  try {
    items = await fetchBoardData();
  } catch {}
  const boardMap = new Map(items.map((i) => [i.id, i]));
  const { project } = tree;
  console.log(`
\x1B[36m${project.name}\x1B[0m \x1B[90m(${project.id})\x1B[0m`);
  if (project.description)
    console.log(`  ${project.description}`);
  console.log(`  Status: ${projectStatusColor(project.status)}${project.status}\x1B[0m | Tasks: ${project.tasks.length}`);
  console.log();
  for (const { task, subtasks } of tree.tree) {
    const item = boardMap.get(task.taskId);
    const num = item?.content.number ? `#${item.content.number}` : "";
    const title = item?.title || task.taskId;
    const oracle = item?.oracle ? `\x1B[36m${item.oracle}\x1B[0m` : "";
    const priority = item?.priority || "";
    const si = statusIcon(item?.status || "");
    const logSummary = getTaskLogSummary(task.taskId);
    const logBadge = logSummary ? ` \x1B[90m[${logSummary.count} logs]\x1B[0m` : "";
    console.log(`  ${si} ${num.padEnd(6)} ${title.slice(0, 50).padEnd(52)} ${oracle.padEnd(18)} ${priority}${logBadge}`);
    for (const sub of subtasks) {
      const subItem = boardMap.get(sub.taskId);
      const subNum = subItem?.content.number ? `#${subItem.content.number}` : "";
      const subTitle = subItem?.title || sub.taskId;
      const subOracle = subItem?.oracle ? `\x1B[36m${subItem.oracle}\x1B[0m` : "";
      const subSi = statusIcon(subItem?.status || "");
      const subLog = getTaskLogSummary(sub.taskId);
      const subBadge = subLog ? ` \x1B[90m[${subLog.count}]\x1B[0m` : "";
      console.log(`    \u2514\u2500 ${subSi} ${subNum.padEnd(6)} ${subTitle.slice(0, 46).padEnd(48)} ${subOracle.padEnd(18)} ${subBadge}`);
    }
  }
  console.log();
}
async function cmdProjectCreate(args) {
  const id = args[0];
  const name = args[1];
  if (!id || !name) {
    console.error('usage: maw project create <id> "Name" ["description"]');
    process.exit(1);
  }
  try {
    const project = createProject(id, name, args[2] || "");
    console.log(`\x1B[32m\u2713\x1B[0m Created project: \x1B[1m${project.name}\x1B[0m (${project.id})`);
  } catch (e) {
    console.error(`\x1B[31m\u2717\x1B[0m ${e.message}`);
    process.exit(1);
  }
}
async function cmdProjectAdd(args) {
  const projectId = args[0];
  const taskRef = args[1];
  if (!projectId || !taskRef) {
    console.error("usage: maw project add <project-id> #<issue> [--parent #<issue>]");
    process.exit(1);
  }
  let parentTaskId;
  for (let i = 2;i < args.length; i++) {
    if (args[i] === "--parent" && args[i + 1]) {
      const parentItem = await resolveItem(args[++i]);
      if (parentItem)
        parentTaskId = parentItem.id;
    }
  }
  const item = await resolveItem(taskRef);
  if (!item) {
    addTaskToProject(projectId, taskRef, parentTaskId);
    console.log(`\x1B[32m\u2713\x1B[0m Added ${taskRef} to project ${projectId}`);
    return;
  }
  try {
    addTaskToProject(projectId, item.id, parentTaskId);
    console.log(`\x1B[32m\u2713\x1B[0m Added #${item.content.number} "${item.title}" to project ${projectId}${parentTaskId ? " (as subtask)" : ""}`);
  } catch (e) {
    console.error(`\x1B[31m\u2717\x1B[0m ${e.message}`);
    process.exit(1);
  }
}
async function cmdProjectRemove(args) {
  const projectId = args[0];
  const taskRef = args[1];
  if (!projectId || !taskRef) {
    console.error("usage: maw project remove <project-id> #<issue>");
    process.exit(1);
  }
  const item = await resolveItem(taskRef);
  const taskId = item?.id || taskRef;
  try {
    removeTaskFromProject(projectId, taskId);
    const label = item ? `#${item.content.number}` : taskRef;
    console.log(`\x1B[32m\u2713\x1B[0m Removed ${label} from project ${projectId}`);
  } catch (e) {
    console.error(`\x1B[31m\u2717\x1B[0m ${e.message}`);
    process.exit(1);
  }
}
async function cmdProjectAutoOrganize() {
  let items = [];
  try {
    items = await fetchBoardData();
  } catch (e) {
    console.error(`\x1B[31m\u2717\x1B[0m Could not fetch board: ${e.message}`);
    process.exit(1);
  }
  const result = autoOrganize(items);
  if (result.created.length > 0) {
    console.log(`\x1B[32m\u2713\x1B[0m Created ${result.created.length} project(s): ${result.created.join(", ")}`);
  }
  if (result.moved > 0) {
    console.log(`\x1B[32m\u2713\x1B[0m Organized ${result.moved} task(s) into projects`);
  }
  if (result.created.length === 0 && result.moved === 0) {
    console.log("All tasks are already organized into projects.");
  }
}
async function cmdProjectComment(args) {
  const projectId = args[0];
  const message = args[1];
  if (!projectId || !message) {
    console.error('usage: maw project comment <project-id> "message"');
    process.exit(1);
  }
  const oracle = process.env.MAW_ORACLE || "cli";
  appendActivity({
    taskId: `project:${projectId}`,
    type: "comment",
    oracle,
    content: message
  });
  console.log(`\x1B[32m\u2713\x1B[0m Comment added to project ${projectId}`);
}
async function cmdProjectSetStatus(args, status) {
  const projectId = args[0];
  if (!projectId) {
    console.error(`usage: maw project ${status === "completed" ? "complete" : "archive"} <project-id>`);
    process.exit(1);
  }
  try {
    updateProject(projectId, { status });
    console.log(`\x1B[32m\u2713\x1B[0m Project "${projectId}" marked as ${status}`);
  } catch (e) {
    console.error(`\x1B[31m\u2717\x1B[0m ${e.message}`);
    process.exit(1);
  }
}
var init_project = __esm(() => {
  init_projects();
  init_board();
  init_task_log();
});

// src/commands/sovereign.ts
var exports_sovereign = {};
__export(exports_sovereign, {
  verifySovereignHealth: () => verifySovereignHealth,
  rollbackOracle: () => rollbackOracle,
  migrateOracle: () => migrateOracle,
  getSovereignStatus: () => getSovereignStatus,
  cmdSovereign: () => cmdSovereign
});
import { existsSync as existsSync11, mkdirSync as mkdirSync8, readdirSync as readdirSync10, lstatSync, symlinkSync as symlinkSync2, unlinkSync, renameSync as renameSync2, writeFileSync as writeFileSync8, rmSync, statSync as statSync2 } from "fs";
import { join as join21, resolve } from "path";
import { homedir as homedir12 } from "os";
import { execSync as execSync3 } from "child_process";
function repoToOracleName(repoDir) {
  return repoDir.replace(/-[Oo]racle$/, "").toLowerCase().replace(/[^a-z0-9-]/g, "");
}
function resolveOracleName(input) {
  const name = input.toLowerCase().replace(/-oracle$/i, "");
  return NAME_ALIASES[name] || name;
}
function getDirSize(dirPath) {
  try {
    const out = execSync3(`du -sh "${dirPath}" 2>/dev/null | cut -f1`, { encoding: "utf-8", timeout: 1e4 });
    return out.trim() || "?";
  } catch {
    return "?";
  }
}
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
function readSymlink(path) {
  try {
    const { readlinkSync } = __require("fs");
    return readlinkSync(path);
  } catch {
    return null;
  }
}
function findOracleRepos() {
  const ghqRoot = loadConfig().ghqRoot;
  const orgDir = join21(ghqRoot, GHQ_ORG);
  if (!existsSync11(orgDir))
    return [];
  return readdirSync10(orgDir).filter((d) => /(-[Oo]racle|arra-oracle)$/.test(d)).filter((d) => {
    try {
      return statSync2(join21(orgDir, d)).isDirectory();
    } catch {
      return false;
    }
  }).map((d) => ({
    name: repoToOracleName(d),
    repoPath: join21(orgDir, d),
    repoDir: d
  }));
}
function ensureSovereignDir(oracleName) {
  if (!existsSync11(SOVEREIGN_ROOT2)) {
    mkdirSync8(SOVEREIGN_ROOT2, { recursive: true });
  }
  try {
    execSync3(`chmod 700 "${SOVEREIGN_ROOT2}"`, { timeout: 5000 });
  } catch {}
  const gitignorePath = join21(SOVEREIGN_ROOT2, ".gitignore");
  if (!existsSync11(gitignorePath)) {
    writeFileSync8(gitignorePath, `# Sovereign oracle memory \u2014 never commit
*
`);
  }
  const dir = join21(SOVEREIGN_ROOT2, oracleName);
  mkdirSync8(dir, { recursive: true });
  try {
    execSync3(`chmod 700 "${dir}"`, { timeout: 5000 });
  } catch {}
  return dir;
}
function createBackup(sourcePath, oracleName) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = join21(homedir12(), ".oracle", "\u03C8-backup-migration");
  mkdirSync8(backupDir, { recursive: true });
  const backupPath = join21(backupDir, `${oracleName}-${ts}`);
  mkdirSync8(backupPath, { recursive: true });
  const excludes = BACKUP_EXCLUDE_DIRS.map((d) => `--exclude='${d}/'`).join(" ");
  execSync3(`rsync -a ${excludes} "${sourcePath}/" "${backupPath}/"`, { timeout: 300000 });
  return backupPath;
}
function copyDirRecursive(src, dest) {
  const excludes = BACKUP_EXCLUDE_DIRS.map((d) => `--exclude='${d}/'`).join(" ");
  execSync3(`rsync -a ${excludes} "${src}/" "${dest}/"`, { timeout: 300000 });
}
function getSovereignStatus() {
  const repos = findOracleRepos();
  const results = [];
  for (const { name, repoPath, repoDir } of repos) {
    const psiPath = join21(repoPath, "\u03C8");
    const sovereignPath = join21(SOVEREIGN_ROOT2, name);
    const status = {
      oracle: name,
      repoPath,
      sovereignPath
    };
    if (isSymlink(psiPath)) {
      const target = readSymlink(psiPath);
      if (target && existsSync11(resolve(repoPath, target))) {
        status.status = "sovereign";
        status.psiSize = getDirSize(sovereignPath);
        status.details = `symlink \u2192 ${target}`;
      } else {
        status.status = "broken-symlink";
        status.details = `broken \u2192 ${target}`;
      }
    } else if (existsSync11(psiPath)) {
      status.status = "legacy";
      status.psiSize = getDirSize(psiPath);
      status.details = "\u03C8/ is real directory inside repo";
    } else {
      if (existsSync11(sovereignPath)) {
        status.status = "partial";
        status.details = "sovereign dir exists but no symlink in repo";
      } else {
        status.status = "missing";
        status.details = "no \u03C8/ found";
      }
    }
    results.push(status);
  }
  return results;
}
function migrateOracle(oracleName, opts = {}) {
  const result = { oracle: oracleName, success: false, steps: [], errors: [] };
  const repos = findOracleRepos();
  const repo = repos.find((r) => r.name === oracleName);
  if (!repo) {
    result.errors.push(`Oracle "${oracleName}" not found in ${join21(loadConfig().ghqRoot, GHQ_ORG)}`);
    return result;
  }
  const psiPath = join21(repo.repoPath, "\u03C8");
  const sovereignPath = join21(SOVEREIGN_ROOT2, oracleName);
  try {
    const sessions = execSync3(`tmux list-sessions -F '#{session_name}' 2>/dev/null`, { encoding: "utf-8", timeout: 5000 });
    const active = sessions.trim().split(`
`).some((s) => s.toLowerCase().includes(oracleName));
    if (active) {
      if (!opts.force) {
        result.errors.push(`Active tmux session detected for ${oracleName} \u2014 stop with 'maw sleep ${oracleName}' before migrating, or use --force`);
        return result;
      }
      result.steps.push(`\u26A0\uFE0F Active session detected \u2014 proceeding with --force`);
    }
  } catch {}
  if (isSymlink(psiPath)) {
    const target = readSymlink(psiPath);
    if (target && existsSync11(resolve(repo.repoPath, target))) {
      result.steps.push(`Already sovereign (symlink \u2192 ${target})`);
      result.success = true;
      return result;
    } else {
      result.errors.push(`Broken symlink at ${psiPath} \u2192 ${target}. Use --force or rollback first.`);
      if (!opts.force)
        return result;
      result.steps.push("Removing broken symlink (--force)");
      if (!opts.dryRun)
        unlinkSync(psiPath);
    }
  }
  if (!existsSync11(psiPath)) {
    if (existsSync11(sovereignPath)) {
      result.steps.push(`Sovereign dir exists at ${sovereignPath} \u2014 creating symlink`);
      if (!opts.dryRun) {
        symlinkSync2(sovereignPath, psiPath);
      }
      result.success = true;
      return result;
    }
    result.steps.push(`No existing \u03C8/ \u2014 creating fresh sovereign structure`);
    if (!opts.dryRun) {
      ensureSovereignDir(oracleName);
      for (const dir of PSI_DIRS) {
        mkdirSync8(join21(sovereignPath, dir), { recursive: true });
      }
      symlinkSync2(sovereignPath, psiPath);
    }
    result.success = true;
    return result;
  }
  result.steps.push(`Backing up ${psiPath}`);
  if (!opts.dryRun) {
    try {
      result.backupPath = createBackup(psiPath, oracleName);
      result.steps.push(`Backup created at ${result.backupPath}`);
    } catch (e) {
      result.errors.push(`Backup failed: ${e.message}`);
      return result;
    }
  }
  result.steps.push(`Creating sovereign dir: ${sovereignPath}`);
  if (!opts.dryRun) {
    ensureSovereignDir(oracleName);
    for (const dir of PSI_DIRS) {
      mkdirSync8(join21(sovereignPath, dir), { recursive: true });
    }
  }
  result.steps.push(`Copying \u03C8/ contents to sovereign location`);
  if (!opts.dryRun) {
    try {
      copyDirRecursive(psiPath, sovereignPath);
    } catch (e) {
      result.errors.push(`Copy failed: ${e.message}. Backup at ${result.backupPath}`);
      return result;
    }
  }
  if (!opts.dryRun) {
    try {
      const excludeFind = BACKUP_EXCLUDE_DIRS.map((d) => `-not -path '*/${d}/*'`).join(" ");
      const srcCount = execSync3(`find "${psiPath}" -type f ${excludeFind} 2>/dev/null | wc -l`, { encoding: "utf-8", timeout: 30000 }).trim();
      const dstCount = execSync3(`find "${sovereignPath}" -type f ${excludeFind} 2>/dev/null | wc -l`, { encoding: "utf-8", timeout: 30000 }).trim();
      if (srcCount !== dstCount) {
        result.errors.push(`File count mismatch: source=${srcCount}, dest=${dstCount}. Aborting \u2014 backup at ${result.backupPath}`);
        return result;
      }
      result.steps.push(`Verified: ${srcCount} files copied`);
    } catch (e) {
      result.errors.push(`Verification failed: ${e.message}. Backup at ${result.backupPath}`);
      return result;
    }
  }
  result.steps.push(`Atomic swap: original \u03C8/ \u2192 symlink`);
  if (!opts.dryRun) {
    try {
      const tmpLink = psiPath + ".sovereign-tmp";
      try {
        unlinkSync(tmpLink);
      } catch {}
      symlinkSync2(sovereignPath, tmpLink);
      rmSync(psiPath, { recursive: true, force: true });
      renameSync2(tmpLink, psiPath);
    } catch (e) {
      try {
        unlinkSync(psiPath + ".sovereign-tmp");
      } catch {}
      result.errors.push(`Symlink creation failed: ${e.message}. Restore from backup: cp -a ${result.backupPath} ${psiPath}`);
      return result;
    }
  }
  if (!opts.dryRun) {
    if (isSymlink(psiPath) && existsSync11(psiPath)) {
      result.steps.push(`Symlink verified: ${psiPath} \u2192 ${sovereignPath}`);
    } else {
      result.errors.push(`Symlink verification failed! Restore: cp -a ${result.backupPath} ${psiPath}`);
      return result;
    }
  }
  result.success = true;
  return result;
}
function rollbackOracle(oracleName, opts = {}) {
  const result = { oracle: oracleName, success: false, steps: [], errors: [] };
  const repos = findOracleRepos();
  const repo = repos.find((r) => r.name === oracleName);
  if (!repo) {
    result.errors.push(`Oracle "${oracleName}" not found`);
    return result;
  }
  const psiPath = join21(repo.repoPath, "\u03C8");
  const sovereignPath = join21(SOVEREIGN_ROOT2, oracleName);
  if (!isSymlink(psiPath)) {
    if (existsSync11(psiPath)) {
      result.steps.push("Already legacy layout (\u03C8/ is real directory)");
      result.success = true;
      return result;
    }
    result.errors.push("No \u03C8/ exists at all \u2014 nothing to rollback");
    return result;
  }
  if (!existsSync11(sovereignPath)) {
    const backupDir = join21(homedir12(), ".oracle", "\u03C8-backup-migration");
    const backups = existsSync11(backupDir) ? readdirSync10(backupDir).filter((d) => d.startsWith(oracleName)) : [];
    if (backups.length > 0) {
      const latestBackup = join21(backupDir, backups.sort().pop());
      result.steps.push(`Sovereign dir missing \u2014 restoring from backup: ${latestBackup}`);
      if (!opts.dryRun) {
        unlinkSync(psiPath);
        execSync3(`cp -a "${latestBackup}" "${psiPath}"`, { timeout: 60000 });
      }
      result.success = true;
      return result;
    }
    result.errors.push(`No sovereign data at ${sovereignPath} and no backups found`);
    return result;
  }
  result.steps.push(`Removing symlink at ${psiPath}`);
  if (!opts.dryRun) {
    unlinkSync(psiPath);
  }
  result.steps.push(`Copying sovereign data back to ${psiPath}`);
  if (!opts.dryRun) {
    mkdirSync8(psiPath, { recursive: true });
    copyDirRecursive(sovereignPath, psiPath);
  }
  if (!opts.dryRun) {
    const srcCount = execSync3(`find "${sovereignPath}" -type f 2>/dev/null | wc -l`, { encoding: "utf-8", timeout: 30000 }).trim();
    const dstCount = execSync3(`find "${psiPath}" -type f 2>/dev/null | wc -l`, { encoding: "utf-8", timeout: 30000 }).trim();
    if (srcCount !== dstCount) {
      result.errors.push(`File count mismatch after rollback: sovereign=${srcCount}, repo=${dstCount}`);
      return result;
    }
    result.steps.push(`Verified: ${srcCount} files restored`);
  }
  result.steps.push(`Sovereign data preserved at ${sovereignPath} (manual cleanup if desired)`);
  result.success = true;
  return result;
}
function verifySovereignHealth() {
  const results = [];
  const repos = findOracleRepos();
  for (const { name, repoPath } of repos) {
    const psiPath = join21(repoPath, "\u03C8");
    const sovereignPath = join21(SOVEREIGN_ROOT2, name);
    if (isSymlink(psiPath)) {
      const target = readSymlink(psiPath);
      if (!target || !existsSync11(resolve(repoPath, target))) {
        results.push({ oracle: name, ok: false, issue: `Broken symlink \u2192 ${target}` });
      } else if (!existsSync11(join21(sovereignPath, "memory"))) {
        results.push({ oracle: name, ok: false, issue: "Sovereign dir missing memory/" });
      } else {
        results.push({ oracle: name, ok: true });
      }
    } else if (existsSync11(psiPath)) {
      results.push({ oracle: name, ok: true, issue: "Legacy layout (not migrated)" });
    } else {
      results.push({ oracle: name, ok: false, issue: "No \u03C8/ found" });
    }
  }
  const backupRepo = join21(homedir12(), ".oracle", "\u03C8-backup");
  if (existsSync11(backupRepo)) {
    try {
      const lastCommit = execSync3(`git -C "${backupRepo}" log -1 --format='%ct' 2>/dev/null`, { encoding: "utf-8", timeout: 5000 }).trim();
      const ageHours = (Date.now() / 1000 - parseInt(lastCommit)) / 3600;
      if (ageHours > 24) {
        results.push({ oracle: "_backup", ok: false, issue: `\u03C8-backup stale: ${Math.round(ageHours)}h old` });
      }
    } catch {}
  }
  return results;
}
function formatStatus(statuses) {
  const lines = [];
  lines.push(`\x1B[36m\uD83C\uDFDB\uFE0F  Oracle Sovereign Status\x1B[0m`);
  lines.push("\u2501".repeat(60));
  const sovereign = statuses.filter((s) => s.status === "sovereign");
  const legacy = statuses.filter((s) => s.status === "legacy");
  const broken = statuses.filter((s) => s.status === "broken-symlink");
  const partial = statuses.filter((s) => s.status === "partial");
  const missing = statuses.filter((s) => s.status === "missing");
  lines.push(`  \x1B[32m${sovereign.length} sovereign\x1B[0m | \x1B[33m${legacy.length} legacy\x1B[0m | \x1B[31m${broken.length} broken\x1B[0m | \x1B[90m${partial.length} partial, ${missing.length} missing\x1B[0m
`);
  for (const s of statuses) {
    const icon = s.status === "sovereign" ? "\x1B[32m\u2713\x1B[0m" : s.status === "legacy" ? "\x1B[33m\u25CB\x1B[0m" : s.status === "broken-symlink" ? "\x1B[31m\u2717\x1B[0m" : s.status === "partial" ? "\x1B[33m\u25D0\x1B[0m" : "\x1B[90m\xB7\x1B[0m";
    const size = s.psiSize ? ` (${s.psiSize})` : "";
    lines.push(`  ${icon} ${s.oracle.padEnd(16)} ${s.status.padEnd(16)}${size}`);
    if (s.details && (s.status === "broken-symlink" || s.status === "partial")) {
      lines.push(`    \x1B[90m${s.details}\x1B[0m`);
    }
  }
  lines.push(`
` + "\u2501".repeat(60));
  lines.push(`\x1B[90mSovereign root: ${SOVEREIGN_ROOT2}\x1B[0m`);
  if (legacy.length > 0) {
    lines.push(`
\x1B[33mTo migrate:\x1B[0m maw sovereign migrate <oracle>`);
    lines.push(`\x1B[33mMigrate all:\x1B[0m maw sovereign migrate --all`);
  }
  return lines.join(`
`);
}
function formatMigrationResult(result) {
  const lines = [];
  const icon = result.success ? "\x1B[32m\u2713\x1B[0m" : "\x1B[31m\u2717\x1B[0m";
  lines.push(`${icon} ${result.oracle}`);
  for (const step of result.steps) {
    lines.push(`  \x1B[32m\u2713\x1B[0m ${step}`);
  }
  for (const err of result.errors) {
    lines.push(`  \x1B[31m\u2717\x1B[0m ${err}`);
  }
  if (result.backupPath) {
    lines.push(`  \x1B[90mBackup: ${result.backupPath}\x1B[0m`);
  }
  return lines.join(`
`);
}
function formatVerifyResults(results) {
  const lines = [];
  lines.push(`\x1B[36m\uD83D\uDD0D Sovereign Health Check\x1B[0m`);
  lines.push("\u2501".repeat(50));
  const ok = results.filter((r) => r.ok && !r.issue);
  const warn = results.filter((r) => r.ok && r.issue);
  const fail = results.filter((r) => !r.ok);
  for (const r of results) {
    if (r.oracle === "_backup") {
      const icon2 = r.ok ? "\x1B[32m\u2713\x1B[0m" : "\x1B[31m\u2717\x1B[0m";
      lines.push(`  ${icon2} backup  ${r.issue || "OK"}`);
      continue;
    }
    const icon = !r.ok ? "\x1B[31m\u2717\x1B[0m" : r.issue ? "\x1B[33m\u25CB\x1B[0m" : "\x1B[32m\u2713\x1B[0m";
    lines.push(`  ${icon} ${r.oracle.padEnd(16)} ${r.issue || "OK"}`);
  }
  lines.push("\u2501".repeat(50));
  lines.push(`  \x1B[32m${ok.length} healthy\x1B[0m | \x1B[33m${warn.length} legacy\x1B[0m | \x1B[31m${fail.length} issues\x1B[0m`);
  return lines.join(`
`);
}
async function cmdSovereign(args) {
  const sub = args[0]?.toLowerCase();
  if (!sub || sub === "status" || sub === "ls") {
    const statuses = getSovereignStatus();
    console.log(formatStatus(statuses));
  } else if (sub === "migrate") {
    const target = args[1];
    const dryRun = args.includes("--dry-run");
    const force = args.includes("--force");
    if (!target) {
      console.error("usage: maw sovereign migrate <oracle> [--dry-run] [--force]");
      console.error("       maw sovereign migrate --all [--dry-run]");
      process.exit(1);
    }
    if (target === "--all") {
      console.log(`\x1B[36m\uD83C\uDFDB\uFE0F  Sovereign Migration \u2014 All Oracles\x1B[0m${dryRun ? " (DRY RUN)" : ""}
`);
      const repos = findOracleRepos();
      let migrated = 0, skipped = 0, failed = 0;
      for (const { name } of repos) {
        const result = migrateOracle(name, { dryRun, force });
        console.log(formatMigrationResult(result));
        if (result.success) {
          if (result.steps.some((s) => s.startsWith("Already")))
            skipped++;
          else
            migrated++;
        } else {
          failed++;
        }
      }
      console.log(`
${"\u2501".repeat(50)}`);
      console.log(`  \x1B[32m${migrated} migrated\x1B[0m | \x1B[90m${skipped} already sovereign\x1B[0m | \x1B[31m${failed} failed\x1B[0m`);
    } else {
      const oracleName = resolveOracleName(target);
      console.log(`\x1B[36m\uD83C\uDFDB\uFE0F  Sovereign Migration \u2014 ${oracleName}\x1B[0m${dryRun ? " (DRY RUN)" : ""}
`);
      const result = migrateOracle(oracleName, { dryRun, force });
      console.log(formatMigrationResult(result));
    }
  } else if (sub === "rollback") {
    const target = args[1];
    const dryRun = args.includes("--dry-run");
    if (!target) {
      console.error("usage: maw sovereign rollback <oracle> [--dry-run]");
      process.exit(1);
    }
    const oracleName = resolveOracleName(target);
    console.log(`\x1B[36m\uD83C\uDFDB\uFE0F  Sovereign Rollback \u2014 ${oracleName}\x1B[0m${dryRun ? " (DRY RUN)" : ""}
`);
    const result = rollbackOracle(oracleName, { dryRun });
    console.log(formatMigrationResult(result));
  } else if (sub === "verify" || sub === "health") {
    const results = verifySovereignHealth();
    console.log(formatVerifyResults(results));
  } else {
    console.error(`usage: maw sovereign <status|migrate|rollback|verify>`);
    console.error(`       maw sovereign status              Show migration status`);
    console.error(`       maw sovereign migrate <oracle>    Migrate oracle to sovereign`);
    console.error(`       maw sovereign migrate --all       Migrate all oracles`);
    console.error(`       maw sovereign rollback <oracle>   Restore original layout`);
    console.error(`       maw sovereign verify              Health check symlinks`);
    process.exit(1);
  }
}
var SOVEREIGN_ROOT2, GHQ_ORG = "BankCurfew", PSI_DIRS, BACKUP_EXCLUDE_DIRS, NAME_ALIASES;
var init_sovereign = __esm(() => {
  init_config();
  SOVEREIGN_ROOT2 = join21(homedir12(), ".oracle", "\u03C8");
  PSI_DIRS = [
    "inbox/handoff",
    "memory/learnings",
    "memory/retrospectives",
    "memory/resonance",
    "writing",
    "lab",
    "active",
    "archive",
    "outbox"
  ];
  BACKUP_EXCLUDE_DIRS = ["learn"];
  NAME_ALIASES = {
    doc: "doccon"
  };
});

// src/worktrees.ts
var exports_worktrees = {};
__export(exports_worktrees, {
  scanWorktrees: () => scanWorktrees,
  cleanupWorktree: () => cleanupWorktree
});
import { readdirSync as readdirSync11, readFileSync as readFileSync15 } from "fs";
import { join as join22 } from "path";
async function scanWorktrees() {
  const config = loadConfig();
  const ghqRoot = config.ghqRoot;
  const fleetDir = join22(import.meta.dir, "../fleet");
  let wtPaths = [];
  try {
    const raw = await ssh(`find ${ghqRoot} -maxdepth 4 -name '*.wt-*' -type d 2>/dev/null`);
    wtPaths = raw.split(`
`).filter(Boolean);
  } catch {}
  const sessions = await listSessions();
  const runningWindows = new Set;
  for (const s of sessions) {
    for (const w of s.windows) {
      runningWindows.add(w.name);
    }
  }
  const fleetWindows = new Map;
  try {
    for (const file of readdirSync11(fleetDir).filter((f) => f.endsWith(".json"))) {
      const cfg = JSON.parse(readFileSync15(join22(fleetDir, file), "utf-8"));
      for (const w of cfg.windows || []) {
        if (w.repo)
          fleetWindows.set(w.repo, file);
      }
    }
  } catch {}
  const results = [];
  for (const wtPath of wtPaths) {
    const dirName = wtPath.split("/").pop();
    const parts = dirName.split(".wt-");
    if (parts.length < 2)
      continue;
    const mainRepoName = parts[0];
    const wtName = parts[1];
    const relPath = wtPath.replace(ghqRoot + "/", "");
    const parentParts = relPath.split("/");
    parentParts.pop();
    const org = parentParts.join("/");
    const mainRepo = `${org}/${mainRepoName}`;
    const repo = `${org}/${dirName}`;
    let branch = "";
    try {
      branch = (await ssh(`git -C '${wtPath}' rev-parse --abbrev-ref HEAD 2>/dev/null`)).trim();
    } catch {
      branch = "unknown";
    }
    let tmuxWindow;
    const fleetFile = fleetWindows.get(repo);
    for (const s of sessions) {
      for (const w of s.windows) {
        const taskPart = wtName.replace(/^\d+-/, "");
        if (w.name.endsWith(`-${taskPart}`) || w.name === taskPart) {
          tmuxWindow = w.name;
        }
      }
    }
    const status = tmuxWindow ? "active" : "stale";
    results.push({
      path: wtPath,
      branch,
      repo,
      mainRepo,
      name: wtName,
      status,
      tmuxWindow,
      fleetFile
    });
  }
  const mainRepos = [...new Set(results.map((r) => r.mainRepo))];
  for (const mainRepo of mainRepos) {
    const mainPath = join22(ghqRoot, mainRepo);
    try {
      const prunable = await ssh(`git -C '${mainPath}' worktree list --porcelain 2>/dev/null | grep -A1 'prunable' | grep 'worktree' | sed 's/worktree //'`);
      for (const orphanPath of prunable.split(`
`).filter(Boolean)) {
        const existing = results.find((r) => r.path === orphanPath);
        if (existing) {
          existing.status = "orphan";
        } else {
          const dirName = orphanPath.split("/").pop() || "";
          results.push({
            path: orphanPath,
            branch: "(prunable)",
            repo: dirName,
            mainRepo,
            name: dirName,
            status: "orphan"
          });
        }
      }
    } catch {}
  }
  return results;
}
async function cleanupWorktree(wtPath) {
  const config = loadConfig();
  const ghqRoot = config.ghqRoot;
  const fleetDir = join22(import.meta.dir, "../fleet");
  const log = [];
  const dirName = wtPath.split("/").pop();
  const parts = dirName.split(".wt-");
  if (parts.length < 2) {
    log.push(`not a worktree: ${dirName}`);
    return log;
  }
  const mainRepoName = parts[0];
  const relPath = wtPath.replace(ghqRoot + "/", "");
  const parentParts = relPath.split("/");
  parentParts.pop();
  const org = parentParts.join("/");
  const mainPath = join22(ghqRoot, org, mainRepoName);
  const repo = `${org}/${dirName}`;
  const sessions = await listSessions();
  const wtName = parts[1];
  const taskPart = wtName.replace(/^\d+-/, "");
  for (const s of sessions) {
    for (const w of s.windows) {
      if (w.name.endsWith(`-${taskPart}`) || w.name === taskPart) {
        try {
          await ssh(`tmux kill-window -t '${s.name}:${w.name}'`);
          log.push(`killed window ${s.name}:${w.name}`);
        } catch {
          log.push(`window already closed: ${w.name}`);
        }
      }
    }
  }
  let branch = "";
  try {
    branch = (await ssh(`git -C '${wtPath}' rev-parse --abbrev-ref HEAD`)).trim();
  } catch {}
  try {
    await ssh(`git -C '${mainPath}' worktree remove '${wtPath}' --force`);
    await ssh(`git -C '${mainPath}' worktree prune`);
    log.push(`removed worktree ${dirName}`);
  } catch (e) {
    log.push(`worktree remove failed: ${e.message || e}`);
  }
  if (branch && branch !== "main" && branch !== "HEAD" && branch !== "unknown") {
    try {
      await ssh(`git -C '${mainPath}' branch -d '${branch}'`);
      log.push(`deleted branch ${branch}`);
    } catch {
      log.push(`branch ${branch} not deleted (may have unmerged changes)`);
    }
  }
  try {
    for (const file of readdirSync11(fleetDir).filter((f) => f.endsWith(".json"))) {
      const filePath = join22(fleetDir, file);
      const cfg = JSON.parse(readFileSync15(filePath, "utf-8"));
      const before = cfg.windows?.length || 0;
      cfg.windows = (cfg.windows || []).filter((w) => w.repo !== repo);
      if (cfg.windows.length < before) {
        const { writeFileSync: writeFileSync9 } = await import("fs");
        writeFileSync9(filePath, JSON.stringify(cfg, null, 2) + `
`);
        log.push(`removed from ${file}`);
      }
    }
  } catch {}
  return log;
}
var init_worktrees = __esm(() => {
  init_ssh();
  init_config();
});

// src/commands/board-done.ts
var exports_board_done = {};
__export(exports_board_done, {
  cmdBoardDone: () => cmdBoardDone
});
async function cmdBoardDone(args) {
  const issueArg = args[0]?.replace("#", "");
  const issueNum = parseInt(issueArg);
  const message = args.slice(1).join(" ") || undefined;
  if (!issueNum) {
    console.error('usage: maw board done #<issue> ["message"]');
    console.error('       e.g. maw board done #5 "\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E41\u0E25\u0E49\u0E27 \u2014 push commit abc"');
    process.exit(1);
  }
  console.log(`\x1B[36m\u26A1\x1B[0m Looking up issue #${issueNum} on board...`);
  let boardData;
  try {
    const res = await fetch("http://localhost:3456/api/project-board");
    if (!res.ok)
      throw new Error(`Board API returned ${res.status}`);
    boardData = await res.json();
  } catch (err) {
    console.error(`\x1B[31m\u2717\x1B[0m Cannot reach board API: ${err}`);
    process.exit(1);
  }
  let found = null;
  for (const proj of boardData.projects || []) {
    for (const task of proj.enrichedTasks || []) {
      const b = task.boardItem;
      if (b?.content?.number === issueNum) {
        found = { item: b, repo: b.content.repository || "" };
        break;
      }
    }
    if (found)
      break;
  }
  if (!found) {
    console.error(`\x1B[31m\u2717\x1B[0m Issue #${issueNum} not found on board`);
    process.exit(1);
  }
  const { item, repo } = found;
  console.log(`\x1B[90m  Found: "${item.title}" (${item.status}) in ${repo}\x1B[0m`);
  if (item.status === "Done") {
    console.log(`\x1B[33m\u26A0\x1B[0m Issue #${issueNum} is already Done`);
    return;
  }
  try {
    await setItemStatus("BankCurfew", 1, item.id, "Done");
    console.log(`\x1B[32m\u2713\x1B[0m Board status \u2192 Done`);
  } catch (err) {
    console.error(`\x1B[31m\u2717\x1B[0m Failed to update board: ${err}`);
  }
  if (message && repo) {
    try {
      await commentResult(repo, issueNum, message);
      console.log(`\x1B[32m\u2713\x1B[0m Commented on issue #${issueNum}`);
    } catch (err) {
      console.error(`\x1B[31m\u2717\x1B[0m Failed to comment: ${err}`);
    }
  }
  if (repo) {
    try {
      await closeIssue(repo, issueNum);
      console.log(`\x1B[32m\u2713\x1B[0m Closed issue #${issueNum} in ${repo}`);
    } catch (err) {
      console.error(`\x1B[31m\u2717\x1B[0m Failed to close issue: ${err}`);
    }
  }
  console.log(`
\x1B[32m\u2705 Done!\x1B[0m ${item.title}`);
}
var init_board_done = __esm(() => {
  init_autopilot();
});

// src/commands/think.ts
var exports_think = {};
__export(exports_think, {
  cmdThink: () => cmdThink,
  cmdReview: () => cmdReview
});
async function resolveTarget2(oracle) {
  const session = await detectSession(oracle);
  if (!session)
    return null;
  let windowName = `${oracle}-oracle`;
  try {
    const windows = await tmux.listWindows(session);
    const match = windows.find((w) => w.name.toLowerCase() === windowName.toLowerCase() || w.name.toLowerCase() === `${oracle.charAt(0).toUpperCase() + oracle.slice(1)}-Oracle`.toLowerCase());
    if (match)
      windowName = match.name;
  } catch {}
  const target = `${session}:${windowName}`;
  try {
    const cmd = await getPaneCommand(target);
    if (/claude|node/i.test(cmd))
      return { target, status: "ready" };
  } catch {}
  return null;
}
async function cmdThink(opts = {}) {
  const oracles = opts.oracles || Object.keys(ORACLE_REPOS);
  console.log(`
  \x1B[36mBoB's Office \u2014 Think Time\x1B[0m`);
  console.log(`  Asking ${oracles.length} oracles to scan and propose ideas
`);
  for (const oracle of oracles) {
    const repo = ORACLE_REPOS[oracle];
    if (!repo)
      continue;
    try {
      const { ssh: ssh2 } = await Promise.resolve().then(() => (init_ssh(), exports_ssh));
      await ssh2(`gh label create proposal --repo ${repo} --color 0e8a16 --description "Oracle initiative proposal" --force 2>/dev/null`);
    } catch {}
  }
  if (opts.dryRun) {
    for (const oracle of oracles) {
      console.log(`  \x1B[90m\u25CB\x1B[0m ${oracle} \u2014 would be asked to think`);
    }
    console.log(`
  \x1B[90m(dry run \u2014 no messages sent)\x1B[0m
`);
    return;
  }
  const results = await Promise.allSettled(oracles.map(async (oracle) => {
    const resolved = await resolveTarget2(oracle);
    if (!resolved) {
      console.log(`  \x1B[31m\u2717\x1B[0m ${oracle} \u2014 no active session`);
      return;
    }
    const prompt = THINK_PROMPTS[oracle];
    if (!prompt)
      return;
    console.log(`  \x1B[36m>>>\x1B[0m ${oracle} \u2014 thinking...`);
    await sendKeys(resolved.target, prompt);
    console.log(`  \x1B[32m\u2713\x1B[0m ${oracle} \u2014 prompt sent`);
  }));
  console.log(`
  \x1B[32mDone.\x1B[0m Oracles are scanning and creating proposal issues.`);
  console.log(`  Run \x1B[36mmaw review\x1B[0m to have BoB evaluate proposals.
`);
}
async function cmdReview() {
  const { ssh: ssh2 } = await Promise.resolve().then(() => (init_ssh(), exports_ssh));
  console.log(`
  \x1B[36mBoB's Office \u2014 Proposal Review\x1B[0m`);
  console.log(`  Scanning all oracle repos for proposals...
`);
  const proposals = [];
  for (const [oracle, repo] of Object.entries(ORACLE_REPOS)) {
    try {
      const json = await ssh2(`gh issue list --repo ${repo} --label proposal --state open --json number,title,body,url --limit 10`);
      const issues = JSON.parse(json);
      for (const issue of issues) {
        proposals.push({
          oracle,
          repo,
          number: issue.number,
          title: issue.title,
          body: (issue.body || "").slice(0, 500),
          url: issue.url
        });
        console.log(`  \x1B[33m\u25CF\x1B[0m ${oracle} #${issue.number}: ${issue.title}`);
      }
    } catch {}
  }
  if (proposals.length === 0) {
    console.log(`  \x1B[90mNo open proposals found.\x1B[0m`);
    console.log(`  Run \x1B[36mmaw think\x1B[0m first to ask oracles for ideas.
`);
    return;
  }
  console.log(`
  Found \x1B[33m${proposals.length}\x1B[0m proposals.`);
  writeProposalsToFeed(proposals);
  const bobResolved = await resolveTarget2("bob");
  if (!bobResolved) {
    console.log(`  \x1B[33m!\x1B[0m BoB not available \u2014 proposals sent to inbox for \u0E41\u0E1A\u0E07\u0E04\u0E4C to review directly.
`);
    return;
  }
  const summary = proposals.map((p) => `[${p.oracle}] #${p.number}: ${p.title}
${p.body.slice(0, 200)}...
${p.url}`).join(`

`);
  const bobPrompt = [
    `${proposals.length} proposals from the team are now in \u0E41\u0E1A\u0E07\u0E04\u0E4C's inbox for approval.`,
    `Review them and give your recommendation. For each: APPROVE or SKIP with reason.`,
    `If \u0E41\u0E1A\u0E07\u0E04\u0E4C approves any, use maw hey to dispatch: maw hey <oracle> "Execute your proposal: <title>"`,
    ``,
    `Proposals:`,
    summary
  ].join(`
`);
  console.log(`  \x1B[36m>>>\x1B[0m BoB reviewing in background...`);
  await sendKeys(bobResolved.target, bobPrompt);
  console.log(`  \x1B[32m\u2713\x1B[0m Proposals in inbox + BoB reviewing.
`);
}
function writeProposalsToFeed(proposals) {
  try {
    const { appendFileSync: appendFileSync5 } = __require("fs");
    const { join: join23 } = __require("path");
    const FEED_LOG3 = join23(process.env.HOME || "/home/mbank", ".oracle", "feed.log");
    const now = new Date;
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    for (const p of proposals) {
      const data = JSON.stringify({ oracle: p.oracle, title: p.title, url: p.url, body: p.body.slice(0, 300) });
      const line = `${ts} | BoB-Oracle | VuttiServer | Notification | BoB-Oracle | autopilot \xBB [proposal] ${data}
`;
      appendFileSync5(FEED_LOG3, line);
    }
    console.log(`  \x1B[32m\u2713\x1B[0m ${proposals.length} proposals sent to inbox.
`);
  } catch {}
}
var ORACLE_REPOS, THINK_PROMPTS;
var init_think = __esm(() => {
  init_ssh();
  init_wake();
  init_tmux();
  ORACLE_REPOS = {
    dev: "BankCurfew/Dev-Oracle",
    qa: "BankCurfew/QA-Oracle",
    designer: "BankCurfew/Designer-Oracle",
    researcher: "BankCurfew/Researcher-Oracle",
    writer: "BankCurfew/Writer-Oracle",
    hr: "BankCurfew/HR-Oracle"
  };
  THINK_PROMPTS = {
    dev: `Scan your recent work: git log -20, open issues, codebase state. As Dev-Oracle, propose ONE improvement or new initiative that would help BoB's Office. Think about: technical debt, missing features, performance, developer experience, architecture improvements. Create a GitHub issue in your repo with label "proposal" \u2014 title: clear action, body: what + why + estimated effort. Use: gh issue create --label proposal --title "..." --body "..."`,
    qa: `Scan your recent work: git log -20, open issues, test coverage. As QA-Oracle, propose ONE improvement. Think about: missing test coverage, quality gaps, process improvements, automation opportunities, testing infrastructure. Create a GitHub issue with label "proposal". Use: gh issue create --label proposal --title "..." --body "..."`,
    designer: `Scan your recent work: git log -20, open issues, design system state. As Designer-Oracle, propose ONE improvement. Think about: UX gaps, design system components needed, accessibility improvements, visual consistency, user research needs. Create a GitHub issue with label "proposal". Use: gh issue create --label proposal --title "..."  --body "..."`,
    researcher: `Scan your recent work: git log -20, open issues, research outputs. As Researcher-Oracle, propose ONE research initiative. Think about: competitor moves, technology trends, market gaps, benchmarking needs, knowledge gaps in the team. Create a GitHub issue with label "proposal". Use: gh issue create --label proposal --title "..." --body "..."`,
    writer: `Scan your recent work: git log -20, open issues, content state. As Writer-Oracle, propose ONE content initiative. Think about: documentation gaps, blog post ideas, style guide updates, content that would attract users, internal docs that need updating. Create a GitHub issue with label "proposal". Use: gh issue create --label proposal --title "..." --body "..."`,
    hr: `Scan your recent work: git log -20, open issues, team state. As HR-Oracle, propose ONE organizational improvement. Think about: team gaps, new oracle roles needed, onboarding improvements, skill development, cross-team collaboration, process inefficiencies. Create a GitHub issue with label "proposal". Use: gh issue create --label proposal --title "..." --body "..."`
  };
});

// src/commands/meeting.ts
var exports_meeting = {};
__export(exports_meeting, {
  cmdMeeting: () => cmdMeeting
});
function selectParticipants(goal, explicit) {
  if (explicit?.length) {
    return explicit.filter((o) => ORACLE_ROLES[o.toLowerCase()]).map((o) => o.toLowerCase());
  }
  const lower = goal.toLowerCase();
  const matched = Object.entries(ORACLE_ROLES).filter(([_, info]) => info.keywords.some((kw) => lower.includes(kw))).map(([oracle]) => oracle);
  return matched.length > 0 ? matched : ["dev"];
}
async function resolveTargets(oracles) {
  const results = [];
  await Promise.allSettled(oracles.map(async (oracle) => {
    const session = await detectSession(oracle);
    if (!session) {
      results.push({ oracle, target: "", status: "dead" });
      return;
    }
    let windowName = `${oracle}-oracle`;
    try {
      const windows = await tmux.listWindows(session);
      const match = windows.find((w) => w.name.toLowerCase() === windowName.toLowerCase() || w.name.toLowerCase() === `${oracle.charAt(0).toUpperCase() + oracle.slice(1)}-Oracle`.toLowerCase());
      if (match)
        windowName = match.name;
    } catch {}
    const target = `${session}:${windowName}`;
    try {
      const cmd = await getPaneCommand(target);
      if (/claude|node/i.test(cmd)) {
        results.push({ oracle, target, status: "ready" });
      } else if (/bash|zsh/i.test(cmd)) {
        results.push({ oracle, target, status: "dead" });
      } else {
        results.push({ oracle, target, status: "busy" });
      }
    } catch {
      results.push({ oracle, target, status: "dead" });
    }
  }));
  return results;
}
function makeMeetingMarker() {
  return `MTG-${Date.now().toString(36)}`;
}
async function askOracle(target, goal, allParticipants, timeoutMs) {
  const { oracle, target: tmuxTarget } = target;
  const role = ORACLE_ROLES[oracle]?.role || oracle;
  const others = allParticipants.filter((o) => o !== oracle).join(", ");
  const marker = makeMeetingMarker();
  const question = [
    `[${marker}] Meeting from BoB \u2014 Goal: "${goal}".`,
    `Team: ${others ? `you, ${others}` : "you"}.`,
    `You are ${oracle} (${role}).`,
    `Answer briefly (under 150 words): What would YOU do? What do you need from others?`
  ].join(" ");
  await sendKeys(tmuxTarget, question);
  await new Promise((r) => setTimeout(r, 8000));
  const start = Date.now();
  let lastCapture = "";
  let stableCount = 0;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const currentCapture = await capture(tmuxTarget, 80);
    if (currentCapture === lastCapture) {
      stableCount++;
      if (stableCount >= 2) {
        return extractResponseAfterMarker(currentCapture, marker);
      }
    } else {
      stableCount = 0;
    }
    lastCapture = currentCapture;
  }
  if (lastCapture) {
    return extractResponseAfterMarker(lastCapture, marker);
  }
  return "(timed out)";
}
function extractResponseAfterMarker(raw, marker) {
  const clean = stripAnsi(raw);
  const lines = clean.split(`
`);
  let markerIdx = -1;
  for (let i = 0;i < lines.length; i++) {
    if (lines[i].includes(marker)) {
      markerIdx = i;
      break;
    }
  }
  if (markerIdx === -1) {
    const meaningful = lines.filter((l) => l.trim() && !isPromptLine(l) && !isStatusBarLine(l));
    return meaningful.slice(-20).join(`
`).trim() || "(no response found)";
  }
  const questionPatterns = [
    marker,
    "Meeting from BoB",
    "Answer briefly",
    "What would YOU do",
    "What do you need from others",
    "You are",
    "Team:",
    "Goal:"
  ];
  let responseStart = markerIdx;
  while (responseStart < lines.length) {
    const line = lines[responseStart].trim();
    const isQuestion = questionPatterns.some((p) => line.includes(p));
    const isWrap = responseStart > markerIdx && responseStart < markerIdx + 6 && !line.startsWith("\u25CF") && !line.startsWith("-") && !line.startsWith("*") && !line.match(/^\d+\./) && !line.startsWith("#") && !line.toLowerCase().startsWith("my ") && !line.toLowerCase().startsWith("i ");
    if (!isQuestion && !isWrap && responseStart > markerIdx)
      break;
    responseStart++;
  }
  const responseLines = [];
  for (let i = responseStart;i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line)
      continue;
    if (isPromptLine(line))
      continue;
    if (isStatusBarLine(line))
      continue;
    responseLines.push(line);
  }
  return responseLines.join(`
`).trim() || "(empty response)";
}
function isPromptLine(line) {
  const trimmed = line.trim();
  return trimmed === "\u276F" || trimmed === "\u276F" || /^\u276F\s*$/.test(trimmed) || /^\$\s*$/.test(trimmed);
}
function isStatusBarLine(line) {
  return /bypass permissions/i.test(line) || /shift\+tab to cycle/i.test(line) || /ctrl\+[a-z] to/i.test(line) || /^\s*[\u2598\u259D\u259C\u259B\u2588\u258C\u2590]+/.test(line) || /Claude Code v[\d.]+/.test(line);
}
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/[\u2800-\u28FF]/g, "").trim();
}
function printTranscript(transcript) {
  const { goal, ts, participants, discussion, tasks, dispatched } = transcript;
  console.log();
  console.log("\x1B[36m\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557\x1B[0m");
  console.log(`\x1B[36m\u2551\x1B[0m     BoB's Office \u2014 Meeting                   \x1B[36m\u2551\x1B[0m`);
  console.log(`\x1B[36m\u2551\x1B[0m     ${ts.padEnd(37)}\x1B[36m\u2551\x1B[0m`);
  console.log("\x1B[36m\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D\x1B[0m");
  console.log();
  console.log(`  \x1B[1mGoal:\x1B[0m ${goal}`);
  console.log();
  console.log("  \x1B[1mParticipants:\x1B[0m");
  for (const p of participants) {
    const color = p.status === "ready" ? "\x1B[32m" : p.status === "busy" ? "\x1B[33m" : "\x1B[31m";
    const icon = p.status === "ready" ? "\u25CF" : p.status === "busy" ? "\u25CB" : "\u2717";
    const label = p.status === "ready" ? "claude running" : p.status === "busy" ? "busy" : "no session";
    console.log(`    ${color}${icon}\x1B[0m ${(p.oracle.charAt(0).toUpperCase() + p.oracle.slice(1)).padEnd(12)} ${color}${label}\x1B[0m`);
  }
  console.log();
  console.log("  \x1B[1mDiscussion:\x1B[0m");
  for (const d of discussion) {
    const name = d.oracle.charAt(0).toUpperCase() + d.oracle.slice(1);
    const color = d.oracle === "BoB" ? "\x1B[36m" : "\x1B[33m";
    const lines = d.message.split(`
`).filter((l) => l.trim());
    console.log(`    ${color}[${name}]\x1B[0m`);
    for (const line of lines.slice(0, 12)) {
      console.log(`      ${line}`);
    }
    if (lines.length > 12)
      console.log(`      \x1B[90m... (${lines.length - 12} more lines)\x1B[0m`);
    console.log();
  }
  if (tasks.length > 0) {
    console.log("  \x1B[1mTasks:\x1B[0m");
    for (const t of tasks) {
      const name = t.oracle.charAt(0).toUpperCase() + t.oracle.slice(1);
      console.log(`    \x1B[33m${t.priority}\x1B[0m  ${name.padEnd(12)} \u2192 ${t.task}`);
    }
    console.log();
  }
  if (dispatched) {
    console.log(`  \x1B[32m\u2713 Tasks assigned\x1B[0m`);
  } else {
    console.log("  \x1B[90m(dry run \u2014 agents not messaged)\x1B[0m");
  }
}
function writeMeetingToFeed(transcript) {
  try {
    const { appendFileSync: appendFileSync5 } = __require("fs");
    const { join: join23 } = __require("path");
    const FEED_LOG3 = join23(process.env.HOME || "/home/mbank", ".oracle", "feed.log");
    const now = new Date;
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const flat = JSON.stringify(transcript).replace(/\n/g, " \u239C ");
    const line = `${ts} | BoB-Oracle | VuttiServer | Notification | BoB-Oracle | autopilot \xBB [meeting] ${flat}
`;
    appendFileSync5(FEED_LOG3, line);
  } catch {}
}
async function cmdMeeting(goal, opts = {}) {
  const now = new Date;
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const perAgentTimeout = (opts.timeout || 120) * 1000;
  const participants = selectParticipants(goal, opts.oracles);
  console.log(`
  \x1B[36mBoB's Meeting: "${goal}"\x1B[0m`);
  console.log(`  Inviting: ${participants.join(", ")}
`);
  const targets = await resolveTargets(participants);
  for (const t of targets) {
    const icon = t.status === "ready" ? "\x1B[32m\u25CF\x1B[0m" : t.status === "dead" ? "\x1B[31m\u2717\x1B[0m" : "\x1B[33m\u25CB\x1B[0m";
    const label = t.status === "ready" ? "claude running" : t.status === "dead" ? "no session" : "busy";
    console.log(`  ${icon} ${t.oracle.padEnd(12)} ${t.target || "(none)"} \u2014 ${label}`);
  }
  const deadAgents = targets.filter((t) => t.status === "dead");
  if (deadAgents.length > 0) {
    console.log(`
  \x1B[33mWaking ${deadAgents.length} offline agents...\x1B[0m`);
    for (const t of deadAgents) {
      try {
        const wakeTarget = await cmdWake(t.oracle, {});
        t.target = wakeTarget;
        t.status = "ready";
        console.log(`  \x1B[32m\u25CF\x1B[0m ${t.oracle} woken \u2192 ${wakeTarget}`);
        await new Promise((r) => setTimeout(r, 5000));
      } catch {
        console.log(`  \x1B[31m\u2717\x1B[0m ${t.oracle} couldn't wake \u2014 skipping`);
      }
    }
  }
  const readyAgents = targets.filter((t) => t.status === "ready" && t.oracle !== "bob");
  if (opts.dryRun) {
    const transcript2 = {
      goal,
      ts,
      participants: targets.map((t) => ({ oracle: t.oracle, target: t.target, status: t.status })),
      discussion: [{ oracle: "BoB", message: `(dry run \u2014 ${readyAgents.length} agents ready, not messaged)` }],
      tasks: [],
      dispatched: false
    };
    printTranscript(transcript2);
    return transcript2;
  }
  if (readyAgents.length === 0) {
    console.log(`
  \x1B[31mNo agents available for meeting.\x1B[0m`);
    return {
      goal,
      ts,
      participants: targets.map((t) => ({ oracle: t.oracle, target: t.target, status: t.status })),
      discussion: [{ oracle: "BoB", message: "No agents available." }],
      tasks: [],
      dispatched: false
    };
  }
  console.log(`
  \x1B[33mSending meeting question to ${readyAgents.length} agents in parallel...\x1B[0m`);
  console.log(`  \x1B[90m(watch their tmux sessions \u2014 they're responding live)\x1B[0m
`);
  const discussion = [];
  discussion.push({ oracle: "BoB", message: `Team meeting: "${goal}" \u2014 all oracles answering simultaneously.` });
  const askResults = await Promise.allSettled(readyAgents.map(async (agent) => {
    console.log(`  \x1B[36m>>>\x1B[0m ${agent.oracle}`);
    const response = await askOracle(agent, goal, participants, perAgentTimeout);
    console.log(`  \x1B[32m\u2713\x1B[0m ${agent.oracle} responded`);
    return { oracle: agent.oracle, response };
  }));
  for (const result of askResults) {
    if (result.status === "fulfilled") {
      discussion.push({ oracle: result.value.oracle, message: result.value.response });
    } else {
      console.log(`  \x1B[31m\u2717\x1B[0m agent failed: ${result.reason}`);
    }
  }
  console.log(`
  \x1B[36mBoB synthesizing tasks...\x1B[0m`);
  const bobTarget = targets.find((t) => t.oracle === "bob");
  let tasks = [];
  const agentResponses = discussion.filter((d) => d.oracle !== "BoB");
  if (bobTarget && bobTarget.status === "ready" && agentResponses.length > 0) {
    const marker = makeMeetingMarker();
    const summary = agentResponses.map((d) => `[${d.oracle}] ${d.message.split(`
`).slice(0, 5).join(" ").slice(0, 200)}`).join(`
`);
    const bobQuestion = [
      `[${marker}] I held a meeting about: "${goal}".`,
      `Oracle responses:
${summary}
`,
      `Create a task list from this. For each task: oracle name, task description, priority (P1/P2/P3).`,
      `Keep it short \u2014 one line per task.`
    ].join(" ");
    await sendKeys(bobTarget.target, bobQuestion);
    await new Promise((r) => setTimeout(r, 8000));
    const start = Date.now();
    let lastCap = "";
    let stableCount = 0;
    while (Date.now() - start < 90000) {
      await new Promise((r) => setTimeout(r, 3000));
      const cap = await capture(bobTarget.target, 80);
      if (cap === lastCap) {
        stableCount++;
        if (stableCount >= 2) {
          const bobResponse = extractResponseAfterMarker(cap, marker);
          discussion.push({ oracle: "BoB", message: bobResponse });
          tasks = parseTasksFromText(bobResponse, readyAgents.map((a) => a.oracle));
          break;
        }
      } else {
        stableCount = 0;
      }
      lastCap = cap;
    }
  }
  if (tasks.length === 0 && agentResponses.length > 0) {
    discussion.push({ oracle: "BoB", message: `Assigned ${agentResponses.length} tasks from oracle input.` });
    tasks = agentResponses.map((d, i) => {
      const skipPatterns = ["Meeting from BoB", "Answer briefly", "What would YOU do", "MTG-"];
      const firstSentence = d.message.split(`
`).filter((l) => {
        const trimmed = l.trim();
        if (!trimmed || trimmed.length < 15)
          return false;
        if (skipPatterns.some((p) => trimmed.includes(p)))
          return false;
        return true;
      }).slice(0, 2).join(" ").slice(0, 200);
      return {
        oracle: d.oracle,
        task: firstSentence || `${ORACLE_ROLES[d.oracle]?.role}: work on "${goal}"`,
        priority: i < 2 ? "P1" : "P2"
      };
    });
  }
  const transcript = {
    goal,
    ts,
    participants: targets.map((t) => ({ oracle: t.oracle, target: t.target, status: t.status })),
    discussion,
    tasks,
    dispatched: true
  };
  if (!opts.returnTranscript) {
    printTranscript(transcript);
  }
  writeMeetingToFeed(transcript);
  return transcript;
}
function parseTasksFromText(text, validOracles) {
  const tasks = [];
  const lines = text.split(`
`);
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const oracle of validOracles) {
      if (lower.includes(oracle)) {
        const priority = /p1|critical|urgent|blocking/i.test(line) ? "P1" : /p3|nice.to.have|optional|low/i.test(line) ? "P3" : "P2";
        let task = line.replace(/^[\s\-\*\u2022|\u25CF\u25CB\u25BA\u25B8]+/, "").replace(/\b(P[123])\b/gi, "").trim();
        if (task.length > 10) {
          tasks.push({ oracle, task, priority });
        }
        break;
      }
    }
  }
  return tasks;
}
var ORACLE_ROLES;
var init_meeting = __esm(() => {
  init_ssh();
  init_wake();
  init_wake();
  init_tmux();
  ORACLE_ROLES = {
    dev: { role: "Development", keywords: ["implement", "api", "backend", "frontend", "deploy", "code", "build", "feature", "page", "app", "server", "fix"] },
    qa: { role: "QA", keywords: ["test", "bug", "validation", "quality", "suite"] },
    designer: { role: "Design", keywords: ["ui", "ux", "mockup", "visual", "layout", "design", "logo", "brand", "creative", "landing"] },
    researcher: { role: "Research", keywords: ["analyze", "compare", "benchmark", "research", "explore", "competitor"] },
    writer: { role: "Content", keywords: ["docs", "copy", "blog", "readme", "write", "content", "article", "post"] },
    hr: { role: "People Ops", keywords: ["onboard", "guide", "process", "hire", "recruit", "interview", "people"] }
  };
});

// src/commands/loop.ts
var exports_loop = {};
__export(exports_loop, {
  cmdLoop: () => cmdLoop
});
import { readFileSync as readFileSync16, writeFileSync as writeFileSync9 } from "fs";
import { join as join23 } from "path";
function loadLoops() {
  try {
    return JSON.parse(readFileSync16(LOOPS_PATH2, "utf-8"));
  } catch {
    return { enabled: true, loops: [] };
  }
}
function saveLoops(config) {
  writeFileSync9(LOOPS_PATH2, JSON.stringify(config, null, 2), "utf-8");
}
async function cmdLoop(args) {
  const sub = args[0];
  if (!sub) {
    try {
      const res = await fetch(`${MAW_URL}/api/loops`);
      const data = await res.json();
      console.log(`
  \x1B[36mLoop Engine\x1B[0m \u2014 ${data.enabled ? "\x1B[32mENABLED\x1B[0m" : "\x1B[31mDISABLED\x1B[0m"}
`);
      for (const l of data.loops) {
        const icon = l.enabled ? l.lastStatus === "ok" ? "\x1B[32m\u2713\x1B[0m" : l.lastStatus === "error" ? "\x1B[31m\u2717\x1B[0m" : "\x1B[33m\u25CB\x1B[0m" : "\x1B[90m\u2298\x1B[0m";
        const last = l.lastRun ? `last: ${l.lastRun.slice(0, 19).replace("T", " ")}` : "never ran";
        const next = l.nextRun ? `next: ${l.nextRun.slice(0, 16).replace("T", " ")}` : "";
        console.log(`  ${icon} \x1B[1m${l.id}\x1B[0m [${l.oracle}]`);
        console.log(`    ${l.description}`);
        console.log(`    \x1B[90m${l.schedule} | ${last}${l.lastReason ? ` (${l.lastReason})` : ""} | ${next}\x1B[0m`);
      }
      console.log();
    } catch (e) {
      console.error(`  \x1B[31mError:\x1B[0m ${e.message} \u2014 is maw server running?`);
    }
    return;
  }
  if (sub === "history") {
    const loopId = args[1] || "";
    const url = loopId ? `${MAW_URL}/api/loops/history?loopId=${loopId}` : `${MAW_URL}/api/loops/history`;
    const res = await fetch(url);
    const history = await res.json();
    console.log(`
  \x1B[36mLoop History\x1B[0m${loopId ? ` \u2014 ${loopId}` : ""}
`);
    if (history.length === 0) {
      console.log(`  No executions yet.
`);
      return;
    }
    for (const h of history.slice(-20)) {
      const icon = h.status === "ok" ? "\x1B[32m\u2713\x1B[0m" : h.status === "error" ? "\x1B[31m\u2717\x1B[0m" : "\x1B[33m\u2298\x1B[0m";
      console.log(`  ${icon} ${h.ts.slice(0, 19).replace("T", " ")} ${h.loopId}${h.reason ? ` \u2014 ${h.reason}` : ""}`);
    }
    console.log();
    return;
  }
  if (sub === "trigger") {
    const loopId = args[1];
    if (!loopId) {
      console.error("  Usage: maw loop trigger <loopId>");
      return;
    }
    console.log(`  Triggering ${loopId}...`);
    const res = await fetch(`${MAW_URL}/api/loops/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loopId })
    });
    const result = await res.json();
    const icon = result.status === "ok" ? "\x1B[32m\u2713\x1B[0m" : "\x1B[31m\u2717\x1B[0m";
    console.log(`  ${icon} ${result.status}${result.reason ? ` \u2014 ${result.reason}` : ""}`);
    return;
  }
  if (sub === "add") {
    const jsonStr = args.slice(1).join(" ");
    if (!jsonStr) {
      console.log(`  Usage: maw loop add '{"id":"my-loop","oracle":"dev","tmux":"02-dev:0","schedule":"0 9 * * *","prompt":"...","enabled":true,"description":"..."}'`);
      return;
    }
    try {
      const newLoop = JSON.parse(jsonStr);
      if (!newLoop.id || !newLoop.schedule) {
        console.error("  Error: id and schedule are required");
        return;
      }
      const config = loadLoops();
      const idx = config.loops.findIndex((l) => l.id === newLoop.id);
      if (idx >= 0) {
        config.loops[idx] = { ...config.loops[idx], ...newLoop };
        console.log(`  \x1B[33m\u21BB\x1B[0m Updated loop: ${newLoop.id}`);
      } else {
        config.loops.push(newLoop);
        console.log(`  \x1B[32m+\x1B[0m Added loop: ${newLoop.id}`);
      }
      saveLoops(config);
    } catch (e) {
      console.error(`  Error parsing JSON: ${e.message}`);
    }
    return;
  }
  if (sub === "remove") {
    const loopId = args[1];
    if (!loopId) {
      console.error("  Usage: maw loop remove <loopId>");
      return;
    }
    const config = loadLoops();
    const before = config.loops.length;
    config.loops = config.loops.filter((l) => l.id !== loopId);
    if (config.loops.length < before) {
      saveLoops(config);
      console.log(`  \x1B[31m-\x1B[0m Removed loop: ${loopId}`);
    } else {
      console.log(`  Loop not found: ${loopId}`);
    }
    return;
  }
  if (sub === "enable" || sub === "disable") {
    const loopId = args[1];
    const enabled = sub === "enable";
    if (!loopId) {
      const res = await fetch(`${MAW_URL}/api/loops/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled })
      });
      const result = await res.json();
      console.log(`  Loop engine ${enabled ? "\x1B[32menabled\x1B[0m" : "\x1B[31mdisabled\x1B[0m"}`);
    } else {
      const res = await fetch(`${MAW_URL}/api/loops/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loopId, enabled })
      });
      console.log(`  ${loopId} ${enabled ? "\x1B[32menabled\x1B[0m" : "\x1B[31mdisabled\x1B[0m"}`);
    }
    return;
  }
  if (sub === "on") {
    await fetch(`${MAW_URL}/api/loops/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true })
    });
    console.log("  \x1B[32m\u2713\x1B[0m Loop engine enabled");
    return;
  }
  if (sub === "off") {
    await fetch(`${MAW_URL}/api/loops/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });
    console.log("  \x1B[31m\u2298\x1B[0m Loop engine disabled");
    return;
  }
  console.log(`  Unknown subcommand: ${sub}`);
  console.log("  Usage: maw loop [history|trigger|add|remove|enable|disable|on|off]");
}
var MAW_URL, LOOPS_PATH2;
var init_loop = __esm(() => {
  MAW_URL = process.env.MAW_URL || "http://localhost:3456";
  LOOPS_PATH2 = join23(import.meta.dir, "../../loops.json");
});

// src/lib/qr.ts
function gfMul(a, b) {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}
function rsEncode(data, ecLen) {
  const gen = new Array(ecLen + 1).fill(0);
  gen[0] = 1;
  for (let i = 0;i < ecLen; i++) {
    for (let j = ecLen;j >= 1; j--) {
      gen[j] = gfMul(gen[j], EXP[i]) ^ gen[j - 1];
    }
    gen[0] = gfMul(gen[0], EXP[i]);
  }
  const msg = [...data, ...new Array(ecLen).fill(0)];
  for (let i = 0;i < data.length; i++) {
    const coef = msg[i];
    if (coef === 0)
      continue;
    for (let j = 0;j <= ecLen; j++) {
      msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(data.length);
}
function selectVersion(dataLen) {
  for (let i = 0;i < VERSIONS.length; i++) {
    if (dataLen <= VERSIONS[i].dataCW - 2) {
      return { ver: i + 1, info: VERSIONS[i] };
    }
  }
  throw new Error(`Data too long (${dataLen} bytes), max ${VERSIONS[VERSIONS.length - 1].dataCW - 2}`);
}
function encodeData(text, info) {
  const bytes = new TextEncoder().encode(text);
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1;i >= 0; i--)
      bits.push(val >> i & 1);
  };
  push(4, 4);
  push(bytes.length, 8);
  for (const b of bytes)
    push(b, 8);
  const maxBits = info.dataCW * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  push(0, termLen);
  while (bits.length % 8 !== 0)
    bits.push(0);
  const pads = [236, 17];
  let pi = 0;
  while (bits.length < maxBits) {
    push(pads[pi], 8);
    pi ^= 1;
  }
  const result = [];
  for (let i = 0;i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0;j < 8; j++)
      byte = byte << 1 | bits[i + j];
    result.push(byte);
  }
  return result;
}
function createMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}
function setModule(m, r, c, dark) {
  if (r >= 0 && r < m.length && c >= 0 && c < m.length)
    m[r][c] = dark;
}
function placeFinderPattern(m, row, col) {
  for (let r = -1;r <= 7; r++) {
    for (let c = -1;c <= 7; c++) {
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      setModule(m, row + r, col + c, inOuter ? onBorder || inInner : false);
    }
  }
}
function placeAlignmentPattern(m, row, col) {
  for (let r = -2;r <= 2; r++) {
    for (let c = -2;c <= 2; c++) {
      const onBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
      const isCenter = r === 0 && c === 0;
      setModule(m, row + r, col + c, onBorder || isCenter);
    }
  }
}
function placeFixedPatterns(m, info) {
  const size = info.size;
  placeFinderPattern(m, 0, 0);
  placeFinderPattern(m, 0, size - 7);
  placeFinderPattern(m, size - 7, 0);
  for (let i = 8;i < size - 8; i++) {
    m[6][i] = i % 2 === 0;
    m[i][6] = i % 2 === 0;
  }
  if (info.align.length >= 2) {
    const positions = info.align;
    for (const r of positions) {
      for (const c of positions) {
        if (r <= 8 && c <= 8)
          continue;
        if (r <= 8 && c >= size - 8)
          continue;
        if (r >= size - 8 && c <= 8)
          continue;
        placeAlignmentPattern(m, r, c);
      }
    }
  }
  m[size - 8][8] = true;
  for (let i = 0;i <= 8; i++) {
    if (m[8][i] === null)
      m[8][i] = false;
    if (m[i][8] === null)
      m[i][8] = false;
  }
  for (let i = size - 8;i < size; i++) {
    if (m[8][i] === null)
      m[8][i] = false;
    if (m[i][8] === null)
      m[i][8] = false;
  }
}
function formatInfo(ecLevel, mask) {
  const data = ecLevel << 3 | mask;
  let d = data << 10;
  const gen = 1335;
  for (let i = 14;i >= 10; i--) {
    if (d & 1 << i)
      d ^= gen << i - 10;
  }
  return (data << 10 | d) ^ 21522;
}
function writeFormatInfo(m, mask) {
  const size = m.length;
  const info = formatInfo(1, mask);
  const posA = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8]
  ];
  const posB = [
    [size - 1, 8],
    [size - 2, 8],
    [size - 3, 8],
    [size - 4, 8],
    [size - 5, 8],
    [size - 6, 8],
    [size - 7, 8],
    [8, size - 8],
    [8, size - 7],
    [8, size - 6],
    [8, size - 5],
    [8, size - 4],
    [8, size - 3],
    [8, size - 2],
    [8, size - 1]
  ];
  for (let i = 0;i < 15; i++) {
    const bit = (info >> i & 1) === 1;
    m[posA[i][0]][posA[i][1]] = bit;
    m[posB[i][0]][posB[i][1]] = bit;
  }
}
function placeData(m, dataBits) {
  const size = m.length;
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1;right >= 1; right -= 2) {
    if (right === 6)
      right = 5;
    const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);
    for (const row of rows) {
      for (const col of [right, right - 1]) {
        if (col < 0)
          continue;
        if (m[row][col] !== null)
          continue;
        m[row][col] = bitIdx < dataBits.length ? dataBits[bitIdx++] === 1 : false;
      }
    }
    upward = !upward;
  }
}
function applyMask(m, reserved, maskIdx) {
  const size = m.length;
  const result = m.map((row) => [...row]);
  const fn = MASK_FNS[maskIdx];
  for (let r = 0;r < size; r++) {
    for (let c = 0;c < size; c++) {
      if (reserved[r][c] !== null)
        continue;
      if (fn(r, c))
        result[r][c] = !result[r][c];
    }
  }
  return result;
}
function penaltyScore(m) {
  const size = m.length;
  let score = 0;
  for (let r = 0;r < size; r++) {
    let runLen = 1;
    for (let c = 1;c < size; c++) {
      if (m[r][c] === m[r][c - 1]) {
        runLen++;
      } else {
        if (runLen >= 5)
          score += runLen - 2;
        runLen = 1;
      }
    }
    if (runLen >= 5)
      score += runLen - 2;
  }
  for (let c = 0;c < size; c++) {
    let runLen = 1;
    for (let r = 1;r < size; r++) {
      if (m[r][c] === m[r - 1][c]) {
        runLen++;
      } else {
        if (runLen >= 5)
          score += runLen - 2;
        runLen = 1;
      }
    }
    if (runLen >= 5)
      score += runLen - 2;
  }
  for (let r = 0;r < size - 1; r++) {
    for (let c = 0;c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) {
        score += 3;
      }
    }
  }
  return score;
}
function generateQR(text) {
  const { info } = selectVersion(new TextEncoder().encode(text).length);
  const dataWords = encodeData(text, info);
  const ecWords = rsEncode(dataWords, info.ecCW);
  const allWords = [...dataWords, ...ecWords];
  const bits = [];
  for (const w of allWords) {
    for (let i = 7;i >= 0; i--)
      bits.push(w >> i & 1);
  }
  const reserved = createMatrix(info.size);
  placeFixedPatterns(reserved, info);
  const matrix = createMatrix(info.size);
  placeFixedPatterns(matrix, info);
  placeData(matrix, bits);
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0;mask < 8; mask++) {
    const masked = applyMask(matrix, reserved, mask);
    writeFormatInfo(masked, mask);
    const score = penaltyScore(masked);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }
  const final = applyMask(matrix, reserved, bestMask);
  writeFormatInfo(final, bestMask);
  return final.map((row) => row.map((cell) => cell === true));
}
function generateQRSvg(text, cellSize = 4, quietZone = 4) {
  const modules = generateQR(text);
  const size = modules.length;
  const totalSize = (size + quietZone * 2) * cellSize;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">`;
  svg += `<rect width="${totalSize}" height="${totalSize}" fill="#fff"/>`;
  for (let r = 0;r < size; r++) {
    for (let c = 0;c < size; c++) {
      if (modules[r][c]) {
        const x = (c + quietZone) * cellSize;
        const y = (r + quietZone) * cellSize;
        svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
      }
    }
  }
  svg += "</svg>";
  return svg;
}
var EXP, LOG, VERSIONS, MASK_FNS;
var init_qr = __esm(() => {
  EXP = new Uint8Array(512);
  LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0;i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x = x & 128 ? (x << 1 ^ 285) & 255 : x << 1 & 255;
    }
    for (let i = 255;i < 512; i++)
      EXP[i] = EXP[i - 255];
  })();
  VERSIONS = [
    { size: 21, totalCW: 26, ecCW: 7, dataCW: 19, align: [] },
    { size: 25, totalCW: 44, ecCW: 10, dataCW: 34, align: [6, 18] },
    { size: 29, totalCW: 70, ecCW: 15, dataCW: 55, align: [6, 22] },
    { size: 33, totalCW: 100, ecCW: 20, dataCW: 80, align: [6, 26] },
    { size: 37, totalCW: 134, ecCW: 26, dataCW: 108, align: [6, 30] }
  ];
  MASK_FNS = [
    (r, c) => (r + c) % 2 === 0,
    (r, _) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => r * c % 2 + r * c % 3 === 0,
    (r, c) => (r * c % 2 + r * c % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + r * c % 3) % 2 === 0
  ];
});

// src/auth.ts
var exports_auth = {};
__export(exports_auth, {
  setupAuth: () => setupAuth,
  isAuthenticated: () => isAuthenticated,
  isAuthEnabled: () => isAuthEnabled,
  handleLogout: () => handleLogout,
  handleLogin: () => handleLogin,
  getQrTokenStatus: () => getQrTokenStatus,
  getActiveSessions: () => getActiveSessions,
  generateQrToken: () => generateQrToken,
  approveQrToken: () => approveQrToken,
  QR_APPROVE_PAGE: () => QR_APPROVE_PAGE,
  LOGIN_PAGE: () => LOGIN_PAGE
});
import { readFileSync as readFileSync17, writeFileSync as writeFileSync10, existsSync as existsSync13 } from "fs";
import { join as join24 } from "path";
function loadAuthConfig() {
  try {
    if (existsSync13(AUTH_CONFIG_PATH)) {
      return JSON.parse(readFileSync17(AUTH_CONFIG_PATH, "utf-8"));
    }
  } catch {}
  return { enabled: false, username: "", passwordHash: "", sessions: {}, allowLocal: true };
}
function saveAuthConfig(config) {
  writeFileSync10(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
function hashPassword(password) {
  const encoder = new TextEncoder;
  const data = encoder.encode(password + "maw-salt-2026");
  let hash = 2166136261;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `maw1$${(hash >>> 0).toString(16)}$${data.length}`;
}
function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}
function generateSessionId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function isLocalRequest(req) {
  const host = new URL(req.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
function getSessionFromCookie(req) {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/maw_session=([a-f0-9]+)/);
  return match ? match[1] : null;
}
function isAuthenticated(req) {
  const config = loadAuthConfig();
  if (!config.enabled)
    return true;
  if (config.allowLocal && isLocalRequest(req))
    return true;
  const sessionId = getSessionFromCookie(req);
  if (!sessionId)
    return false;
  const session = config.sessions[sessionId];
  if (!session)
    return false;
  if (Date.now() - session.createdAt > SESSION_EXPIRY) {
    delete config.sessions[sessionId];
    saveAuthConfig(config);
    return false;
  }
  return true;
}
function handleLogin(username, password, userAgent, ip) {
  const config = loadAuthConfig();
  if (config.username !== username) {
    return { ok: false, error: "Invalid credentials" };
  }
  if (!verifyPassword(password, config.passwordHash)) {
    return { ok: false, error: "Invalid credentials" };
  }
  const now = Date.now();
  for (const [id, session] of Object.entries(config.sessions)) {
    if (now - session.createdAt > SESSION_EXPIRY) {
      delete config.sessions[id];
    }
  }
  const sessionId = generateSessionId();
  config.sessions[sessionId] = { createdAt: Date.now(), userAgent, ip: ip || "unknown" };
  const entries = Object.entries(config.sessions).sort((a, b) => b[1].createdAt - a[1].createdAt);
  if (entries.length > 10) {
    config.sessions = Object.fromEntries(entries.slice(0, 10));
  }
  saveAuthConfig(config);
  return { ok: true, sessionId };
}
function getActiveSessions() {
  const config = loadAuthConfig();
  const now = Date.now();
  const active = Object.entries(config.sessions).filter(([_, s]) => now - s.createdAt <= SESSION_EXPIRY).sort((a, b) => b[1].createdAt - a[1].createdAt).map(([id, s]) => ({ id: id.slice(0, 12) + "...", createdAt: s.createdAt, userAgent: s.userAgent, ip: s.ip }));
  return { total: active.length, sessions: active };
}
function handleLogout(req) {
  const sessionId = getSessionFromCookie(req);
  if (!sessionId)
    return;
  const config = loadAuthConfig();
  delete config.sessions[sessionId];
  saveAuthConfig(config);
}
function setupAuth(username, password) {
  const config = loadAuthConfig();
  config.enabled = true;
  config.username = username;
  config.passwordHash = hashPassword(password);
  config.allowLocal = true;
  saveAuthConfig(config);
}
function isAuthEnabled() {
  return loadAuthConfig().enabled;
}
function cleanupQrTokens() {
  const now = Date.now();
  for (const [key, t] of qrTokens) {
    if (now > t.expiresAt)
      qrTokens.delete(key);
  }
}
function generateQrToken(userAgent, ip) {
  cleanupQrTokens();
  const pending = [...qrTokens.values()].filter((t) => t.status === "pending");
  if (pending.length >= QR_MAX_PENDING) {
    const oldest = pending.sort((a, b) => a.createdAt - b.createdAt)[0];
    qrTokens.delete(oldest.token);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  qrTokens.set(token, {
    token,
    createdAt: now,
    expiresAt: now + QR_EXPIRY,
    status: "pending",
    userAgent,
    ip
  });
  const approveUrl = `https://office.vuttipipat.com/auth/qr-approve?token=${token}`;
  const qrSvg = generateQRSvg(approveUrl, 4, 4);
  return { token, expiresAt: now + QR_EXPIRY, qrSvg };
}
function getQrTokenStatus(token) {
  cleanupQrTokens();
  const t = qrTokens.get(token);
  if (!t)
    return { status: "expired" };
  if (Date.now() > t.expiresAt) {
    qrTokens.delete(token);
    return { status: "expired" };
  }
  if (t.status === "approved" && t.sessionId) {
    qrTokens.delete(token);
    return { status: "approved", sessionId: t.sessionId };
  }
  return { status: "pending" };
}
function approveQrToken(token, approverSessionId, bigScreenUserAgent) {
  cleanupQrTokens();
  const t = qrTokens.get(token);
  if (!t)
    return { ok: false, error: "Token expired or invalid" };
  if (Date.now() > t.expiresAt) {
    qrTokens.delete(token);
    return { ok: false, error: "Token expired" };
  }
  if (t.status === "approved")
    return { ok: false, error: "Token already used" };
  const config = loadAuthConfig();
  const sessionId = generateSessionId();
  config.sessions[sessionId] = {
    createdAt: Date.now(),
    userAgent: bigScreenUserAgent || t.userAgent || "QR Login",
    ip: t.ip || "qr-login"
  };
  const entries = Object.entries(config.sessions).sort((a, b) => b[1].createdAt - a[1].createdAt);
  if (entries.length > 10) {
    config.sessions = Object.fromEntries(entries.slice(0, 10));
  }
  saveAuthConfig(config);
  t.status = "approved";
  t.sessionId = sessionId;
  t.approvedBy = approverSessionId;
  return { ok: true };
}
var AUTH_CONFIG_PATH, SESSION_EXPIRY, QR_EXPIRY, QR_MAX_PENDING = 20, qrTokens, LOGIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BoB's Office \u2014 Login</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Cascadia Code', monospace;
    background: #020208;
    color: #cdd6f4;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
  }
  .login-box {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(34,211,238,0.15);
    border-radius: 16px;
    padding: 40px;
    width: 360px;
    box-shadow: 0 4px 30px rgba(0,0,0,0.4), 0 0 40px rgba(34,211,238,0.03);
  }
  h1 {
    color: #22d3ee;
    font-size: 18px;
    letter-spacing: 6px;
    text-align: center;
    margin-bottom: 8px;
  }
  .subtitle {
    text-align: center;
    color: rgba(255,255,255,0.3);
    font-size: 11px;
    margin-bottom: 32px;
    letter-spacing: 2px;
  }
  label {
    display: block;
    color: rgba(255,255,255,0.5);
    font-size: 11px;
    margin-bottom: 6px;
    letter-spacing: 1px;
  }
  input {
    width: 100%;
    padding: 10px 14px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    color: #cdd6f4;
    font-family: inherit;
    font-size: 14px;
    outline: none;
    margin-bottom: 16px;
    transition: border-color 0.2s;
  }
  input:focus {
    border-color: rgba(34,211,238,0.4);
    box-shadow: 0 0 12px rgba(34,211,238,0.1);
  }
  button {
    width: 100%;
    padding: 12px;
    background: rgba(34,211,238,0.15);
    color: #22d3ee;
    border: 1px solid rgba(34,211,238,0.3);
    border-radius: 8px;
    font-family: inherit;
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 2px;
    cursor: pointer;
    transition: all 0.2s;
  }
  button:hover { background: rgba(34,211,238,0.25); }
  button:active { transform: scale(0.98); }
  .error {
    color: #ef4444;
    font-size: 12px;
    text-align: center;
    margin-top: 12px;
    display: none;
  }
  .lock-icon {
    text-align: center;
    font-size: 32px;
    margin-bottom: 16px;
    opacity: 0.3;
  }
  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 24px 0;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.08);
  }
  .divider span {
    color: rgba(255,255,255,0.3);
    font-size: 11px;
    letter-spacing: 2px;
  }
  .qr-section {
    text-align: center;
  }
  .qr-container {
    display: flex;
    justify-content: center;
    margin: 16px 0 12px;
    min-height: 160px;
    align-items: center;
  }
  .qr-container svg {
    border-radius: 8px;
    max-width: 160px;
    max-height: 160px;
  }
  .qr-status {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    letter-spacing: 1px;
  }
  .qr-status.success {
    color: #22c55e;
  }
  .qr-countdown {
    font-size: 11px;
    color: rgba(255,255,255,0.3);
    margin-top: 8px;
  }
  .qr-refresh {
    background: none;
    border: none;
    color: #22d3ee;
    font-family: inherit;
    font-size: 11px;
    cursor: pointer;
    padding: 4px 8px;
    letter-spacing: 1px;
    margin-top: 8px;
    width: auto;
    display: inline-block;
  }
  .qr-refresh:hover {
    text-decoration: underline;
    background: none;
  }
  .qr-label {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    letter-spacing: 1px;
    margin-bottom: 4px;
  }
  .spinner {
    width: 24px; height: 24px;
    border: 2px solid rgba(34,211,238,0.2);
    border-top-color: #22d3ee;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="login-box">
  <div class="lock-icon">&#128274;</div>
  <h1>BOB'S OFFICE</h1>
  <p class="subtitle">AUTHENTICATION REQUIRED</p>
  <form id="loginForm">
    <label>USERNAME</label>
    <input type="text" id="username" autocomplete="username" autofocus>
    <label>PASSWORD</label>
    <input type="password" id="password" autocomplete="current-password">
    <button type="submit">LOGIN</button>
  </form>
  <p class="error" id="error"></p>

  <div class="divider"><span>OR SCAN QR</span></div>

  <div class="qr-section">
    <p class="qr-label">SCAN WITH YOUR PHONE</p>
    <div class="qr-container" id="qrContainer">
      <div class="spinner"></div>
    </div>
    <p class="qr-status" id="qrStatus">GENERATING...</p>
    <p class="qr-countdown" id="qrCountdown"></p>
    <button class="qr-refresh" id="qrRefresh" style="display:none" onclick="loadQR()">REFRESH QR CODE</button>
  </div>
</div>
<script>
// Password login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('error');
  err.style.display = 'none';
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      window.location.href = (redirect && redirect.startsWith('/')) ? redirect : '/';
    } else {
      err.textContent = data.error || 'Login failed';
      err.style.display = 'block';
    }
  } catch (e) {
    err.textContent = 'Connection error';
    err.style.display = 'block';
  }
});

// QR login
let qrToken = null;
let qrExpiry = 0;
let pollTimer = null;
let countdownTimer = null;

async function loadQR() {
  const container = document.getElementById('qrContainer');
  const status = document.getElementById('qrStatus');
  const countdown = document.getElementById('qrCountdown');
  const refresh = document.getElementById('qrRefresh');

  container.innerHTML = '<div class="spinner"></div>';
  status.textContent = 'GENERATING...';
  status.className = 'qr-status';
  countdown.textContent = '';
  refresh.style.display = 'none';
  if (pollTimer) clearInterval(pollTimer);
  if (countdownTimer) clearInterval(countdownTimer);

  try {
    const res = await fetch('/auth/qr-generate');
    const data = await res.json();
    qrToken = data.token;
    qrExpiry = data.expiresAt;

    container.innerHTML = data.qrSvg;
    status.textContent = 'WAITING FOR APPROVAL...';

    // Start countdown
    countdownTimer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((qrExpiry - Date.now()) / 1000));
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        clearInterval(pollTimer);
        countdown.textContent = '';
        status.textContent = 'QR CODE EXPIRED';
        refresh.style.display = 'inline-block';
        container.style.opacity = '0.3';
        return;
      }
      const min = Math.floor(remaining / 60);
      const sec = remaining % 60;
      countdown.textContent = min + ':' + String(sec).padStart(2, '0');
    }, 1000);

    // Poll for approval
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch('/auth/qr-status?token=' + qrToken);
        const d = await r.json();
        if (d.status === 'approved') {
          clearInterval(pollTimer);
          clearInterval(countdownTimer);
          status.textContent = 'APPROVED!';
          status.className = 'qr-status success';
          countdown.textContent = '';
          // Cookie set by server via Set-Cookie header \u2014 just redirect
          setTimeout(() => { window.location.href = '/'; }, 500);
        } else if (d.status === 'expired') {
          clearInterval(pollTimer);
          clearInterval(countdownTimer);
          countdown.textContent = '';
          status.textContent = 'QR CODE EXPIRED';
          refresh.style.display = 'inline-block';
          container.style.opacity = '0.3';
        }
      } catch {}
    }, 2000);
  } catch (e) {
    status.textContent = 'FAILED TO GENERATE QR';
    refresh.style.display = 'inline-block';
  }
}

// Auto-load QR on page load
loadQR();
</script>
</body>
</html>`, QR_APPROVE_PAGE = (token, deviceInfo) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BoB's Office \u2014 Approve Login</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Cascadia Code', monospace;
    background: #020208;
    color: #cdd6f4;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 20px;
  }
  .approve-box {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(34,211,238,0.15);
    border-radius: 16px;
    padding: 32px;
    width: 100%;
    max-width: 360px;
    text-align: center;
    box-shadow: 0 4px 30px rgba(0,0,0,0.4), 0 0 40px rgba(34,211,238,0.03);
  }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 {
    color: #22d3ee;
    font-size: 16px;
    letter-spacing: 4px;
    margin-bottom: 8px;
  }
  .desc {
    color: rgba(255,255,255,0.4);
    font-size: 12px;
    margin-bottom: 24px;
    line-height: 1.6;
  }
  .device-info {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 8px;
    padding: 12px;
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    margin-bottom: 24px;
    word-break: break-all;
    line-height: 1.5;
  }
  .device-info strong {
    color: rgba(255,255,255,0.7);
  }
  .btn-approve {
    width: 100%;
    padding: 14px;
    background: rgba(34,211,238,0.2);
    color: #22d3ee;
    border: 1px solid rgba(34,211,238,0.4);
    border-radius: 8px;
    font-family: inherit;
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 3px;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-approve:hover { background: rgba(34,211,238,0.3); }
  .btn-approve:active { transform: scale(0.98); }
  .btn-approve:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .result {
    margin-top: 16px;
    font-size: 13px;
    display: none;
  }
  .result.success { color: #22c55e; }
  .result.error { color: #ef4444; }
</style>
</head>
<body>
<div class="approve-box">
  <div class="icon">&#128272;</div>
  <h1>APPROVE LOGIN</h1>
  <p class="desc">A device is requesting access to BoB's Office. Approve only if you initiated this login.</p>
  <div class="device-info">
    <strong>Requesting Device:</strong><br>${deviceInfo}
  </div>
  <button class="btn-approve" id="approveBtn" onclick="approve()">APPROVE LOGIN</button>
  <p class="result" id="result"></p>
</div>
<script>
async function approve() {
  const btn = document.getElementById('approveBtn');
  const result = document.getElementById('result');
  btn.disabled = true;
  btn.textContent = 'APPROVING...';
  try {
    const res = await fetch('/auth/qr-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '${token}' }),
    });
    const data = await res.json();
    if (data.ok) {
      result.textContent = 'LOGIN APPROVED';
      result.className = 'result success';
      result.style.display = 'block';
      btn.textContent = 'DONE';
    } else {
      result.textContent = data.error || 'Approval failed';
      result.className = 'result error';
      result.style.display = 'block';
      btn.textContent = 'APPROVE LOGIN';
      btn.disabled = false;
    }
  } catch (e) {
    result.textContent = 'Connection error';
    result.className = 'result error';
    result.style.display = 'block';
    btn.textContent = 'APPROVE LOGIN';
    btn.disabled = false;
  }
}
</script>
</body>
</html>`;
var init_auth = __esm(() => {
  init_qr();
  AUTH_CONFIG_PATH = join24(import.meta.dir, "../auth.json");
  SESSION_EXPIRY = 7 * 24 * 60 * 60 * 1000;
  QR_EXPIRY = 2 * 60 * 1000;
  qrTokens = new Map;
});

// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || undefined;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};
var init_compose = () => {};

// node_modules/hono/dist/http-exception.js
var init_http_exception = () => {};

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT;
var init_constants = __esm(() => {
  GET_MATCH_RESULT = /* @__PURE__ */ Symbol();
});

// node_modules/hono/dist/utils/body.js
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, handleParsingAllValues = (form, key, value) => {
  if (form[key] !== undefined) {
    if (Array.isArray(form[key])) {
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, handleParsingNestedValues = (form, key, value) => {
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};
var init_body = __esm(() => {
  init_request();
});

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match, index) => {
    const mark = `@${index}`;
    groups.push([mark, match]);
    return mark;
  });
  return { groups, path };
}, replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1;i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1;j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, patternCache, getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match[1], new RegExp(`^${match[2]}(?=/${next})`)] : [label, match[1], new RegExp(`^${match[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
      try {
        return decoder(match);
      } catch {
        return match;
      }
    });
  }
}, tryDecodeURI = (str) => tryDecode(str, decodeURI), getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (;i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? undefined : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
}, getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, _decodeURI = (value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? undefined : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(keyIndex + 1, valueIndex === -1 ? nextKeyIndex === -1 ? undefined : nextKeyIndex : valueIndex);
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? undefined : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, getQueryParam, getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
}, decodeURIComponent_;
var init_url = __esm(() => {
  patternCache = {};
  getQueryParam = _getQueryParam;
  decodeURIComponent_ = decodeURIComponent;
});

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = (str) => tryDecode(str, decodeURIComponent_), HonoRequest;
var init_request = __esm(() => {
  init_http_exception();
  init_constants();
  init_body();
  init_url();
  HonoRequest = class {
    raw;
    #validatedData;
    #matchResult;
    routeIndex = 0;
    path;
    bodyCache = {};
    constructor(request, path = "/", matchResult = [[]]) {
      this.raw = request;
      this.path = path;
      this.#matchResult = matchResult;
      this.#validatedData = {};
    }
    param(key) {
      return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
    }
    #getDecodedParam(key) {
      const paramKey = this.#matchResult[0][this.routeIndex][1][key];
      const param = this.#getParamValue(paramKey);
      return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
    }
    #getAllDecodedParams() {
      const decoded = {};
      const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
      for (const key of keys) {
        const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
        if (value !== undefined) {
          decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
        }
      }
      return decoded;
    }
    #getParamValue(paramKey) {
      return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
    }
    query(key) {
      return getQueryParam(this.url, key);
    }
    queries(key) {
      return getQueryParams(this.url, key);
    }
    header(name) {
      if (name) {
        return this.raw.headers.get(name) ?? undefined;
      }
      const headerData = {};
      this.raw.headers.forEach((value, key) => {
        headerData[key] = value;
      });
      return headerData;
    }
    async parseBody(options) {
      return this.bodyCache.parsedBody ??= await parseBody(this, options);
    }
    #cachedBody = (key) => {
      const { bodyCache, raw } = this;
      const cachedBody = bodyCache[key];
      if (cachedBody) {
        return cachedBody;
      }
      const anyCachedKey = Object.keys(bodyCache)[0];
      if (anyCachedKey) {
        return bodyCache[anyCachedKey].then((body) => {
          if (anyCachedKey === "json") {
            body = JSON.stringify(body);
          }
          return new Response(body)[key]();
        });
      }
      return bodyCache[key] = raw[key]();
    };
    json() {
      return this.#cachedBody("text").then((text) => JSON.parse(text));
    }
    text() {
      return this.#cachedBody("text");
    }
    arrayBuffer() {
      return this.#cachedBody("arrayBuffer");
    }
    blob() {
      return this.#cachedBody("blob");
    }
    formData() {
      return this.#cachedBody("formData");
    }
    addValidatedData(target, data) {
      this.#validatedData[target] = data;
    }
    valid(target) {
      return this.#validatedData[target];
    }
    get url() {
      return this.raw.url;
    }
    get method() {
      return this.raw.method;
    }
    get [GET_MATCH_RESULT]() {
      return this.#matchResult;
    }
    get matchedRoutes() {
      return this.#matchResult[0].map(([[, route]]) => route);
    }
    get routePath() {
      return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
    }
  };
});

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase, raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then((res) => Promise.all(res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))).then(() => buffer[0]));
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};
var init_html = __esm(() => {
  HtmlEscapedCallbackPhase = {
    Stringify: 1,
    BeforeStream: 2,
    Stream: 3
  };
});

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8", setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, createResponseInstance = (body, init) => new Response(body, init), Context = class {
  #rawRequest;
  #req;
  env = {};
  #var;
  finalized = false;
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers
    });
  }
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  setLayout = (layout) => this.#layout = layout;
  getLayout = () => this.#layout;
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers;
    if (value === undefined) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map;
    this.#var.set(key, value);
  };
  get = (key) => {
    return this.#var ? this.#var.get(key) : undefined;
  };
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers;
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(text, arg, setDefaultContentType(TEXT_PLAIN, headers));
  };
  json = (object, arg, headers) => {
    return this.#newResponse(JSON.stringify(object), arg, setDefaultContentType("application/json", headers));
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  redirect = (location, status) => {
    const locationString = String(location);
    this.header("Location", !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString));
    return this.newResponse(null, status ?? 302);
  };
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};
var init_context = __esm(() => {
  init_request();
  init_html();
});

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL", METHOD_NAME_ALL_LOWERCASE = "all", METHODS, MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.", UnsupportedPathError;
var init_router = __esm(() => {
  METHODS = ["get", "post", "put", "delete", "options", "patch"];
  UnsupportedPathError = class extends Error {
  };
});

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";
var init_constants2 = () => {};

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
}, errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  route(path, app) {
    const subApp = this.basePath(path);
    app.routes.map((r) => {
      let handler;
      if (app.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res;
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = undefined;
      try {
        executionContext = c.executionCtx;
      } catch {}
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then((resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(new Request(/^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`, requestInit), Env, executionCtx);
  };
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, undefined, event.request.method));
    });
  };
};
var init_hono_base = __esm(() => {
  init_compose();
  init_context();
  init_router();
  init_constants2();
  init_url();
});

// node_modules/hono/dist/router/reg-exp-router/matcher.js
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = (method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  };
  this.match = match2;
  return match2(method, path);
}
var emptyParam;
var init_matcher = __esm(() => {
  init_router();
  emptyParam = [];
});

// node_modules/hono/dist/router/reg-exp-router/node.js
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var LABEL_REG_EXP_STR = "[^/]+", ONLY_WILDCARD_REG_EXP_STR = ".*", TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)", PATH_ERROR, regExpMetaChars, Node = class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== undefined) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some((k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR)) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node;
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some((k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR)) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node;
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};
var init_node = __esm(() => {
  PATH_ERROR = /* @__PURE__ */ Symbol();
  regExpMetaChars = new Set(".\\+*[^]$()");
});

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node;
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0;; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1;i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1;j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== undefined) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== undefined) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};
var init_trie = __esm(() => {
  init_node();
});

// node_modules/hono/dist/router/reg-exp-router/router.js
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(path === "*" ? "" : `^${path.replace(/\/\*$|([.\\+*[^\]$()])/g, (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)")}$`);
}
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie;
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map((route) => [!/\*|\/:/.test(route[0]), ...route]).sort(([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length);
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length;i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (;paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length;i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length;j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length;k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
function findMiddleware(middleware, path) {
  if (!middleware) {
    return;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return;
}
var nullMatcher, wildcardRegExpCache, RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach((p) => re.test(p) && routes[m][p].push([handler, paramCount]));
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length;i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = undefined;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]]));
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};
var init_router2 = __esm(() => {
  init_router();
  init_url();
  init_matcher();
  init_node();
  init_trie();
  nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
});

// node_modules/hono/dist/router/reg-exp-router/prepared-router.js
var PreparedRegExpRouter = class {
  name = "PreparedRegExpRouter";
  #matchers;
  #relocateMap;
  constructor(matchers, relocateMap) {
    this.#matchers = matchers;
    this.#relocateMap = relocateMap;
  }
  #addWildcard(method, handlerData) {
    const matcher = this.#matchers[method];
    matcher[1].forEach((list) => list && list.push(handlerData));
    Object.values(matcher[2]).forEach((list) => list[0].push(handlerData));
  }
  #addPath(method, path, handler, indexes, map) {
    const matcher = this.#matchers[method];
    if (!map) {
      matcher[2][path][0].push([handler, {}]);
    } else {
      indexes.forEach((index) => {
        if (typeof index === "number") {
          matcher[1][index].push([handler, map]);
        } else {
          matcher[2][index || path][0].push([handler, map]);
        }
      });
    }
  }
  add(method, path, handler) {
    if (!this.#matchers[method]) {
      const all = this.#matchers[METHOD_NAME_ALL];
      const staticMap = {};
      for (const key in all[2]) {
        staticMap[key] = [all[2][key][0].slice(), emptyParam];
      }
      this.#matchers[method] = [
        all[0],
        all[1].map((list) => Array.isArray(list) ? list.slice() : 0),
        staticMap
      ];
    }
    if (path === "/*" || path === "*") {
      const handlerData = [handler, {}];
      if (method === METHOD_NAME_ALL) {
        for (const m in this.#matchers) {
          this.#addWildcard(m, handlerData);
        }
      } else {
        this.#addWildcard(method, handlerData);
      }
      return;
    }
    const data = this.#relocateMap[path];
    if (!data) {
      throw new Error(`Path ${path} is not registered`);
    }
    for (const [indexes, map] of data) {
      if (method === METHOD_NAME_ALL) {
        for (const m in this.#matchers) {
          this.#addPath(m, path, handler, indexes, map);
        }
      } else {
        this.#addPath(method, path, handler, indexes, map);
      }
    }
  }
  buildAllMatchers() {
    return this.#matchers;
  }
  match = match;
};
var init_prepared_router = __esm(() => {
  init_router();
  init_matcher();
  init_router2();
});

// node_modules/hono/dist/router/reg-exp-router/index.js
var init_reg_exp_router = __esm(() => {
  init_router2();
  init_prepared_router();
});

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (;i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length;i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = undefined;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};
var init_router3 = __esm(() => {
  init_router();
});

// node_modules/hono/dist/router/smart-router/index.js
var init_smart_router = __esm(() => {
  init_router3();
});

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams, hasChildren = (children) => {
  for (const _ in children) {
    return true;
  }
  return false;
}, Node2 = class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length;i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2;
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length;i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== undefined) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length;i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0;i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length;j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length;k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0;p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(handlerSets, child.#children["*"], method, params, node.#params);
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};
var init_node2 = __esm(() => {
  init_router();
  init_url();
  emptyParams = /* @__PURE__ */ Object.create(null);
});

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2;
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length;i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};
var init_router4 = __esm(() => {
  init_url();
  init_node2();
});

// node_modules/hono/dist/router/trie-router/index.js
var init_trie_router = __esm(() => {
  init_router4();
});

// node_modules/hono/dist/hono.js
var Hono2;
var init_hono = __esm(() => {
  init_hono_base();
  init_reg_exp_router();
  init_smart_router();
  init_trie_router();
  Hono2 = class extends Hono {
    constructor(options = {}) {
      super(options);
      this.router = options.router ?? new SmartRouter({
        routers: [new RegExpRouter, new TrieRouter]
      });
    }
  };
});

// node_modules/hono/dist/index.js
var init_dist = __esm(() => {
  init_hono();
});

// node_modules/hono/dist/middleware/cors/index.js
var cors = (options) => {
  const defaults = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: []
  };
  const opts = {
    ...defaults,
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*") {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*") {
      c.header("Vary", "Origin", { append: true });
    }
  };
};
var init_cors = () => {};

// node_modules/hono/dist/utils/compress.js
var COMPRESSIBLE_CONTENT_TYPE_REGEX;
var init_compress = __esm(() => {
  COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i;
});

// node_modules/hono/dist/utils/mime.js
var getMimeType = (filename, mimes = baseMimes) => {
  const regexp = /\.([a-zA-Z0-9]+?)$/;
  const match2 = filename.match(regexp);
  if (!match2) {
    return;
  }
  let mimeType = mimes[match2[1]];
  if (mimeType && mimeType.startsWith("text")) {
    mimeType += "; charset=utf-8";
  }
  return mimeType;
}, _baseMimes, baseMimes;
var init_mime = __esm(() => {
  _baseMimes = {
    aac: "audio/aac",
    avi: "video/x-msvideo",
    avif: "image/avif",
    av1: "video/av1",
    bin: "application/octet-stream",
    bmp: "image/bmp",
    css: "text/css",
    csv: "text/csv",
    eot: "application/vnd.ms-fontobject",
    epub: "application/epub+zip",
    gif: "image/gif",
    gz: "application/gzip",
    htm: "text/html",
    html: "text/html",
    ico: "image/x-icon",
    ics: "text/calendar",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript",
    json: "application/json",
    jsonld: "application/ld+json",
    map: "application/json",
    mid: "audio/x-midi",
    midi: "audio/x-midi",
    mjs: "text/javascript",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    oga: "audio/ogg",
    ogv: "video/ogg",
    ogx: "application/ogg",
    opus: "audio/opus",
    otf: "font/otf",
    pdf: "application/pdf",
    png: "image/png",
    rtf: "application/rtf",
    svg: "image/svg+xml",
    tif: "image/tiff",
    tiff: "image/tiff",
    ts: "video/mp2t",
    ttf: "font/ttf",
    txt: "text/plain",
    wasm: "application/wasm",
    webm: "video/webm",
    weba: "audio/webm",
    webmanifest: "application/manifest+json",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
    xhtml: "application/xhtml+xml",
    xml: "application/xml",
    zip: "application/zip",
    "3gp": "video/3gpp",
    "3g2": "video/3gpp2",
    gltf: "model/gltf+json",
    glb: "model/gltf-binary"
  };
  baseMimes = _baseMimes;
});

// node_modules/hono/dist/middleware/serve-static/path.js
var defaultJoin = (...paths) => {
  let result = paths.filter((p) => p !== "").join("/");
  result = result.replace(/(?<=\/)\/+/g, "");
  const segments = result.split("/");
  const resolved = [];
  for (const segment of segments) {
    if (segment === ".." && resolved.length > 0 && resolved.at(-1) !== "..") {
      resolved.pop();
    } else if (segment !== ".") {
      resolved.push(segment);
    }
  }
  return resolved.join("/") || ".";
};
var init_path = () => {};

// node_modules/hono/dist/middleware/serve-static/index.js
var ENCODINGS, ENCODINGS_ORDERED_KEYS, DEFAULT_DOCUMENT = "index.html", serveStatic = (options) => {
  const root = options.root ?? "./";
  const optionPath = options.path;
  const join25 = options.join ?? defaultJoin;
  return async (c, next) => {
    if (c.finalized) {
      return next();
    }
    let filename;
    if (options.path) {
      filename = options.path;
    } else {
      try {
        filename = tryDecodeURI(c.req.path);
        if (/(?:^|[\/\\])\.\.(?:$|[\/\\])/.test(filename)) {
          throw new Error;
        }
      } catch {
        await options.onNotFound?.(c.req.path, c);
        return next();
      }
    }
    let path = join25(root, !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename) : filename);
    if (options.isDir && await options.isDir(path)) {
      path = join25(path, DEFAULT_DOCUMENT);
    }
    const getContent = options.getContent;
    let content = await getContent(path, c);
    if (content instanceof Response) {
      return c.newResponse(content.body, content);
    }
    if (content) {
      const mimeType = options.mimes && getMimeType(path, options.mimes) || getMimeType(path);
      c.header("Content-Type", mimeType || "application/octet-stream");
      if (options.precompressed && (!mimeType || COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType))) {
        const acceptEncodingSet = new Set(c.req.header("Accept-Encoding")?.split(",").map((encoding) => encoding.trim()));
        for (const encoding of ENCODINGS_ORDERED_KEYS) {
          if (!acceptEncodingSet.has(encoding)) {
            continue;
          }
          const compressedContent = await getContent(path + ENCODINGS[encoding], c);
          if (compressedContent) {
            content = compressedContent;
            c.header("Content-Encoding", encoding);
            c.header("Vary", "Accept-Encoding", { append: true });
            break;
          }
        }
      }
      await options.onFound?.(path, c);
      return c.body(content);
    }
    await options.onNotFound?.(path, c);
    await next();
    return;
  };
};
var init_serve_static = __esm(() => {
  init_compress();
  init_mime();
  init_url();
  init_path();
  ENCODINGS = {
    br: ".br",
    zstd: ".zst",
    gzip: ".gz"
  };
  ENCODINGS_ORDERED_KEYS = Object.keys(ENCODINGS);
});

// node_modules/hono/dist/adapter/bun/serve-static.js
import { stat } from "fs/promises";
import { join as join25 } from "path";
var serveStatic2 = (options) => {
  return async function serveStatic22(c, next) {
    const getContent = async (path) => {
      const file = Bun.file(path);
      return await file.exists() ? file : null;
    };
    const isDir = async (path) => {
      let isDir2;
      try {
        const stats = await stat(path);
        isDir2 = stats.isDirectory();
      } catch {}
      return isDir2;
    };
    return serveStatic({
      ...options,
      getContent,
      join: join25,
      isDir
    })(c, next);
  };
};
var init_serve_static2 = __esm(() => {
  init_serve_static();
});

// node_modules/hono/dist/client/fetch-result-please.js
var init_fetch_result_please = () => {};

// node_modules/hono/dist/client/utils.js
var init_utils = __esm(() => {
  init_fetch_result_please();
});

// node_modules/hono/dist/utils/concurrent.js
var init_concurrent = () => {};

// node_modules/hono/dist/utils/handler.js
var init_handler = __esm(() => {
  init_constants2();
});

// node_modules/hono/dist/helper/ssg/utils.js
var init_utils2 = __esm(() => {
  init_router();
  init_handler();
});

// node_modules/hono/dist/helper/ssg/middleware.js
var X_HONO_DISABLE_SSG_HEADER_KEY = "x-hono-disable-ssg", SSG_DISABLED_RESPONSE;
var init_middleware = __esm(() => {
  init_utils2();
  SSG_DISABLED_RESPONSE = (() => {
    try {
      return new Response("SSG is disabled", {
        status: 404,
        headers: { [X_HONO_DISABLE_SSG_HEADER_KEY]: "true" }
      });
    } catch {
      return null;
    }
  })();
});

// node_modules/hono/dist/helper/html/index.js
var init_html2 = __esm(() => {
  init_html();
});

// node_modules/hono/dist/helper/ssg/plugins.js
var init_plugins = __esm(() => {
  init_html2();
});

// node_modules/hono/dist/helper/ssg/ssg.js
var init_ssg = __esm(() => {
  init_utils();
  init_concurrent();
  init_mime();
  init_middleware();
  init_plugins();
  init_utils2();
});

// node_modules/hono/dist/helper/ssg/index.js
var init_ssg2 = __esm(() => {
  init_middleware();
  init_plugins();
  init_ssg();
});

// node_modules/hono/dist/adapter/bun/ssg.js
var write;
var init_ssg3 = __esm(() => {
  init_ssg2();
  ({ write } = Bun);
});

// node_modules/hono/dist/helper/websocket/index.js
var WSContext = class {
  #init;
  constructor(init) {
    this.#init = init;
    this.raw = init.raw;
    this.url = init.url ? new URL(init.url) : null;
    this.protocol = init.protocol ?? null;
  }
  send(source, options) {
    this.#init.send(source, options ?? {});
  }
  raw;
  binaryType = "arraybuffer";
  get readyState() {
    return this.#init.readyState;
  }
  url;
  protocol;
  close(code, reason) {
    this.#init.close(code, reason);
  }
}, defineWebSocketHelper = (handler) => {
  return (...args) => {
    if (typeof args[0] === "function") {
      const [createEvents, options] = args;
      return async function upgradeWebSocket(c, next) {
        const events = await createEvents(c);
        const result = await handler(c, events, options);
        if (result) {
          return result;
        }
        await next();
      };
    } else {
      const [c, events, options] = args;
      return (async () => {
        const upgraded = await handler(c, events, options);
        if (!upgraded) {
          throw new Error("Failed to upgrade WebSocket");
        }
        return upgraded;
      })();
    }
  };
};
var init_websocket = () => {};

// node_modules/hono/dist/adapter/bun/server.js
var getBunServer = (c) => ("server" in c.env) ? c.env.server : c.env;
var init_server = () => {};

// node_modules/hono/dist/adapter/bun/websocket.js
var upgradeWebSocket;
var init_websocket2 = __esm(() => {
  init_websocket();
  init_server();
  upgradeWebSocket = defineWebSocketHelper((c, events) => {
    const server = getBunServer(c);
    if (!server) {
      throw new TypeError("env has to include the 2nd argument of fetch.");
    }
    const upgradeResult = server.upgrade(c.req.raw, {
      data: {
        events,
        url: new URL(c.req.url),
        protocol: c.req.url
      }
    });
    if (upgradeResult) {
      return new Response(null);
    }
    return;
  });
});

// node_modules/hono/dist/adapter/bun/conninfo.js
var init_conninfo = __esm(() => {
  init_server();
});

// node_modules/hono/dist/adapter/bun/index.js
var init_bun = __esm(() => {
  init_serve_static2();
  init_ssg3();
  init_websocket2();
  init_conninfo();
  init_server();
});

// src/feed-tail.ts
import { statSync as statSync3, openSync, readSync, closeSync } from "fs";
import { join as join26 } from "path";

class FeedTailer {
  path;
  maxBuffer;
  offset = 0;
  buffer = [];
  listeners = new Set;
  timer = null;
  constructor(path, maxBuffer) {
    this.path = path || DEFAULT_PATH;
    this.maxBuffer = maxBuffer || DEFAULT_MAX_BUFFER;
  }
  start() {
    if (this.timer)
      return;
    try {
      const file = Bun.file(this.path);
      const size = file.size;
      if (size > 0) {
        const chunkSize = Math.min(size, 1e5);
        const fd = openSync(this.path, "r");
        const buf = Buffer.alloc(chunkSize);
        readSync(fd, buf, 0, chunkSize, size - chunkSize);
        closeSync(fd);
        const text = buf.toString("utf-8");
        const lines = text.split(`
`).filter(Boolean);
        const tail = lines.slice(-this.maxBuffer);
        for (const line of tail) {
          const event = parseLine(line);
          if (event)
            this.buffer.push(event);
        }
        if (this.buffer.length > this.maxBuffer) {
          this.buffer = this.buffer.slice(-this.maxBuffer);
        }
        this.offset = size;
      }
    } catch {
      this.offset = 0;
    }
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  onEvent(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  getRecent(n) {
    const count = n || this.maxBuffer;
    return this.buffer.slice(-count);
  }
  getActive(windowMs) {
    return activeOracles(this.buffer, windowMs);
  }
  poll() {
    try {
      const stat2 = statSync3(this.path);
      const size = stat2.size;
      if (size < this.offset) {
        this.offset = 0;
      }
      if (size <= this.offset)
        return;
      const newBytes = size - this.offset;
      const fd = openSync(this.path, "r");
      const buf = Buffer.alloc(newBytes);
      readSync(fd, buf, 0, newBytes, this.offset);
      closeSync(fd);
      this.offset = size;
      const text = buf.toString("utf-8");
      const lines = text.split(`
`).filter(Boolean);
      for (const line of lines) {
        const event = parseLine(line);
        if (!event)
          continue;
        this.buffer.push(event);
        for (const cb of this.listeners) {
          try {
            cb(event);
          } catch {}
        }
      }
      if (this.buffer.length > this.maxBuffer) {
        this.buffer = this.buffer.slice(-this.maxBuffer);
      }
    } catch {}
  }
}
var DEFAULT_PATH, POLL_MS = 1000, DEFAULT_MAX_BUFFER = 200;
var init_feed_tail = __esm(() => {
  init_feed();
  DEFAULT_PATH = join26(process.env.HOME || "/home/nat", ".oracle", "feed.log");
});

// src/loops.ts
import { readFileSync as readFileSync18, writeFileSync as writeFileSync11, existsSync as existsSync14, appendFileSync as appendFileSync5 } from "fs";
import { join as join27 } from "path";
function parseCronField(field, min, max) {
  const values = [];
  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min;i <= max; i++)
        values.push(i);
    } else if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2));
      for (let i = min;i <= max; i += step)
        values.push(i);
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      for (let i = a;i <= b; i++)
        values.push(i);
    } else {
      values.push(parseInt(part));
    }
  }
  return values;
}
function cronMatches(cron, date) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5)
    return false;
  const [minF, hourF, domF, monF, dowF] = parts;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const month = date.getMonth() + 1;
  const dow = date.getDay();
  return parseCronField(minF, 0, 59).includes(minute) && parseCronField(hourF, 0, 23).includes(hour) && parseCronField(domF, 1, 31).includes(dom) && parseCronField(monF, 1, 12).includes(month) && parseCronField(dowF, 0, 6).includes(dow);
}
function nextCronMatch(cron, after) {
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0;i < 7 * 24 * 60; i++) {
    if (cronMatches(cron, d))
      return d.toISOString();
    d.setMinutes(d.getMinutes() + 1);
  }
  return "unknown";
}
async function exec(cmd) {
  const proc = Bun.spawn(["bash", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
}
async function isSessionAlive(tmuxTarget) {
  const session = tmuxTarget.split(":")[0];
  try {
    await exec(`tmux has-session -t '${session}' 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}
async function isIdle(tmuxTarget) {
  try {
    const pane = await exec(`tmux capture-pane -t '${tmuxTarget}' -p 2>/dev/null | tail -5`);
    return pane.includes("\u276F");
  } catch {
    return false;
  }
}
async function hasActiveOracles() {
  try {
    const now = Date.now();
    const feed = await exec(`tail -50 ${FEED_LOG3} 2>/dev/null`);
    for (const line of feed.split(`
`).reverse()) {
      const match2 = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
      if (match2) {
        const ts = new Date(match2[1]).getTime();
        if (now - ts < 600000 && /PreToolUse|PostToolUse|cc:/.test(line)) {
          return true;
        }
      }
    }
  } catch {}
  return false;
}
async function restartSession(tmuxTarget, dir) {
  const session = tmuxTarget.split(":")[0];
  const expandedDir = dir.replace("~", process.env.HOME || "/home/mbank");
  try {
    await exec(`tmux new-session -d -s '${session}' -c '${expandedDir}' 2>/dev/null`);
    await new Promise((r) => setTimeout(r, 2000));
    await exec(`tmux send-keys -t '${tmuxTarget}' 'claude --dangerously-skip-permissions' Enter`);
    for (let i = 0;i < 18; i++) {
      await new Promise((r) => setTimeout(r, 1e4));
      if (await isIdle(tmuxTarget))
        return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function sendPrompt(tmuxTarget, prompt) {
  const escaped = prompt.replace(/'/g, "'\\''");
  await exec(`tmux set-buffer '${escaped}' && tmux paste-buffer -t '${tmuxTarget}' && tmux send-keys -t '${tmuxTarget}' Enter`);
}
async function runCommand(command) {
  await exec(command);
}
function loadLog() {
  try {
    if (existsSync14(LOOPS_LOG_PATH)) {
      const data = JSON.parse(readFileSync18(LOOPS_LOG_PATH, "utf-8"));
      return Array.isArray(data) ? data.slice(-500) : [];
    }
  } catch {}
  return [];
}
function appendLog(entry) {
  const log = loadLog();
  log.push(entry);
  writeFileSync11(LOOPS_LOG_PATH, JSON.stringify(log.slice(-500), null, 2), "utf-8");
}
function feedLog(message) {
  const now = new Date;
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const line = `${ts} | LoopEngine | ${__require("os").hostname()} | Notification | LoopEngine | loop \xBB ${message}
`;
  try {
    appendFileSync5(FEED_LOG3, line);
  } catch {}
}
function loadLoops2() {
  try {
    return JSON.parse(readFileSync18(LOOPS_PATH3, "utf-8"));
  } catch {
    return { enabled: false, loops: [] };
  }
}

class LoopEngine {
  interval = null;
  lastFireMinute = new Map;
  broadcast = null;
  start(broadcastFn) {
    if (this.interval)
      return;
    this.broadcast = broadcastFn || null;
    console.log("  \u23F0 LoopEngine started \u2014 checking every 30s");
    feedLog("LoopEngine started");
    setTimeout(() => this.tick(), 5000);
    this.interval = setInterval(() => this.tick(), CHECK_INTERVAL);
  }
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
  async tick() {
    const config = loadLoops2();
    if (!config.enabled)
      return;
    const now = new Date;
    const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    for (const loop of config.loops) {
      if (!loop.enabled)
        continue;
      if (!cronMatches(loop.schedule, now))
        continue;
      if (this.lastFireMinute.get(loop.id) === minuteKey)
        continue;
      this.lastFireMinute.set(loop.id, minuteKey);
      this.executeLoop(loop).catch(() => {});
    }
  }
  async executeLoop(loop) {
    const ts = new Date().toISOString();
    console.log(`  \u23F0 Loop [${loop.id}] firing...`);
    try {
      if (loop.command && !loop.tmux) {
        await runCommand(loop.command);
        this.logExecution({ loopId: loop.id, ts, status: "ok" });
        feedLog(`[${loop.id}] \u2713 executed command: ${loop.command}`);
        return;
      }
      if (!loop.tmux || !loop.prompt) {
        this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "no tmux target or prompt" });
        return;
      }
      if (loop.requireActiveOracles) {
        const active = await hasActiveOracles();
        if (!active) {
          this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "no active oracles" });
          return;
        }
      }
      let alive = await isSessionAlive(loop.tmux);
      if (!alive && loop.autoRestart && loop.restartDir) {
        feedLog(`[${loop.id}] session down \u2014 auto-restarting ${loop.tmux}`);
        alive = await restartSession(loop.tmux, loop.restartDir);
        if (!alive) {
          this.logExecution({ loopId: loop.id, ts, status: "error", reason: "auto-restart failed" });
          feedLog(`[${loop.id}] \u2717 auto-restart failed for ${loop.tmux}`);
          return;
        }
        feedLog(`[${loop.id}] \u2713 session restarted successfully`);
      }
      if (!alive) {
        this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "session not running" });
        return;
      }
      if (loop.requireIdle) {
        let idle = await isIdle(loop.tmux);
        if (!idle) {
          await new Promise((r) => setTimeout(r, 120000));
          idle = await isIdle(loop.tmux);
          if (!idle) {
            this.logExecution({ loopId: loop.id, ts, status: "skipped", reason: "oracle busy after retry" });
            feedLog(`[${loop.id}] skipped \u2014 ${loop.oracle} busy after retry`);
            return;
          }
        }
      }
      await sendPrompt(loop.tmux, loop.prompt);
      this.logExecution({ loopId: loop.id, ts, status: "ok" });
      feedLog(`[${loop.id}] \u2713 sent to ${loop.oracle}`);
      console.log(`  \u23F0 Loop [${loop.id}] \u2713 sent to ${loop.oracle}`);
    } catch (e) {
      this.logExecution({ loopId: loop.id, ts, status: "error", reason: e.message });
      feedLog(`[${loop.id}] \u2717 error: ${e.message}`);
    }
  }
  logExecution(entry) {
    appendLog(entry);
    if (this.broadcast) {
      this.broadcast(JSON.stringify({ type: "loop-execution", ...entry }));
    }
  }
  async triggerLoop(loopId) {
    const config = loadLoops2();
    const loop = config.loops.find((l) => l.id === loopId);
    if (!loop) {
      return { loopId, ts: new Date().toISOString(), status: "error", reason: "loop not found" };
    }
    await this.executeLoop(loop);
    const log = loadLog();
    return log.filter((l) => l.loopId === loopId).pop() || { loopId, ts: new Date().toISOString(), status: "error", reason: "unknown" };
  }
  getStatus() {
    const config = loadLoops2();
    const log = loadLog();
    const now = new Date;
    return config.loops.map((loop) => {
      const lastExec = log.filter((l) => l.loopId === loop.id).pop();
      return {
        id: loop.id,
        oracle: loop.oracle,
        description: loop.description,
        schedule: loop.schedule,
        enabled: loop.enabled,
        lastRun: lastExec?.ts,
        lastStatus: lastExec?.status,
        lastReason: lastExec?.reason,
        nextRun: loop.enabled ? nextCronMatch(loop.schedule, now) : undefined
      };
    });
  }
  getHistory(loopId, limit = 50) {
    const log = loadLog();
    const filtered = loopId ? log.filter((l) => l.loopId === loopId) : log;
    return filtered.slice(-limit);
  }
  toggleLoop(loopId, enabled) {
    const config = loadLoops2();
    const loop = config.loops.find((l) => l.id === loopId);
    if (!loop)
      return false;
    loop.enabled = enabled;
    writeFileSync11(LOOPS_PATH3, JSON.stringify(config, null, 2), "utf-8");
    return true;
  }
  toggleEngine(enabled) {
    const config = loadLoops2();
    config.enabled = enabled;
    writeFileSync11(LOOPS_PATH3, JSON.stringify(config, null, 2), "utf-8");
    feedLog(enabled ? "LoopEngine enabled" : "LoopEngine disabled");
  }
  isEnabled() {
    return loadLoops2().enabled;
  }
}
var LOOPS_PATH3, LOOPS_LOG_PATH, FEED_LOG3, CHECK_INTERVAL = 30000;
var init_loops = __esm(() => {
  LOOPS_PATH3 = join27(import.meta.dir, "../loops.json");
  LOOPS_LOG_PATH = join27(import.meta.dir, "../loops-log.json");
  FEED_LOG3 = join27(process.env.HOME || "/home/mbank", ".oracle", "feed.log");
});

// src/handlers.ts
async function runAction(ws, action, target, fn) {
  try {
    await fn();
    ws.send(JSON.stringify({ type: "action-ok", action, target }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}
function registerBuiltinHandlers(engine) {
  engine.on("subscribe", subscribe);
  engine.on("subscribe-previews", subscribePreviews);
  engine.on("select", select);
  engine.on("send", send);
  engine.on("sleep", sleep);
  engine.on("stop", stop);
  engine.on("wake", wake);
  engine.on("restart", restart);
  engine.on("board", board);
  engine.on("board-set", boardSet);
  engine.on("board-add", boardAdd);
  engine.on("board-auto-assign", boardAutoAssign);
  engine.on("board-scan", boardScan);
  engine.on("board-scan-mine", boardScanMine);
  engine.on("board-timeline", boardTimeline);
  engine.on("pulse-board", pulseBoard);
  engine.on("task-log", taskLog);
  engine.on("task-log-summaries", taskLogSummaries);
  engine.on("task-log-add", taskLogAdd);
  engine.on("project-board", projectBoard);
  engine.on("project-list", projectList);
  engine.on("project-add-task", projectAddTask);
  engine.on("project-remove-task", projectRemoveTask);
  engine.on("project-create", projectCreate);
  engine.on("project-auto-organize", projectAutoOrganize);
  engine.on("loop-status", loopStatus);
  engine.on("loop-history", loopHistory);
  engine.on("loop-trigger", loopTrigger);
}
var subscribe = (ws, data, engine) => {
  ws.data.target = data.target;
  engine.pushCapture(ws);
}, subscribePreviews = (ws, data, engine) => {
  ws.data.previewTargets = new Set(data.targets || []);
  engine.pushPreviews(ws);
}, select = (_ws, data) => {
  selectWindow(data.target).catch(() => {});
}, send = async (ws, data, engine) => {
  if (!data.force) {
    try {
      const cmd = await getPaneCommand(data.target);
      if (!/claude|codex|node/i.test(cmd)) {
        ws.send(JSON.stringify({ type: "error", error: `no active Claude session in ${data.target} (running: ${cmd})` }));
        return;
      }
    } catch {}
  }
  sendKeys(data.target, data.text).then(() => {
    ws.send(JSON.stringify({ type: "sent", ok: true, target: data.target, text: data.text }));
    setTimeout(() => engine.pushCapture(ws), 300);
  }).catch((e) => ws.send(JSON.stringify({ type: "error", error: e.message })));
}, sleep = (ws, data) => {
  runAction(ws, "sleep", data.target, () => sendKeys(data.target, "\x03"));
}, stop = (ws, data) => {
  runAction(ws, "stop", data.target, () => ssh(`tmux kill-window -t '${data.target}'`));
}, wake = (ws, data) => {
  const cmd = data.command || buildCommand(data.target?.split(":").pop() || "");
  runAction(ws, "wake", data.target, () => sendKeys(data.target, cmd + "\r"));
}, restart = (ws, data) => {
  const cmd = data.command || buildCommand(data.target?.split(":").pop() || "");
  runAction(ws, "restart", data.target, async () => {
    await sendKeys(data.target, "\x03");
    await new Promise((r) => setTimeout(r, 2000));
    await sendKeys(data.target, "\x03");
    await new Promise((r) => setTimeout(r, 500));
    await sendKeys(data.target, cmd + "\r");
  });
}, board = async (ws, data) => {
  try {
    const [items, fields] = await Promise.all([
      fetchBoardData(data.filter),
      fetchFields()
    ]);
    ws.send(JSON.stringify({ type: "board-data", items, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, boardSet = async (ws, data, engine) => {
  try {
    if (data.field?.toLowerCase() === "status") {
      try {
        const items2 = await fetchBoardData();
        const item = items2.find((i) => i.id === data.itemId);
        if (item) {
          appendActivity({
            taskId: data.itemId,
            type: "status_change",
            oracle: "dashboard",
            content: `Status changed: ${item.status || "none"} \u2192 ${data.value}`,
            meta: { oldStatus: item.status, newStatus: data.value }
          });
        }
      } catch {}
    }
    await setFieldByName(data.itemId, data.field, data.value);
    const [items, fields] = await Promise.all([
      fetchBoardData(),
      fetchFields()
    ]);
    ws.send(JSON.stringify({ type: "board-data", items, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, boardAdd = async (ws, data) => {
  try {
    await addItem(data.title, { oracle: data.oracle, repo: data.repo });
    const [items, fields] = await Promise.all([
      fetchBoardData(),
      fetchFields()
    ]);
    ws.send(JSON.stringify({ type: "board-data", items, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, boardAutoAssign = async (ws) => {
  try {
    const result = await autoAssign();
    ws.send(JSON.stringify({ type: "board-auto-assign-results", ...result }));
    const [items, fields] = await Promise.all([
      fetchBoardData(),
      fetchFields()
    ]);
    ws.send(JSON.stringify({ type: "board-data", items, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, boardScan = async (ws) => {
  try {
    const results = await scanUntracked();
    ws.send(JSON.stringify({ type: "board-scan-results", results }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, boardScanMine = async (ws) => {
  try {
    const results = await scanMine();
    ws.send(JSON.stringify({ type: "board-scan-mine-results", results }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, boardTimeline = async (ws, data) => {
  try {
    const timeline = await getTimelineData(data.filter);
    ws.send(JSON.stringify({ type: "board-timeline-data", timeline }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, pulseBoard = async (ws) => {
  try {
    const items = await fetchBoardData();
    const active = items.filter((i) => i.status.toLowerCase().replace(/\s/g, "") === "inprogress").map((i) => ({ number: i.content.number, title: i.title, oracle: i.oracle }));
    const projects = items.filter((i) => i.status.toLowerCase() === "todo" || i.status.toLowerCase() === "backlog").map((i) => ({ number: i.content.number, title: i.title, oracle: i.oracle }));
    const tools = items.filter((i) => i.status.toLowerCase() === "done").map((i) => ({ number: i.content.number, title: i.title, oracle: i.oracle }));
    const total = items.filter((i) => i.status.toLowerCase() !== "done").length;
    ws.send(JSON.stringify({
      type: "pulse-board-data",
      active,
      projects,
      tools,
      total,
      threads: []
    }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, taskLog = async (ws, data) => {
  try {
    let activities = readTaskLog(data.taskId);
    if (activities.length === 0 && data.taskId.startsWith("PVTI_")) {
      try {
        const items = await fetchBoardData();
        const item = items.find((i) => i.id === data.taskId);
        if (item?.content.number) {
          const byNum = readTaskLog(String(item.content.number));
          const repo = item.content.repository?.split("/").pop() || "";
          const byRepo = repo ? readTaskLog(`${repo}_${item.content.number}`) : [];
          activities = [...byNum, ...byRepo, ...activities].sort((a, b) => a.ts.localeCompare(b.ts));
        }
      } catch {}
    }
    ws.send(JSON.stringify({ type: "task-log-data", taskId: data.taskId, activities }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, taskLogSummaries = async (ws) => {
  try {
    const raw2 = getAllLogSummaries();
    let boardItems = [];
    try {
      boardItems = await fetchBoardData();
    } catch {}
    const issueToItemId = new Map;
    for (const item of boardItems) {
      if (item.content.number > 0) {
        issueToItemId.set(String(item.content.number), item.id);
      }
    }
    const summaries = { ...raw2 };
    for (const [taskId, summary] of Object.entries(raw2)) {
      const boardId = issueToItemId.get(taskId);
      if (boardId && !summaries[boardId]) {
        summaries[boardId] = { ...summary, taskId: boardId };
      }
      const repoMatch = taskId.match(/^(.+?)_(\d+)$/);
      if (repoMatch) {
        const num = repoMatch[2];
        const bid = issueToItemId.get(num);
        if (bid && !summaries[bid]) {
          summaries[bid] = { ...summary, taskId: bid };
        }
      }
    }
    for (const item of boardItems) {
      const pvtiKey = item.id;
      const numKey = String(item.content.number);
      const pvtiSummary = raw2[pvtiKey];
      const numSummary = raw2[numKey];
      if (pvtiSummary && numSummary) {
        summaries[pvtiKey] = {
          taskId: pvtiKey,
          count: pvtiSummary.count + numSummary.count,
          lastActivity: pvtiSummary.lastActivity > numSummary.lastActivity ? pvtiSummary.lastActivity : numSummary.lastActivity,
          lastOracle: pvtiSummary.lastActivity > numSummary.lastActivity ? pvtiSummary.lastOracle : numSummary.lastOracle,
          hasBlockers: pvtiSummary.hasBlockers || numSummary.hasBlockers,
          contributors: [...new Set([...pvtiSummary.contributors, ...numSummary.contributors])]
        };
      }
    }
    ws.send(JSON.stringify({ type: "task-log-summaries-data", summaries }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, taskLogAdd = async (ws, data, engine) => {
  try {
    const activity = appendActivity({
      taskId: data.taskId,
      type: data.activityType || "note",
      oracle: data.oracle || "dashboard",
      content: data.content,
      meta: data.meta
    });
    ws.send(JSON.stringify({ type: "task-log-new", activity }));
    engine.broadcast(JSON.stringify({ type: "task-log-new", activity }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, projectBoard = async (ws, data) => {
  try {
    const items = await fetchBoardData(data.filter);
    const result = getProjectBoardData(items);
    const fields = await fetchFields();
    ws.send(JSON.stringify({ type: "project-board-data", ...result, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, projectList = async (ws) => {
  try {
    const data = loadProjects();
    ws.send(JSON.stringify({ type: "project-list-data", projects: data.projects }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, projectAddTask = async (ws, data, engine) => {
  try {
    addTaskToProject(data.projectId, data.taskId, data.parentTaskId);
    ws.send(JSON.stringify({ type: "project-updated", projectId: data.projectId }));
    const items = await fetchBoardData();
    const result = getProjectBoardData(items);
    const fields = await fetchFields();
    engine.broadcast(JSON.stringify({ type: "project-board-data", ...result, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, projectRemoveTask = async (ws, data, engine) => {
  try {
    removeTaskFromProject(data.projectId, data.taskId);
    ws.send(JSON.stringify({ type: "project-updated", projectId: data.projectId }));
    const items = await fetchBoardData();
    const result = getProjectBoardData(items);
    const fields = await fetchFields();
    engine.broadcast(JSON.stringify({ type: "project-board-data", ...result, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, projectCreate = async (ws, data, engine) => {
  try {
    const project = createProject(data.id, data.name, data.description || "");
    ws.send(JSON.stringify({ type: "project-created", project }));
    const items = await fetchBoardData();
    const result = getProjectBoardData(items);
    const fields = await fetchFields();
    engine.broadcast(JSON.stringify({ type: "project-board-data", ...result, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, projectAutoOrganize = async (ws, _data, engine) => {
  try {
    const items = await fetchBoardData();
    const result = autoOrganize(items);
    ws.send(JSON.stringify({ type: "project-auto-organize-result", ...result }));
    const updatedItems = await fetchBoardData();
    const boardData = getProjectBoardData(updatedItems);
    const fields = await fetchFields();
    engine.broadcast(JSON.stringify({ type: "project-board-data", ...boardData, fields }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, loopEngineInstance, loopStatus = async (ws) => {
  try {
    const status = loopEngineInstance.getStatus();
    const enabled = loopEngineInstance.isEnabled();
    ws.send(JSON.stringify({ type: "loop-status", enabled, loops: status }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, loopHistory = async (ws, data) => {
  try {
    const history = loopEngineInstance.getHistory(data.loopId, data.limit || 50);
    ws.send(JSON.stringify({ type: "loop-history", history }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
}, loopTrigger = async (ws, data) => {
  try {
    const result = await loopEngineInstance.triggerLoop(data.loopId);
    ws.send(JSON.stringify({ type: "loop-trigger-result", ...result }));
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", error: e.message }));
  }
};
var init_handlers = __esm(() => {
  init_ssh();
  init_config();
  init_board();
  init_task_log();
  init_projects();
  init_loops();
  loopEngineInstance = new LoopEngine;
});

// src/engine.ts
import { statSync as statSync4, appendFileSync as appendFileSync6 } from "fs";
import { join as join28 } from "path";
import { homedir as homedir13 } from "os";

class MawEngine {
  clients = new Set;
  handlers = new Map;
  lastContent = new Map;
  lastPreviews = new Map;
  lastSessionsJson = "";
  cachedSessions = [];
  captureInterval = null;
  sessionInterval = null;
  previewInterval = null;
  feedUnsub = null;
  feedTailer;
  mawLogInterval = null;
  mawLogOffset = 0;
  healthInterval = null;
  lastRestartAttempt = new Map;
  restartLog = [];
  pendingMessages = new Map;
  commAlerts = [];
  lastHealthSummary = null;
  constructor({ feedTailer }) {
    this.feedTailer = feedTailer;
    registerBuiltinHandlers(this);
  }
  on(type, handler) {
    this.handlers.set(type, handler);
  }
  handleOpen(ws) {
    this.clients.add(ws);
    this.startIntervals();
    if (this.cachedSessions.length > 0) {
      ws.send(JSON.stringify({ type: "sessions", sessions: this.cachedSessions }));
      this.sendBusyAgents(ws);
    } else {
      tmux.listAll().then((all) => {
        const sessions = all.filter((s) => !s.name.startsWith("maw-pty-"));
        this.cachedSessions = sessions;
        ws.send(JSON.stringify({ type: "sessions", sessions }));
        this.sendBusyAgents(ws);
      }).catch(() => {});
    }
    ws.send(JSON.stringify({ type: "feed-history", events: this.feedTailer.getRecent(50) }));
  }
  async sendBusyAgents(ws) {
    const allTargets = this.cachedSessions.flatMap((s) => s.windows.map((w) => `${s.name}:${w.index}`));
    const cmds = await tmux.getPaneCommands(allTargets);
    const busy = allTargets.filter((t) => /claude|codex|node/i.test(cmds[t] || "")).map((t) => {
      const [session] = t.split(":");
      const s = this.cachedSessions.find((x) => x.name === session);
      const w = s?.windows.find((w2) => `${s.name}:${w2.index}` === t);
      return { target: t, name: w?.name || t, session };
    });
    if (busy.length > 0) {
      ws.send(JSON.stringify({ type: "recent", agents: busy }));
    }
  }
  handleMessage(ws, msg) {
    try {
      const data = JSON.parse(msg);
      const handler = this.handlers.get(data.type);
      if (handler)
        handler(ws, data, this);
    } catch {}
  }
  handleClose(ws) {
    this.clients.delete(ws);
    this.lastContent.delete(ws);
    this.lastPreviews.delete(ws);
    this.stopIntervals();
  }
  async pushCapture(ws) {
    if (!ws.data.target)
      return;
    try {
      const content = await capture(ws.data.target, 500);
      const prev = this.lastContent.get(ws);
      if (content !== prev) {
        this.lastContent.set(ws, content);
        ws.send(JSON.stringify({ type: "capture", target: ws.data.target, content }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", error: e.message }));
    }
  }
  async pushPreviews(ws) {
    const targets = ws.data.previewTargets;
    if (!targets || targets.size === 0)
      return;
    const prevMap = this.lastPreviews.get(ws) || new Map;
    const changed = {};
    let hasChanges = false;
    await Promise.allSettled([...targets].map(async (target) => {
      try {
        const content = await capture(target, 3);
        const prev = prevMap.get(target);
        if (content !== prev) {
          prevMap.set(target, content);
          changed[target] = content;
          hasChanges = true;
        }
      } catch {}
    }));
    this.lastPreviews.set(ws, prevMap);
    if (hasChanges) {
      ws.send(JSON.stringify({ type: "previews", data: changed }));
    }
  }
  broadcast(msg) {
    for (const ws of this.clients)
      ws.send(msg);
  }
  async broadcastSessions() {
    if (this.clients.size === 0)
      return;
    try {
      const all = await tmux.listAll();
      const sessions = all.filter((s) => !s.name.startsWith("maw-pty-"));
      this.cachedSessions = sessions;
      const json = JSON.stringify(sessions);
      if (json === this.lastSessionsJson)
        return;
      this.lastSessionsJson = json;
      const msg = JSON.stringify({ type: "sessions", sessions });
      for (const ws of this.clients)
        ws.send(msg);
    } catch {}
  }
  getHealthSummary() {
    return this.lastHealthSummary;
  }
  checkOracleHealth() {
    const liveSessions = new Set(this.cachedSessions.map((s) => s.name));
    const now = Date.now();
    const activeMap = this.feedTailer.getActive(5 * 60000);
    const oracles = [];
    let liveCount = 0;
    let deadCount = 0;
    for (const oracle of EXPECTED_ORACLES) {
      const sessionName = oracleToSession(oracle);
      const isLive = liveSessions.has(sessionName);
      const lastEvent = activeMap.get(oracle.charAt(0).toUpperCase() + oracle.slice(1) + "-Oracle") || activeMap.get(oracle.toUpperCase().slice(0, 1) + oracle.slice(1) + "-Oracle") || activeMap.get(FEED_ORACLE_NAMES[oracle] || "") || activeMap.get(oracle);
      const lastSeen = lastEvent ? new Date(lastEvent.ts).toISOString() : "";
      let pendingCount = 0;
      for (const [, pm] of this.pendingMessages) {
        if (pm.to === oracle && !pm.responded)
          pendingCount++;
      }
      let status;
      if (isLive && lastEvent && now - lastEvent.ts < 5 * 60000) {
        status = "alive";
        liveCount++;
      } else if (isLive) {
        status = "idle";
        liveCount++;
      } else {
        status = "dead";
        deadCount++;
        const lastAttempt = this.lastRestartAttempt.get(oracle) || 0;
        if (now - lastAttempt >= RESTART_COOLDOWN_MS) {
          this.lastRestartAttempt.set(oracle, now);
          const alert = {
            id: alertId("dead-session", oracle),
            type: "dead-session",
            oracle,
            waitingMin: 0,
            tier: 2,
            ts: new Date().toISOString(),
            action: "restarting"
          };
          this.emitAlert(alert);
          this.appendHealthLog(`auto-restart triggered: ${oracle}`);
          try {
            Bun.spawn(["maw", "wake", oracle]);
            this.restartLog.push({ oracle, ts: new Date().toISOString(), success: true });
          } catch {
            this.restartLog.push({ oracle, ts: new Date().toISOString(), success: false });
          }
        }
      }
      oracles.push({
        name: oracle,
        status,
        sessionName,
        lastSeen,
        pendingMessages: pendingCount,
        avgResponseMin: 0,
        responseRate: 0
      });
    }
    const totalPending = [...this.pendingMessages.values()].filter((m) => !m.responded).length;
    const summary = {
      timestamp: new Date().toISOString(),
      responseRate: totalPending === 0 ? 100 : Math.round([...this.pendingMessages.values()].filter((m) => m.responded).length / Math.max(this.pendingMessages.size, 1) * 100),
      liveCount,
      deadCount,
      totalOracles: EXPECTED_ORACLES.size,
      oracles,
      alerts: [...this.commAlerts],
      restartLog: this.restartLog.slice(-20)
    };
    this.lastHealthSummary = summary;
    this.broadcast(JSON.stringify({ type: "oracle-health", health: summary }));
  }
  trackPendingMessages(entries) {
    const now = Date.now();
    for (const entry of entries) {
      if (entry.ch === "heartbeat")
        continue;
      const from = entry.from || "";
      const to = entry.to || "";
      if (EXPECTED_ORACLES.has(to) && isTrackableSender(from)) {
        const key = `${entry.ts}:${to}`;
        if (!this.pendingMessages.has(key)) {
          this.pendingMessages.set(key, {
            id: key,
            from,
            to,
            ts: now,
            msg: (entry.msg || "").slice(0, 100),
            responded: false,
            alertedTier: 0
          });
        }
      }
      if (EXPECTED_ORACLES.has(from)) {
        for (const [key, pm] of this.pendingMessages) {
          if (pm.to === from && !pm.responded) {
            pm.responded = true;
          }
        }
      }
    }
    for (const [key, pm] of this.pendingMessages) {
      if (pm.responded)
        continue;
      const waitingMin = (now - pm.ts) / 60000;
      const tier = getTier(waitingMin);
      if (tier > 0 && tier > pm.alertedTier) {
        pm.alertedTier = tier;
        const alert = {
          id: alertId("no-response", pm.to, pm.from),
          type: "no-response",
          oracle: pm.to,
          from: pm.from,
          waitingMin: Math.round(waitingMin),
          tier,
          ts: new Date().toISOString()
        };
        this.emitAlert(alert);
      }
      if (waitingMin > 24 * 60) {
        this.pendingMessages.delete(key);
      }
    }
  }
  emitAlert(alert) {
    this.commAlerts = this.commAlerts.filter((a) => a.id !== alert.id);
    this.commAlerts.push(alert);
    if (this.commAlerts.length > 50)
      this.commAlerts = this.commAlerts.slice(-50);
    this.broadcast(JSON.stringify({ type: "comm-alert", alert }));
  }
  appendHealthLog(message) {
    try {
      const line = `${new Date().toISOString()} | ${message}
`;
      appendFileSync6(HEALTH_LOG_PATH, line);
    } catch {}
  }
  startIntervals() {
    if (this.captureInterval)
      return;
    this.captureInterval = setInterval(() => {
      for (const ws of this.clients)
        this.pushCapture(ws);
    }, 1000);
    this.sessionInterval = setInterval(() => this.broadcastSessions(), 5000);
    this.previewInterval = setInterval(() => {
      for (const ws of this.clients)
        this.pushPreviews(ws);
    }, 2000);
    this.feedTailer.start();
    this.feedUnsub = this.feedTailer.onEvent((event) => {
      const msg = JSON.stringify({ type: "feed", event });
      for (const ws of this.clients)
        ws.send(msg);
    });
    try {
      this.mawLogOffset = statSync4(MAW_LOG_PATH).size;
    } catch {
      this.mawLogOffset = 0;
    }
    this.mawLogInterval = setInterval(() => this.checkMawLog(), 2000);
    this.healthInterval = setInterval(() => this.checkOracleHealth(), 30000);
  }
  checkMawLog() {
    try {
      const size = statSync4(MAW_LOG_PATH).size;
      if (size <= this.mawLogOffset)
        return;
      const buf = Buffer.alloc(size - this.mawLogOffset);
      const fd = __require("fs").openSync(MAW_LOG_PATH, "r");
      __require("fs").readSync(fd, buf, 0, buf.length, this.mawLogOffset);
      __require("fs").closeSync(fd);
      this.mawLogOffset = size;
      const lines = buf.toString("utf-8").split(`
`).filter(Boolean);
      const entries = [];
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {}
      }
      if (entries.length > 0) {
        if (this.clients.size > 0) {
          const msg = JSON.stringify({ type: "maw-log", entries });
          for (const ws of this.clients)
            ws.send(msg);
        }
        this.trackPendingMessages(entries);
      }
    } catch {}
  }
  stopIntervals() {
    if (this.clients.size > 0)
      return;
    if (this.captureInterval) {
      clearInterval(this.captureInterval);
      this.captureInterval = null;
    }
    if (this.sessionInterval) {
      clearInterval(this.sessionInterval);
      this.sessionInterval = null;
    }
    if (this.previewInterval) {
      clearInterval(this.previewInterval);
      this.previewInterval = null;
    }
    if (this.mawLogInterval) {
      clearInterval(this.mawLogInterval);
      this.mawLogInterval = null;
    }
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
    if (this.feedUnsub) {
      this.feedUnsub();
      this.feedUnsub = null;
    }
    this.feedTailer.stop();
  }
}
var HEALTH_LOG_PATH, FEED_ORACLE_NAMES;
var init_engine = __esm(() => {
  init_ssh();
  init_tmux();
  init_handlers();
  init_maw_log();
  init_oracle_health();
  HEALTH_LOG_PATH = join28(homedir13(), ".oracle", "oracle-health.log");
  FEED_ORACLE_NAMES = {
    bob: "BoB-Oracle",
    dev: "Dev-Oracle",
    qa: "QA-Oracle",
    researcher: "Researcher-Oracle",
    writer: "Writer-Oracle",
    designer: "Designer-Oracle",
    hr: "HR-Oracle",
    aia: "AIA-Oracle",
    data: "Data-Oracle",
    admin: "Admin-Oracle",
    botdev: "BotDev-Oracle",
    creator: "Creator-Oracle",
    doc: "DocCon-Oracle",
    editor: "Editor-Oracle",
    security: "Security-Oracle",
    fe: "FE-Oracle",
    pa: "PA-Oracle"
  };
});

// src/lib/federation-auth.ts
function signRequest(method, path, token) {
  const timestamp = Date.now().toString();
  const payload = `${method}:${path}:${timestamp}`;
  const hmac = new Bun.CryptoHasher("sha256", token);
  hmac.update(payload);
  const signature = hmac.digest("hex");
  return { timestamp, signature };
}
function signHeaders(token, method, path) {
  const { timestamp, signature } = signRequest(method, path, token);
  return {
    "X-Maw-Timestamp": timestamp,
    "X-Maw-Signature": signature
  };
}
function verifyRequest(method, path, timestamp, signature) {
  if (!timestamp || !signature)
    return false;
  const config = loadConfig();
  const token = config.federationToken;
  if (!token)
    return false;
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts))
    return false;
  const drift = Math.abs(Date.now() - ts);
  if (drift > MAX_DRIFT_MS)
    return false;
  const payload = `${method}:${path}:${timestamp}`;
  const hmac = new Bun.CryptoHasher("sha256", token);
  hmac.update(payload);
  const expected = hmac.digest("hex");
  return signature === expected;
}
function requireHmac() {
  return async (c, next) => {
    const timestamp = c.req.header("x-maw-timestamp");
    const signature = c.req.header("x-maw-signature");
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;
    if (!verifyRequest(method, path, timestamp, signature)) {
      return c.json({ error: "invalid or missing HMAC signature" }, 401);
    }
    await next();
  };
}
var MAX_DRIFT_MS = 60000;
var init_federation_auth = __esm(() => {
  init_config();
});

// src/lib/peers.ts
function isCacheValid() {
  return !!cache && Date.now() - cache.ts < CACHE_TTL;
}
function getNamedPeers() {
  const config = loadConfig();
  return config.namedPeers || [];
}
async function checkPeerHealth() {
  const peers = getNamedPeers();
  if (peers.length === 0)
    return [];
  const results = await Promise.allSettled(peers.map(async (peer) => {
    const start = performance.now();
    try {
      const res = await fetch(`${peer.url}/api/config`, {
        signal: AbortSignal.timeout(5000)
      });
      const latencyMs = Math.round(performance.now() - start);
      return {
        name: peer.name,
        url: peer.url,
        reachable: res.ok,
        latencyMs
      };
    } catch {
      return {
        name: peer.name,
        url: peer.url,
        reachable: false,
        latencyMs: null
      };
    }
  }));
  return results.map((r) => r.status === "fulfilled" ? r.value : { name: "unknown", url: "", reachable: false, latencyMs: null });
}
async function aggregateAgents(localSessions) {
  const config = loadConfig();
  const nodeName = config.node || "local";
  const agents = {};
  const staticAgents = config.agents || {};
  for (const [name, node] of Object.entries(staticAgents)) {
    if (typeof node === "string" && node)
      agents[name] = node;
  }
  for (const s of localSessions) {
    const name = s.replace(/^\d+-/, "");
    agents[name] = nodeName;
  }
  if (isCacheValid() && cache) {
    Object.assign(agents, cache.agents);
    return agents;
  }
  const peers = getNamedPeers();
  const remoteAgents = {};
  await Promise.allSettled(peers.map(async (peer) => {
    try {
      const res = await fetch(`${peer.url}/api/config`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok)
        return;
      const data = await res.json();
      if (data.agents) {
        for (const [name, node] of Object.entries(data.agents)) {
          remoteAgents[name] = node;
        }
      }
    } catch {}
  }));
  cache = { agents: remoteAgents, sessions: [], ts: Date.now() };
  Object.assign(agents, remoteAgents);
  return agents;
}
async function crossNodeSend(target, text) {
  const colonIdx = target.indexOf(":");
  if (colonIdx === -1)
    return { ok: false, error: "not a cross-node target" };
  const nodeName = target.slice(0, colonIdx);
  const remoteTarget = target.slice(colonIdx + 1);
  const config = loadConfig();
  const peers = config.namedPeers || [];
  const peer = peers.find((p) => p.name === nodeName);
  if (!peer)
    return { ok: false, error: `unknown peer: ${nodeName}` };
  const path = "/api/federation/send";
  const token = config.federationToken;
  if (!token)
    return { ok: false, error: "no federationToken configured" };
  const { timestamp, signature } = signRequest("POST", path, token);
  try {
    const res = await fetch(`${peer.url}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Maw-Timestamp": timestamp,
        "X-Maw-Signature": signature
      },
      body: JSON.stringify({ target: remoteTarget, text, from: config.node || "unknown" }),
      signal: AbortSignal.timeout(1e4)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `peer responded ${res.status}: ${body}` };
    }
    return { ok: true, forwarded: true };
  } catch (e) {
    return { ok: false, error: `peer unreachable: ${e.message}` };
  }
}
async function aggregateSessions(localSessions) {
  const config = loadConfig();
  const nodeName = config.node || "local";
  const tagged = localSessions.map((s) => ({
    ...s,
    node: nodeName
  }));
  const peers = getNamedPeers();
  if (peers.length === 0)
    return { sessions: tagged, nodes: [nodeName] };
  const nodes = [nodeName];
  const remoteSessions = [];
  await Promise.allSettled(peers.map(async (peer) => {
    try {
      const res = await fetch(`${peer.url}/api/sessions`, {
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok)
        return;
      const data = await res.json();
      const sessions = Array.isArray(data) ? data : data.sessions || [];
      for (const s of sessions) {
        remoteSessions.push({ ...s, node: peer.name });
      }
      nodes.push(peer.name);
    } catch {}
  }));
  return { sessions: [...tagged, ...remoteSessions], nodes };
}
var cache = null, CACHE_TTL = 30000;
var init_peers = __esm(() => {
  init_config();
  init_federation_auth();
});

// src/progress.ts
function readProgress() {
  return [...progressMap.values()];
}
function getOracleProgress(oracle) {
  return progressMap.get(oracle);
}
var progressMap;
var init_progress = __esm(() => {
  progressMap = new Map;
});

// src/pty.ts
function isLocalHost() {
  const host = process.env.MAW_HOST || loadConfig().host || "white.local";
  return host === "local" || host === "localhost";
}
function findSession(ws) {
  for (const s of sessions.values()) {
    if (s.viewers.has(ws))
      return s;
  }
}
function handlePtyMessage(ws, msg) {
  if (typeof msg !== "string") {
    const session = findSession(ws);
    if (session?.proc.stdin) {
      session.proc.stdin.write(msg);
      session.proc.stdin.flush();
    }
    return;
  }
  try {
    const data = JSON.parse(msg);
    if (data.type === "attach")
      attach(ws, data.target, data.cols || 120, data.rows || 40);
    else if (data.type === "resize")
      resize(ws, data.cols, data.rows);
    else if (data.type === "detach")
      detach(ws);
  } catch {}
}
function handlePtyClose(ws) {
  detach(ws);
}
async function attach(ws, target, cols, rows) {
  const safe = target.replace(/[^a-zA-Z0-9\-_:.]/g, "");
  if (!safe)
    return;
  detach(ws);
  let session = sessions.get(safe);
  if (session) {
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer);
      session.cleanupTimer = null;
    }
    session.viewers.add(ws);
    ws.send(JSON.stringify({ type: "attached", target: safe }));
    return;
  }
  const sessionName = safe.split(":")[0];
  const windowPart = safe.includes(":") ? safe.split(":").slice(1).join(":") : "";
  const c = Math.max(1, Math.min(500, Math.floor(cols)));
  const r = Math.max(1, Math.min(200, Math.floor(rows)));
  const ptySessionName = `maw-pty-${++nextPtyId}`;
  try {
    await tmux.newGroupedSession(sessionName, ptySessionName, {
      cols: c,
      rows: r,
      window: windowPart || undefined
    });
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Failed to create PTY session" }));
    return;
  }
  let args;
  if (isLocalHost()) {
    const cmd = `stty rows ${r} cols ${c} 2>/dev/null; TERM=xterm-256color tmux attach-session -t '${ptySessionName}'`;
    args = ["script", "-qfc", cmd, "/dev/null"];
  } else {
    const host = process.env.MAW_HOST || loadConfig().host || "white.local";
    args = ["ssh", "-tt", host, `TERM=xterm-256color tmux attach-session -t '${ptySessionName}'`];
  }
  let proc;
  try {
    proc = Bun.spawn(args, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, TERM: "xterm-256color" }
    });
  } catch (e) {
    ws.send(JSON.stringify({ type: "error", message: `PTY spawn failed: ${e.message}` }));
    tmux.killSession(ptySessionName);
    return;
  }
  session = { proc, target: safe, ptySessionName, viewers: new Set([ws]), cleanupTimer: null };
  sessions.set(safe, session);
  ws.send(JSON.stringify({ type: "attached", target: safe }));
  const s = session;
  const reader = proc.stdout.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done)
          break;
        for (const v of s.viewers) {
          try {
            v.send(value);
          } catch {}
        }
      }
    } catch {}
    sessions.delete(safe);
    tmux.killSession(s.ptySessionName);
    for (const v of s.viewers) {
      try {
        v.send(JSON.stringify({ type: "detached", target: safe }));
      } catch {}
    }
  })();
}
function resize(_ws, _cols, _rows) {}
function detach(ws) {
  for (const [target, session] of sessions) {
    if (!session.viewers.has(ws))
      continue;
    session.viewers.delete(ws);
    if (session.viewers.size === 0) {
      session.cleanupTimer = setTimeout(() => {
        try {
          session.proc.kill();
        } catch {}
        tmux.killSession(session.ptySessionName);
        sessions.delete(target);
      }, 5000);
    }
  }
}
var nextPtyId = 0, sessions;
var init_pty = __esm(() => {
  init_tmux();
  init_config();
  sessions = new Map;
});

// src/auto-report.ts
function installAutoReport(_feedTailer) {}

// src/server.ts
var exports_server = {};
__export(exports_server, {
  startServer: () => startServer,
  app: () => app
});
import { readdirSync as readdirSync12, readFileSync as readFileSync20, writeFileSync as writeFileSync12, renameSync as renameSync3, unlinkSync as unlinkSync2, existsSync as existsSync15 } from "fs";
import { join as join29, basename as basename4 } from "path";
import { mkdirSync as mkdirSync9 } from "fs";
import { randomUUID } from "crypto";
import { extname } from "path";
import { appendFileSync as appendFileSync7 } from "fs";
function isInternalOnly(path) {
  if (INTERNAL_ONLY_PATHS.has(path))
    return true;
  if (path.startsWith("/api/progress/"))
    return true;
  return false;
}
function isReadOnlyCmd(cmd) {
  const trimmed = cmd.trim();
  return READONLY_CMDS.some((prefix) => trimmed === prefix || trimmed.startsWith(prefix + " "));
}
function parseSignature(sig) {
  const m = sig.match(/^\[([^:\]]+):([^\]]+)\]$/);
  if (!m)
    return null;
  return { originHost: m[1], originAgent: m[2], isAnon: m[2].startsWith("anon-") };
}
function resolvePeerUrl(peer) {
  const config = loadConfig();
  const namedPeers = config?.namedPeers ?? [];
  const match2 = namedPeers.find((p) => p.name === peer);
  if (match2)
    return match2.url;
  if (/^[\w.-]+:\d+$/.test(peer))
    return `http://${peer}`;
  if (peer.startsWith("http://") || peer.startsWith("https://"))
    return peer;
  return null;
}
function startServer(port = +(process.env.MAW_PORT || loadConfig().port || 3456)) {
  engine = new MawEngine({ feedTailer });
  installAutoReport(feedTailer);
  const wsHandler = {
    open: (ws) => {
      if (ws.data.mode === "pty")
        return;
      engine.handleOpen(ws);
    },
    message: (ws, msg) => {
      if (ws.data.mode === "pty") {
        handlePtyMessage(ws, msg);
        return;
      }
      engine.handleMessage(ws, msg);
    },
    close: (ws) => {
      if (ws.data.mode === "pty") {
        handlePtyClose(ws);
        return;
      }
      engine.handleClose(ws);
    }
  };
  const fetchHandler = (req, server2) => {
    const url = new URL(req.url);
    if (url.pathname === "/ws/pty" || url.pathname === "/ws") {
      if (!isAuthenticated(req)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const mode = url.pathname === "/ws/pty" ? "pty" : undefined;
      const data = { target: null, previewTargets: new Set, ...mode ? { mode } : {} };
      if (server2.upgrade(req, { data }))
        return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  };
  const server = Bun.serve({ port, fetch: fetchHandler, websocket: wsHandler });
  loopEngine.start((msg) => engine.broadcast(msg));
  tmux.hasSession("shell").then(async (exists) => {
    if (!exists) {
      await tmux.run("new-session", "-d", "-s", "shell", "-x", "200", "-y", "50").catch(() => {});
      setTimeout(() => tmux.run("send-keys", "-t", "shell:0", "claude --dangerously-skip-permissions", "Enter").catch(() => {}), 1000);
    }
  });
  console.log(`maw serve \u2192 http://localhost:${port} (ws://localhost:${port}/ws)`);
  const certPath = join29(import.meta.dir, "../white.local+3.pem");
  const keyPath = join29(import.meta.dir, "../white.local+3-key.pem");
  if (existsSync15(certPath) && existsSync15(keyPath)) {
    const tlsPort = port + 1;
    const tls = { cert: readFileSync20(certPath), key: readFileSync20(keyPath) };
    Bun.serve({ port: tlsPort, tls, fetch: fetchHandler, websocket: wsHandler });
    console.log(`maw serve \u2192 https://localhost:${tlsPort} (wss://localhost:${tlsPort}/ws) [TLS]`);
  }
  return server;
}
function statusHeartbeat() {
  try {
    const cutoff = Date.now() - 15 * 60000;
    const events = feedTailer.getRecent(500).filter((e) => e.ts >= cutoff);
    if (events.length === 0)
      return;
    const workEvents = events.filter((e) => e.event === "PreToolUse" || e.event === "PostToolUse" || e.event === "UserPromptSubmit" || e.event === "SubagentStart");
    if (workEvents.length === 0)
      return;
    const byParent = new Map;
    for (const e of workEvents) {
      const parent = e.oracle.split("-")[0];
      const prev = byParent.get(parent) || { tools: 0, projects: new Set, lastActivity: "" };
      prev.tools++;
      const proj = e.project.split("/").pop() || "";
      if (proj)
        prev.projects.add(proj);
      prev.lastActivity = describeActivity(e);
      byParent.set(parent, prev);
    }
    const rate = realtimeRate(15 * 60);
    const fmt = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;
    const lines = [...byParent.entries()].sort((a, b) => b[1].tools - a[1].tools).map(([name, data]) => `${name}: ${data.tools} actions`);
    const msg = `${byParent.size} oracles, ${workEvents.length} actions
${lines.join(`
`)}
${fmt(rate.totalPerMin)} tok/min (${fmt(rate.inputPerMin)} in, ${fmt(rate.outputPerMin)} out)`;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      from: "system",
      to: "all",
      msg,
      ch: "heartbeat"
    }) + `
`;
    appendFileSync7(MAW_LOG_PATH, entry);
  } catch {}
}
var app, engine = null, INTERNAL_ONLY_PATHS, ORACLE_URL2, roomsPath, pinAttempts, uiStatePath, asksPath, fleetDir, hallOfFamePath, feedTailer, PE_SESSION_TOKEN, PE_COOKIE_NAME = "pe_session", PE_COOKIE_MAX_AGE, READONLY_CMDS, BOB_PANE, loopEngine, JARVIS_API_URL, attachDir;
var init_server2 = __esm(() => {
  init_dist();
  init_cors();
  init_bun();
  init_ssh();
  init_tmux();
  init_overview();
  init_feed_tail();
  init_engine();
  init_loops();
  init_auth();
  init_federation_auth();
  init_peers();
  init_config();
  init_task_log();
  init_projects();
  init_worktrees();
  init_token_index();
  init_maw_log();
  init_progress();
  init_pty();
  init_maw_log();
  init_feed();
  app = new Hono2;
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Private-Network", "true");
  });
  app.use("/api/*", cors());
  app.get("/auth/login", (c) => c.html(LOGIN_PAGE));
  app.post("/auth/login", async (c) => {
    const { username, password } = await c.req.json();
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "direct";
    const result = handleLogin(username, password, c.req.header("user-agent") || "", ip);
    if (result.ok) {
      return c.json({ ok: true }, 200, {
        "Set-Cookie": `maw_session=${result.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
      });
    }
    return c.json({ ok: false, error: result.error }, 401);
  });
  app.get("/auth/logout", (c) => {
    handleLogout(c.req.raw);
    return c.redirect("/auth/login", 302, {
      "Set-Cookie": "maw_session=; Path=/; HttpOnly; Max-Age=0"
    });
  });
  app.post("/auth/logout", (c) => {
    handleLogout(c.req.raw);
    return c.json({ ok: true }, 200, {
      "Set-Cookie": "maw_session=; Path=/; HttpOnly; Max-Age=0"
    });
  });
  app.get("/auth/me", (c) => {
    const authed = isAuthenticated(c.req.raw);
    return c.json({ authenticated: authed, authEnabled: isAuthEnabled() });
  });
  app.get("/api/auth/sessions", (c) => {
    if (!isAuthenticated(c.req.raw))
      return c.json({ error: "unauthorized" }, 401);
    return c.json(getActiveSessions());
  });
  app.get("/auth/qr-generate", (c) => {
    const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "direct";
    const ua = c.req.header("user-agent") || "";
    const result = generateQrToken(ua, ip);
    return c.json(result);
  });
  app.get("/auth/qr-approve", (c) => {
    const token = c.req.query("token");
    if (!token)
      return c.text("Missing token", 400);
    if (!isAuthenticated(c.req.raw)) {
      return c.redirect(`/auth/login?redirect=/auth/qr-approve?token=${encodeURIComponent(token)}`);
    }
    const ua = c.req.header("user-agent") || "Unknown device";
    return c.html(QR_APPROVE_PAGE(token, ua));
  });
  app.post("/auth/qr-approve", async (c) => {
    if (!isAuthenticated(c.req.raw)) {
      return c.json({ ok: false, error: "Not authenticated" }, 401);
    }
    const { token } = await c.req.json();
    if (!token)
      return c.json({ ok: false, error: "Missing token" }, 400);
    const cookie = c.req.header("cookie") || "";
    const match2 = cookie.match(/maw_session=([a-f0-9]+)/);
    const approverSession = match2 ? match2[1] : "unknown";
    const result = approveQrToken(token, approverSession);
    if (!result.ok)
      return c.json(result, 400);
    return c.json({ ok: true });
  });
  app.get("/auth/qr-status", (c) => {
    const token = c.req.query("token");
    if (!token)
      return c.json({ error: "Missing token" }, 400);
    const result = getQrTokenStatus(token);
    if (result.status === "approved" && result.sessionId) {
      return c.json({ status: "approved" }, 200, {
        "Set-Cookie": `maw_session=${result.sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
      });
    }
    return c.json(result);
  });
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/auth/") || path.startsWith("/api/attachments/"))
      return next();
    if (!isAuthenticated(c.req.raw)) {
      if (path.startsWith("/api/") || path.startsWith("/ws")) {
        return c.json({ error: "unauthorized" }, 401);
      }
      return c.redirect("/auth/login");
    }
    return next();
  });
  INTERNAL_ONLY_PATHS = new Set([
    "/api/sessions/federated",
    "/api/feed",
    "/api/tokens",
    "/api/tokens/rate",
    "/api/maw-log",
    "/api/progress",
    "/api/oracle-health"
  ]);
  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (isInternalOnly(path)) {
      const cfIp = c.req.header("cf-connecting-ip");
      if (cfIp) {
        return c.json({ error: "internal_only", hint: "This endpoint is not available externally" }, 403);
      }
    }
    return next();
  });
  app.get("/api/sessions", async (c) => c.json(await listSessions()));
  app.get("/api/capture", async (c) => {
    const target = c.req.query("target");
    if (!target)
      return c.json({ error: "target required" }, 400);
    try {
      return c.json({ content: await capture(target) });
    } catch (e) {
      return c.json({ content: "", error: e.message });
    }
  });
  app.get("/api/mirror", async (c) => {
    const target = c.req.query("target");
    if (!target)
      return c.text("target required", 400);
    const lines = +(c.req.query("lines") || "40");
    const raw2 = await capture(target);
    return c.text(processMirror(raw2, lines));
  });
  app.post("/api/send", async (c) => {
    const { target, text } = await c.req.json();
    if (!target || !text)
      return c.json({ error: "target and text required" }, 400);
    if (target.includes(":")) {
      const result = await crossNodeSend(target, text);
      if (!result.ok)
        return c.json({ error: result.error }, 502);
      return c.json({ ok: true, target, text, forwarded: true });
    }
    await sendKeys(target, text);
    return c.json({ ok: true, target, text });
  });
  app.post("/api/federation/send", requireHmac(), async (c) => {
    const { target, text, from: senderName } = await c.req.json();
    if (!target || !text)
      return c.json({ error: "target and text required" }, 400);
    const sessions2 = await listSessions();
    const resolved = findWindow2(sessions2, target) || target;
    await sendKeys(resolved, text);
    try {
      const { appendFileSync: appendFileSync8, mkdirSync: mkdirSync10 } = await import("fs");
      const { join: join30 } = await import("path");
      const { homedir: homedir14, hostname: hostname2 } = await import("os");
      const home = homedir14();
      const host = hostname2();
      const from = senderName || "federation";
      const ts = new Date().toISOString();
      const logDir = join30(home, ".oracle");
      mkdirSync10(logDir, { recursive: true });
      appendFileSync8(join30(logDir, "maw-log.jsonl"), JSON.stringify({ ts, from, to: target, target: resolved, msg: text, host, sid: null }) + `
`);
      const now = new Date;
      const pad = (n) => String(n).padStart(2, "0");
      const feedTs = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const flat = text.replace(/\n/g, " \u239C ");
      appendFileSync8(join30(logDir, "feed.log"), `${feedTs} | ${from} | ${host} | Notification | ${from} | maw-hey \xBB [handoff] ${JSON.stringify({ from, to: target, message: flat })}
`);
      const inboxDir = join30(logDir, "inbox");
      const inboxTarget = target.replace(/[^a-zA-Z0-9_-]/g, "");
      if (inboxTarget) {
        mkdirSync10(inboxDir, { recursive: true });
        appendFileSync8(join30(inboxDir, `${inboxTarget}.jsonl`), JSON.stringify({ ts, from, type: "msg", msg: text, thread: null }) + `
`);
      }
    } catch {}
    return c.json({ ok: true, target: resolved, original: target !== resolved ? target : undefined, text });
  });
  app.post("/api/select", async (c) => {
    const { target } = await c.req.json();
    if (!target)
      return c.json({ error: "target required" }, 400);
    await selectWindow(target);
    return c.json({ ok: true, target });
  });
  app.get("/", serveStatic2({ root: "./dist-office", path: "/index.html" }));
  app.get("/assets/*", serveStatic2({ root: "./dist-office" }));
  app.get("/favicon.svg", serveStatic2({ root: "./dist-office" }));
  app.get("/*.html", serveStatic2({ root: "./dist-office" }));
  app.get("/*.mp3", serveStatic2({ root: "./dist-office" }));
  app.get("/office-8bit", serveStatic2({ root: "./dist-8bit-office", path: "/index.html" }));
  app.get("/office-8bit/*", serveStatic2({
    root: "./",
    rewriteRequestPath: (p) => p.replace(/^\/office-8bit/, "/dist-8bit-office")
  }));
  app.get("/war-room", serveStatic2({ root: "./dist-war-room", path: "/index.html" }));
  app.get("/war-room/*", serveStatic2({
    root: "./",
    rewriteRequestPath: (p) => p.replace(/^\/war-room/, "/dist-war-room")
  }));
  app.get("/race-track", serveStatic2({ root: "./dist-race-track", path: "/index.html" }));
  app.get("/race-track/*", serveStatic2({
    root: "./",
    rewriteRequestPath: (p) => p.replace(/^\/race-track/, "/dist-race-track")
  }));
  app.get("/superman", serveStatic2({ root: "./dist-superman", path: "/index.html" }));
  app.get("/superman/*", serveStatic2({
    root: "./",
    rewriteRequestPath: (p) => p.replace(/^\/superman/, "/dist-superman")
  }));
  ORACLE_URL2 = process.env.ORACLE_URL || loadConfig().oracleUrl;
  app.get("/api/oracle/search", async (c) => {
    const q2 = c.req.query("q");
    if (!q2)
      return c.json({ error: "q required" }, 400);
    const params = new URLSearchParams({ q: q2, mode: c.req.query("mode") || "hybrid", limit: c.req.query("limit") || "10" });
    const model = c.req.query("model");
    if (model)
      params.set("model", model);
    try {
      const res = await fetch(`${ORACLE_URL2}/api/search?${params}`);
      return c.json(await res.json());
    } catch (e) {
      return c.json({ error: `Oracle unreachable: ${e.message}` }, 502);
    }
  });
  app.get("/api/oracle/traces", async (c) => {
    const limit = c.req.query("limit") || "10";
    try {
      const res = await fetch(`${ORACLE_URL2}/api/traces?limit=${limit}`);
      return c.json(await res.json());
    } catch (e) {
      return c.json({ error: `Oracle unreachable: ${e.message}` }, 502);
    }
  });
  app.get("/api/oracle/stats", async (c) => {
    try {
      const res = await fetch(`${ORACLE_URL2}/api/stats`);
      return c.json(await res.json());
    } catch (e) {
      return c.json({ error: `Oracle unreachable: ${e.message}` }, 502);
    }
  });
  roomsPath = join29(import.meta.dir, "../rooms.json");
  app.get("/api/rooms", (c) => {
    try {
      if (!existsSync15(roomsPath))
        return c.json({ rooms: [] });
      return c.json(JSON.parse(readFileSync20(roomsPath, "utf-8")));
    } catch {
      return c.json({ rooms: [] });
    }
  });
  app.post("/api/rooms", async (c) => {
    try {
      const body = await c.req.json();
      body.updatedAt = new Date().toISOString();
      writeFileSync12(roomsPath, JSON.stringify(body, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  pinAttempts = new Map;
  app.get("/api/pin-info", (c) => {
    const config = loadConfig();
    const pin = config.pin || "";
    return c.json({ length: pin.length, enabled: pin.length > 0 });
  });
  app.post("/api/pin-set", async (c) => {
    const { pin } = await c.req.json();
    const newPin = typeof pin === "string" ? pin.replace(/\D/g, "") : "";
    saveConfig({ pin: newPin });
    return c.json({ ok: true, length: newPin.length, enabled: newPin.length > 0 });
  });
  app.post("/api/pin-verify", async (c) => {
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "local";
    const now = Date.now();
    const entry = pinAttempts.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + 60000;
    }
    entry.count++;
    pinAttempts.set(ip, entry);
    if (entry.count > 5) {
      return c.json({ ok: false, error: "Too many attempts. Wait 1 minute." }, 429);
    }
    const { pin } = await c.req.json();
    const config = loadConfig();
    const correct = config.pin || "";
    if (!correct)
      return c.json({ ok: true });
    const ok = pin === correct;
    if (ok)
      pinAttempts.delete(ip);
    return c.json({ ok });
  });
  uiStatePath = join29(import.meta.dir, "../ui-state.json");
  app.get("/api/ui-state", (c) => {
    try {
      if (!existsSync15(uiStatePath))
        return c.json({});
      return c.json(JSON.parse(readFileSync20(uiStatePath, "utf-8")));
    } catch {
      return c.json({});
    }
  });
  app.post("/api/ui-state", async (c) => {
    try {
      const body = await c.req.json();
      writeFileSync12(uiStatePath, JSON.stringify(body, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  asksPath = join29(import.meta.dir, "../asks.json");
  app.get("/api/asks", (c) => {
    try {
      if (!existsSync15(asksPath))
        return c.json([]);
      const asks = JSON.parse(readFileSync20(asksPath, "utf-8"));
      const clean = asks.filter((a) => {
        const msg = (a.message || "").toLowerCase();
        return !msg.includes("waiting for input") && !msg.includes("waiting for your input");
      });
      return c.json(clean);
    } catch {
      return c.json([]);
    }
  });
  app.post("/api/asks", async (c) => {
    try {
      const body = await c.req.json();
      writeFileSync12(asksPath, JSON.stringify(body, null, 2), "utf-8");
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  app.get("/api/task-log", (c) => {
    const taskId = c.req.query("taskId");
    if (!taskId)
      return c.json({ error: "taskId required" }, 400);
    return c.json({ taskId, activities: readTaskLog(taskId) });
  });
  app.get("/api/task-log/summaries", (c) => {
    return c.json(getAllLogSummaries());
  });
  app.post("/api/task-log", async (c) => {
    try {
      const body = await c.req.json();
      if (!body.taskId || !body.content)
        return c.json({ error: "taskId and content required" }, 400);
      const activity = appendActivity({
        taskId: body.taskId,
        type: body.type || "note",
        oracle: body.oracle || "api",
        content: body.content,
        meta: body.meta
      });
      return c.json({ ok: true, activity });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  app.get("/api/projects", (c) => {
    return c.json(loadProjects());
  });
  app.post("/api/projects", async (c) => {
    try {
      const body = await c.req.json();
      if (body.action === "create") {
        const project = createProject(body.id, body.name, body.description || "");
        return c.json({ ok: true, project });
      } else if (body.action === "update") {
        const project = updateProject(body.id, body.updates || {});
        return c.json({ ok: true, project });
      } else if (body.action === "add-task") {
        addTaskToProject(body.projectId, body.taskId, body.parentTaskId);
        return c.json({ ok: true });
      } else if (body.action === "remove-task") {
        removeTaskFromProject(body.projectId, body.taskId);
        return c.json({ ok: true });
      } else if (body.action === "auto-organize") {
        const { fetchBoardData: fetchBoard } = await Promise.resolve().then(() => (init_board(), exports_board));
        const items = await fetchBoard();
        const result = autoOrganize(items);
        return c.json({ ok: true, ...result });
      } else {
        return c.json({ error: "unknown action" }, 400);
      }
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  app.get("/api/project-board", async (c) => {
    try {
      const { fetchBoardData: fetchBoard } = await Promise.resolve().then(() => (init_board(), exports_board));
      const items = await fetchBoard(c.req.query("filter") || undefined);
      const data = getProjectBoardData(items);
      return c.json(data);
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });
  fleetDir = join29(import.meta.dir, "../fleet");
  app.get("/api/fleet-config", (c) => {
    try {
      const files = readdirSync12(fleetDir).filter((f) => f.endsWith(".json") && !f.endsWith(".disabled"));
      const configs = files.map((f) => JSON.parse(readFileSync20(join29(fleetDir, f), "utf-8")));
      return c.json({ configs });
    } catch (e) {
      return c.json({ configs: [], error: e.message });
    }
  });
  app.get("/api/config-files", (c) => {
    const files = [
      { name: "maw.config.json", path: "maw.config.json", enabled: true }
    ];
    try {
      const entries = readdirSync12(fleetDir).filter((f) => f.endsWith(".json") || f.endsWith(".json.disabled")).sort();
      for (const f of entries) {
        const enabled = !f.endsWith(".disabled");
        files.push({ name: f, path: `fleet/${f}`, enabled });
      }
    } catch {}
    return c.json({ files });
  });
  app.get("/api/config-file", (c) => {
    const filePath = c.req.query("path");
    if (!filePath)
      return c.json({ error: "path required" }, 400);
    const fullPath = join29(import.meta.dir, "..", filePath);
    if (!existsSync15(fullPath))
      return c.json({ error: "not found" }, 404);
    try {
      const content = readFileSync20(fullPath, "utf-8");
      if (filePath === "maw.config.json") {
        const data = JSON.parse(content);
        const display = configForDisplay();
        data.env = display.envMasked;
        return c.json({ content: JSON.stringify(data, null, 2) });
      }
      return c.json({ content });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });
  app.post("/api/config-file", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath)
      return c.json({ error: "path required" }, 400);
    if (filePath !== "maw.config.json" && !filePath.startsWith("fleet/")) {
      return c.json({ error: "invalid path" }, 403);
    }
    try {
      const { content } = await c.req.json();
      JSON.parse(content);
      const fullPath = join29(import.meta.dir, "..", filePath);
      if (filePath === "maw.config.json") {
        const parsed = JSON.parse(content);
        if (parsed.env && typeof parsed.env === "object") {
          const current = loadConfig();
          for (const [k, v] of Object.entries(parsed.env)) {
            if (/\u2022/.test(v))
              parsed.env[k] = current.env[k] || v;
          }
        }
        saveConfig(parsed);
      } else {
        writeFileSync12(fullPath, content + `
`, "utf-8");
      }
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  app.post("/api/config-file/toggle", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath || !filePath.startsWith("fleet/"))
      return c.json({ error: "invalid path" }, 400);
    const fullPath = join29(import.meta.dir, "..", filePath);
    if (!existsSync15(fullPath))
      return c.json({ error: "not found" }, 404);
    const isDisabled = filePath.endsWith(".disabled");
    const newPath = isDisabled ? fullPath.replace(/\.disabled$/, "") : fullPath + ".disabled";
    const newRelPath = isDisabled ? filePath.replace(/\.disabled$/, "") : filePath + ".disabled";
    renameSync3(fullPath, newPath);
    return c.json({ ok: true, newPath: newRelPath });
  });
  app.delete("/api/config-file", async (c) => {
    const filePath = c.req.query("path");
    if (!filePath || !filePath.startsWith("fleet/"))
      return c.json({ error: "cannot delete" }, 400);
    const fullPath = join29(import.meta.dir, "..", filePath);
    if (!existsSync15(fullPath))
      return c.json({ error: "not found" }, 404);
    unlinkSync2(fullPath);
    return c.json({ ok: true });
  });
  app.put("/api/config-file", async (c) => {
    const { name, content } = await c.req.json();
    if (!name || !name.endsWith(".json"))
      return c.json({ error: "name must end with .json" }, 400);
    const safeName = basename4(name);
    const fullPath = join29(fleetDir, safeName);
    if (existsSync15(fullPath))
      return c.json({ error: "file already exists" }, 409);
    try {
      JSON.parse(content);
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    writeFileSync12(fullPath, content + `
`, "utf-8");
    return c.json({ ok: true, path: `fleet/${safeName}` });
  });
  app.get("/api/config", async (c) => {
    if (c.req.query("raw") === "1")
      return c.json(loadConfig());
    const config = loadConfig();
    const display = configForDisplay();
    const sessions2 = await listSessions().catch(() => []);
    const sessionNames = sessions2.map((s) => typeof s === "string" ? s : s.name || "");
    const agents = await aggregateAgents(sessionNames);
    const namedPeers = {};
    for (const p of config.namedPeers || []) {
      namedPeers[p.name] = p.url;
    }
    return c.json({
      ...display,
      node: config.node || "local",
      agents,
      namedPeers,
      rooms: config.rooms || {},
      federationToken: undefined
    });
  });
  app.post("/api/config", async (c) => {
    try {
      const body = await c.req.json();
      if (body.env && typeof body.env === "object") {
        const current = loadConfig();
        const merged = {};
        for (const [k, v] of Object.entries(body.env)) {
          merged[k] = /\u2022/.test(v) ? current.env[k] || v : v;
        }
        body.env = merged;
      }
      saveConfig(body);
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  app.get("/api/worktrees", async (c) => {
    try {
      return c.json(await scanWorktrees());
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });
  app.post("/api/worktrees/cleanup", async (c) => {
    const { path } = await c.req.json();
    if (!path)
      return c.json({ error: "path required" }, 400);
    try {
      const log = await cleanupWorktree(path);
      return c.json({ ok: true, log });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });
  hallOfFamePath = join29(process.env.HOME || "/home/mbank", "repos/github.com/BankCurfew/HR-Oracle/hall-of-fame/data.json");
  app.get("/api/hall-of-fame", (c) => {
    try {
      if (!existsSync15(hallOfFamePath))
        return c.json({ error: "data.json not found" }, 404);
      return c.json(JSON.parse(readFileSync20(hallOfFamePath, "utf-8")));
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });
  app.get("/api/tokens", (c) => {
    const rebuild = c.req.query("rebuild") === "1";
    const index = rebuild ? buildIndex() : loadIndex();
    if (index.sessions.length === 0)
      return c.json({ error: "No index. GET /api/tokens?rebuild=1" }, 404);
    return c.json({ ...summarize(index), updatedAt: index.updatedAt });
  });
  app.get("/api/tokens/rate", (c) => {
    const mode = c.req.query("mode") || "hour";
    if (mode === "window") {
      const window = Math.min(7200, Math.max(60, +(c.req.query("window") || "300")));
      return c.json(realtimeRate(window));
    }
    const now = new Date;
    const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0);
    const elapsed = Math.max(1, Math.round((now.getTime() - hourStart.getTime()) / 1000));
    const result = realtimeRate(elapsed);
    return c.json({ ...result, hour: now.getHours(), elapsed });
  });
  app.get("/api/maw-log", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    const limit = Math.min(500, +(c.req.query("limit") || "200"));
    let entries = readLog();
    if (from)
      entries = entries.filter((e) => e.from === from || e.to === from);
    if (to)
      entries = entries.filter((e) => e.to === to || e.from === to);
    const total = entries.length;
    entries = entries.slice(-limit);
    return c.json({ entries, total });
  });
  app.get("/api/progress", (c) => {
    return c.json(readProgress());
  });
  app.get("/api/progress/:oracle", (c) => {
    const oracle = c.req.param("oracle").toLowerCase();
    const progress = getOracleProgress(oracle);
    if (!progress)
      return c.json({ error: "no progress found" }, 404);
    return c.json(progress);
  });
  feedTailer = new FeedTailer;
  app.get("/api/feed", (c) => {
    const limit = Math.min(200, +(c.req.query("limit") || "50"));
    const oracle = c.req.query("oracle") || undefined;
    let events = feedTailer.getRecent(limit);
    if (oracle)
      events = events.filter((e) => e.oracle === oracle);
    const active = [...feedTailer.getActive().keys()];
    return c.json({ events: events.reverse(), total: events.length, active_oracles: active });
  });
  app.get("/api/federation/status", async (c) => {
    const peers = await checkPeerHealth();
    return c.json({ peers });
  });
  PE_SESSION_TOKEN = crypto.randomUUID().replace(/-/g, "");
  PE_COOKIE_MAX_AGE = 60 * 60 * 24;
  READONLY_CMDS = ["/dig", "/trace", "/recap", "/standup", "/who-are-you", "/philosophy", "/where-we-are"];
  app.get("/api/peer/session", (c) => {
    c.header("Set-Cookie", `${PE_COOKIE_NAME}=${PE_SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/api/peer; Max-Age=${PE_COOKIE_MAX_AGE}`);
    return c.json({ ok: true, rotates: "on_server_restart" });
  });
  app.post("/api/peer/exec", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object")
      return c.json({ error: "invalid_body" }, 400);
    const { peer, cmd, args = [], signature } = body;
    if (!peer || !cmd || !signature)
      return c.json({ error: "missing_fields", required: ["peer", "cmd", "signature"] }, 400);
    const parsed = parseSignature(signature);
    if (!parsed)
      return c.json({ error: "bad_signature", expected: "[host:agent]" }, 400);
    const readonly = isReadOnlyCmd(cmd);
    if (!readonly) {
      const config = loadConfig();
      const allowed = config?.wormhole?.shellPeers ?? [];
      if (!allowed.includes(parsed.originHost)) {
        return c.json({
          error: "shell_peer_denied",
          origin: parsed.originHost,
          hint: parsed.isAnon ? "anonymous browser visitors are read-only" : "add this origin to config.wormhole.shellPeers to permit shell cmds"
        }, 403);
      }
    }
    const peerUrl = resolvePeerUrl(peer);
    if (!peerUrl)
      return c.json({ error: "unknown_peer", peer }, 404);
    try {
      const start = Date.now();
      const path = "/api/peer/exec";
      const headers = { "Content-Type": "application/json" };
      const config = loadConfig();
      if (config?.federationToken)
        Object.assign(headers, signHeaders(config.federationToken, "POST", path));
      const response = await fetch(`${peerUrl}${path}`, { method: "POST", headers, body: JSON.stringify({ cmd, args, signature }) });
      const text = await response.text();
      return c.json({
        output: text,
        from: peerUrl,
        elapsed_ms: Date.now() - start,
        status: response.status,
        trust_tier: readonly ? "readonly" : "shell_allowlisted"
      });
    } catch (err) {
      return c.json({ error: "relay_failed", peer: peerUrl, reason: err?.message ?? String(err) }, 502);
    }
  });
  app.get("/api/sessions/federated", async (c) => {
    const localSessions = await listSessions().catch(() => []);
    const result = await aggregateSessions(localSessions);
    return c.json(result);
  });
  app.get("/api/oracle-health", (c) => {
    if (!engine) {
      return c.json({ error: "Server not fully initialized", timestamp: new Date().toISOString() }, 503);
    }
    const summary = engine.getHealthSummary();
    if (!summary) {
      return c.json({ error: "Health data not yet available \u2014 check back in 30s", timestamp: new Date().toISOString() }, 503);
    }
    return c.json(summary);
  });
  app.get("/api/bob/state", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const send2 = (data) => {
          controller.enqueue(`data: ${JSON.stringify(data)}

`);
        };
        let lastEmotion = "";
        let idleSince = Date.now();
        const tick = () => {
          const active = feedTailer.getActive();
          const recent = feedTailer.getActive(15000);
          const activeCount = active.size;
          const recentCount = recent.size;
          const hour = (new Date().getUTCHours() + 7) % 24;
          const recentEvents = feedTailer.getRecent(50);
          const now = Date.now();
          const hasRecentError = recentEvents.some((e) => e.event === "PostToolUseFailure" && now - e.ts < 30000);
          const hasRecentComplete = recentEvents.some((e) => e.event === "TaskCompleted" && now - e.ts < 1e4);
          let emotion = "neutral";
          let message = null;
          if (hasRecentError) {
            emotion = "error";
            const errEvent = recentEvents.find((e) => e.event === "PostToolUseFailure" && now - e.ts < 30000);
            message = errEvent ? `${errEvent.oracle}: ${errEvent.message.slice(0, 60)}` : "Something went wrong";
          } else if (hasRecentComplete) {
            emotion = "happy";
            const doneEvent = recentEvents.find((e) => e.event === "TaskCompleted" && now - e.ts < 1e4);
            message = doneEvent ? `${doneEvent.oracle} finished a task!` : "Task done!";
          } else if (activeCount === 0 && hour >= 0 && hour < 6) {
            emotion = "sleeping";
            message = "zzZ...";
          } else if (activeCount === 0) {
            const idleDuration = now - idleSince;
            if (idleDuration > 5 * 60000) {
              emotion = "sleeping";
              message = null;
            } else {
              emotion = "neutral";
              message = null;
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
          if (activeCount > 0)
            idleSince = now;
          const payload = { emotion, message, activeCount, timestamp: new Date().toISOString() };
          if (emotion !== lastEmotion) {
            send2(payload);
            lastEmotion = emotion;
          } else {
            send2(payload);
          }
        };
        tick();
        const id = setInterval(tick, 5000);
        c.req.raw.signal.addEventListener("abort", () => clearInterval(id));
      }
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      }
    });
  });
  BOB_PANE = process.env.BOB_PANE || "01-bob:0";
  app.post("/api/bob/chat", async (c) => {
    const body = await c.req.json();
    if (!body.message?.trim()) {
      return c.json({ error: "message required" }, 400);
    }
    try {
      const before = await capture(BOB_PANE, 40);
      const beforeLines = before.split(`
`).length;
      const proc = Bun.spawn(["bun", "src/cli.ts", "hey", "bob", body.message], {
        cwd: import.meta.dir + "/..",
        stdout: "pipe",
        stderr: "pipe"
      });
      await proc.exited;
      let response = "";
      const maxAttempts = 30;
      let settled = 0;
      for (let i = 0;i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const after = await capture(BOB_PANE, 60);
        const afterLines = after.split(`
`);
        const newLines = afterLines.slice(beforeLines).join(`
`).trim();
        if (newLines.length > 0) {
          if (newLines === response) {
            settled++;
            if (settled >= 3)
              break;
          } else {
            response = newLines;
            settled = 0;
          }
        }
      }
      const clean = response.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
      return c.json({ response: clean || "(BoB didn't respond \u2014 he may be busy)" });
    } catch (err) {
      return c.json({ error: `maw hey error: ${err.message}` }, 500);
    }
  });
  app.get("/api/anti-patterns", (c) => {
    const { runAntiPatternScan: runAntiPatternScan2 } = (init_anti_patterns(), __toCommonJS(exports_anti_patterns));
    return c.json(runAntiPatternScan2());
  });
  app.get("/api/sovereign", (c) => {
    const { getSovereignStatus: getSovereignStatus2, verifySovereignHealth: verifySovereignHealth2 } = (init_sovereign(), __toCommonJS(exports_sovereign));
    return c.json({ status: getSovereignStatus2(), health: verifySovereignHealth2() });
  });
  app.post("/api/wake/:oracle", async (c) => {
    const oracle = c.req.param("oracle");
    try {
      const proc = Bun.spawn(["bun", "run", "src/cli.ts", "wake", oracle], {
        cwd: import.meta.dir.replace(/\/src$/, ""),
        stdout: "pipe",
        stderr: "pipe"
      });
      await proc.exited;
      return c.json({ ok: true, oracle });
    } catch (e) {
      return c.json({ error: e.message }, 500);
    }
  });
  loopEngine = new LoopEngine;
  app.get("/api/loops", (c) => {
    return c.json({ enabled: loopEngine.isEnabled(), loops: loopEngine.getStatus() });
  });
  app.get("/api/loops/history", (c) => {
    const loopId = c.req.query("loopId") || undefined;
    const limit = +(c.req.query("limit") || "50");
    return c.json(loopEngine.getHistory(loopId, limit));
  });
  app.post("/api/loops/trigger", async (c) => {
    const { loopId } = await c.req.json();
    if (!loopId)
      return c.json({ error: "loopId required" }, 400);
    const result = await loopEngine.triggerLoop(loopId);
    return c.json(result);
  });
  app.post("/api/loops/add", async (c) => {
    try {
      const newLoop = await c.req.json();
      if (!newLoop.id || !newLoop.schedule)
        return c.json({ error: "id and schedule required" }, 400);
      const { readFileSync: readFileSync21, writeFileSync: writeFileSync13 } = await import("fs");
      const { join: join30 } = await import("path");
      const loopsPath = join30(import.meta.dir, "../loops.json");
      const config = JSON.parse(readFileSync21(loopsPath, "utf-8"));
      const idx = config.loops.findIndex((l) => l.id === newLoop.id);
      if (idx >= 0) {
        config.loops[idx] = { ...config.loops[idx], ...newLoop };
      } else {
        config.loops.push(newLoop);
      }
      writeFileSync13(loopsPath, JSON.stringify(config, null, 2), "utf-8");
      return c.json({ ok: true, action: idx >= 0 ? "updated" : "added" });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  app.delete("/api/loops", async (c) => {
    const loopId = c.req.query("id");
    if (!loopId)
      return c.json({ error: "id required" }, 400);
    const { readFileSync: readFileSync21, writeFileSync: writeFileSync13 } = await import("fs");
    const { join: join30 } = await import("path");
    const loopsPath = join30(import.meta.dir, "../loops.json");
    const config = JSON.parse(readFileSync21(loopsPath, "utf-8"));
    const before = config.loops.length;
    config.loops = config.loops.filter((l) => l.id !== loopId);
    writeFileSync13(loopsPath, JSON.stringify(config, null, 2), "utf-8");
    return c.json({ ok: config.loops.length < before });
  });
  app.post("/api/loops/toggle", async (c) => {
    const { loopId, enabled } = await c.req.json();
    if (loopId) {
      const ok = loopEngine.toggleLoop(loopId, enabled);
      return c.json({ ok });
    } else {
      loopEngine.toggleEngine(enabled);
      return c.json({ ok: true });
    }
  });
  JARVIS_API_URL = process.env.JARVIS_API_URL || "http://localhost:3200";
  app.all("/api/jarvis/*", async (c) => {
    const path = c.req.path;
    const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
    const target = `${JARVIS_API_URL}${path}${qs}`;
    try {
      const res = await fetch(target, {
        method: c.req.method,
        headers: c.req.method !== "GET" ? { "Content-Type": "application/json" } : {},
        body: c.req.method !== "GET" ? await c.req.text() : undefined
      });
      const data = await res.json();
      return c.json(data, res.status);
    } catch (e) {
      return c.json({ error: `Jarvis API unreachable: ${e.message}` }, 502);
    }
  });
  attachDir = join29(import.meta.dir, "../attachments");
  mkdirSync9(attachDir, { recursive: true });
  app.post("/api/attach", async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!file || !(file instanceof File))
        return c.json({ error: "file required" }, 400);
      if (file.size > 20 * 1024 * 1024)
        return c.json({ error: "file too large (max 20MB)" }, 400);
      const ext = extname(file.name) || "";
      const id = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
      const buf = await file.arrayBuffer();
      const fullPath = join29(attachDir, id);
      writeFileSync12(fullPath, Buffer.from(buf));
      const url = `/api/attachments/${id}`;
      const port = +(process.env.MAW_PORT || loadConfig().port || 3456);
      const localUrl = `http://localhost:${port}${url}`;
      return c.json({ ok: true, id, url, localUrl, name: file.name, size: file.size, mimeType: file.type });
    } catch (e) {
      return c.json({ error: e.message }, 400);
    }
  });
  app.get("/api/attachments/:id", (c) => {
    const id = c.req.param("id");
    if (!id || /[/\\]/.test(id))
      return c.json({ error: "invalid id" }, 400);
    const fullPath = join29(attachDir, id);
    if (!existsSync15(fullPath))
      return c.json({ error: "not found" }, 404);
    const file = Bun.file(fullPath);
    return new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  });
  app.onError((err, c) => c.json({ error: err.message }, 500));
  if (!process.env.MAW_CLI) {
    const server = startServer();
    setTimeout(() => {
      statusHeartbeat();
      setInterval(statusHeartbeat, 15 * 60 * 1000);
    }, 60000);
  }
});

// src/commands/comm.ts
init_ssh();

// src/hooks.ts
import { readFile } from "fs/promises";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
import { spawn } from "child_process";
var CONFIG_PATH = join2(homedir2(), ".oracle", "maw.hooks.json");
var configCache = null;
async function loadConfig2() {
  if (configCache)
    return configCache;
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    configCache = JSON.parse(raw);
    return configCache;
  } catch {
    configCache = {};
    return configCache;
  }
}
function expandPath(p) {
  if (p.startsWith("~/"))
    return join2(homedir2(), p.slice(2));
  return p;
}
function inferCaller() {
  if (process.env.CLAUDE_AGENT_NAME)
    return process.env.CLAUDE_AGENT_NAME;
  const cwd = process.cwd();
  const match = cwd.match(/([^/]+)-oracle/);
  if (match)
    return match[1];
  return "unknown";
}
async function runHook(event, data) {
  const config = await loadConfig2();
  const script = config.hooks?.[event];
  if (!script)
    return;
  const env = {
    ...process.env,
    MAW_EVENT: event,
    MAW_TIMESTAMP: new Date().toISOString(),
    MAW_FROM: data.from || inferCaller(),
    MAW_TO: data.to,
    MAW_MESSAGE: data.message,
    MAW_CHANNEL: data.channel || "hey"
  };
  try {
    const child = spawn("sh", ["-c", expandPath(script)], {
      env,
      stdio: "ignore",
      detached: true
    });
    child.unref();
  } catch {}
}

// src/commands/comm.ts
import { appendFile, mkdir } from "fs/promises";
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";

// src/routing.ts
function resolveTarget(query, config, sessions) {
  if (!query)
    return { type: "error", reason: "empty_query", detail: "no target specified", hint: "usage: maw hey <agent> <message>" };
  const selfNode = config.node ?? "local";
  const localTarget = findWindow2(sessions, query);
  if (localTarget) {
    return { type: "local", target: localTarget };
  }
  if (query.includes(":") && !query.includes("/")) {
    const colonIdx = query.indexOf(":");
    const nodeName = query.slice(0, colonIdx);
    const agentName = query.slice(colonIdx + 1);
    if (!nodeName || !agentName)
      return { type: "error", reason: "empty_node_or_agent", detail: `invalid format: '${query}'`, hint: "use node:agent format (e.g. mba:homekeeper)" };
    if (nodeName === selfNode) {
      const selfTarget = findWindow2(sessions, agentName);
      return selfTarget ? { type: "self-node", target: selfTarget } : { type: "error", reason: "self_not_running", detail: `'${agentName}' not found in local sessions on ${selfNode}`, hint: `maw wake ${agentName}` };
    }
    const peerUrl = findPeerUrl(nodeName, config);
    if (peerUrl) {
      return { type: "peer", peerUrl, target: agentName, node: nodeName };
    }
    return { type: "error", reason: "unknown_node", detail: `node '${nodeName}' not in namedPeers or peers`, hint: "add to maw.config.json namedPeers" };
  }
  const agentNode = config.agents?.[query] || config.agents?.[query.replace(/-oracle$/, "")];
  if (agentNode) {
    if (agentNode === selfNode)
      return { type: "error", reason: "self_not_running", detail: `'${query}' mapped to ${selfNode} (local) but not found in sessions`, hint: `maw wake ${query}` };
    const peerUrl = findPeerUrl(agentNode, config);
    if (peerUrl) {
      return { type: "peer", peerUrl, target: query, node: agentNode };
    }
    return { type: "error", reason: "no_peer_url", detail: `'${query}' mapped to node '${agentNode}' but no URL found`, hint: `add ${agentNode} to maw.config.json namedPeers` };
  }
  return { type: "error", reason: "not_found", detail: `'${query}' not in local sessions or agents map`, hint: "check: maw ls" };
}
function findPeerUrl(nodeName, config) {
  const peer = config.namedPeers?.find((p) => p.name === nodeName);
  if (peer)
    return peer.url;
  return config.peers?.find((p) => p.includes(nodeName));
}

// src/commands/comm.ts
init_config();
async function cmdList() {
  const sessions = await listSessions();
  const targets = [];
  for (const s of sessions) {
    for (const w of s.windows)
      targets.push(`${s.name}:${w.index}`);
  }
  const infos = await getPaneInfos(targets);
  for (const s of sessions) {
    console.log(`\x1B[36m${s.name}\x1B[0m`);
    for (const w of s.windows) {
      const target = `${s.name}:${w.index}`;
      const info = infos[target] || { command: "", cwd: "" };
      const isAgent = /claude|codex|node/i.test(info.command);
      const cwdBroken = info.cwd.includes("(deleted)") || info.cwd.includes("(dead)");
      let dot;
      let suffix = "";
      if (cwdBroken) {
        dot = "\x1B[31m\u25CF\x1B[0m";
        suffix = "  \x1B[31m(path deleted)\x1B[0m";
      } else if (w.active && isAgent) {
        dot = "\x1B[32m\u25CF\x1B[0m";
      } else if (isAgent) {
        dot = "\x1B[34m\u25CF\x1B[0m";
      } else {
        dot = "\x1B[31m\u25CF\x1B[0m";
        suffix = `  \x1B[90m(${info.command || "?"})\x1B[0m`;
      }
      console.log(`  ${dot} ${w.index}: ${w.name}${suffix}`);
    }
  }
}
async function cmdPeek(query) {
  const sessions = await listSessions();
  if (!query) {
    for (const s of sessions) {
      for (const w of s.windows) {
        const target2 = `${s.name}:${w.index}`;
        try {
          const content2 = await capture(target2, 3);
          const lastLine = content2.split(`
`).filter((l) => l.trim()).pop() || "(empty)";
          const dot = w.active ? "\x1B[32m*\x1B[0m" : " ";
          console.log(`${dot} \x1B[36m${w.name.padEnd(22)}\x1B[0m ${lastLine.slice(0, 80)}`);
        } catch {
          console.log(`  \x1B[36m${w.name.padEnd(22)}\x1B[0m (unreachable)`);
        }
      }
    }
    return;
  }
  const target = findWindow(sessions, query);
  if (!target) {
    console.error(`window not found: ${query}`);
    process.exit(1);
  }
  const content = await capture(target);
  console.log(`\x1B[36m--- ${target} ---\x1B[0m`);
  console.log(content);
}
async function cmdSend(query, message, force = false) {
  const config = loadConfig();
  const sessions = await listSessions();
  const resolved = resolveTarget(query, config, sessions);
  if (resolved?.type === "peer") {
    const server = process.env.MAW_SERVER || "http://localhost:3456";
    const crossTarget = `${resolved.node}:${resolved.target}`;
    try {
      const res = await fetch(`${server}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: crossTarget, text: message })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error(`\x1B[31merror\x1B[0m: ${body.error || `HTTP ${res.status}`}`);
        process.exit(1);
      }
      console.log(`\x1B[32msent\x1B[0m \u2192 ${crossTarget}: ${message}`);
      return;
    } catch (e) {
      console.error(`\x1B[31merror\x1B[0m: server unreachable: ${e.message}`);
      process.exit(1);
    }
  }
  if (resolved?.type === "error") {
    console.error(`\x1B[31merror\x1B[0m: ${resolved.detail}`);
    if (resolved.hint)
      console.error(`\x1B[33mhint\x1B[0m:  ${resolved.hint}`);
    process.exit(1);
  }
  const target = resolved?.type === "local" || resolved?.type === "self-node" ? resolved.target : findWindow(sessions, query);
  if (!target) {
    console.error(`window not found: ${query}`);
    process.exit(1);
  }
  if (!force) {
    const cmd = await getPaneCommand(target);
    const isAgent = /claude|codex|node/i.test(cmd);
    if (!isAgent) {
      console.error(`\x1B[31merror\x1B[0m: no active Claude session in ${target} (running: ${cmd})`);
      console.error(`\x1B[33mhint\x1B[0m:  run \x1B[36mmaw wake ${query}\x1B[0m first, or use \x1B[36m--force\x1B[0m to send anyway`);
      process.exit(1);
    }
  }
  await sendKeys(target, message);
  await runHook("after_send", { to: query, message });
  const logDir = join3(homedir3(), ".oracle");
  const logFile = join3(logDir, "maw-log.jsonl");
  const host = (await import("os")).hostname();
  const from = process.env.CLAUDE_AGENT_NAME || "cli";
  const sid = process.env.CLAUDE_SESSION_ID || null;
  const line = JSON.stringify({ ts: new Date().toISOString(), from, to: query, target, msg: message, host, sid }) + `
`;
  try {
    await mkdir(logDir, { recursive: true });
    await appendFile(logFile, line);
  } catch {}
  try {
    const feedLog = join3(homedir3(), ".oracle", "feed.log");
    const now = new Date;
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const flat = message.replace(/\n/g, " \u239C ");
    const feedLine = `${ts} | ${from} | ${host} | Notification | ${from} | maw-hey \xBB [handoff] ${JSON.stringify({ from, to: query, message: flat })}
`;
    await appendFile(feedLog, feedLine);
  } catch {}
  const inboxDir = join3(homedir3(), ".oracle", "inbox");
  const inboxTarget = query.replace(/[^a-zA-Z0-9_-]/g, "");
  if (inboxTarget) {
    const signal = JSON.stringify({ ts: new Date().toISOString(), from, type: "msg", msg: message, thread: null }) + `
`;
    try {
      await mkdir(inboxDir, { recursive: true });
      await appendFile(join3(inboxDir, `${inboxTarget}.jsonl`), signal);
    } catch {}
  }
  console.log(`\x1B[32msent\x1B[0m \u2192 ${target}: ${message}`);
}

// src/commands/view.ts
init_ssh();
init_tmux();
init_config();
async function cmdView(agent, windowHint, clean = false) {
  const sessions = await listSessions();
  const allWindows = sessions.flatMap((s) => s.windows.map((w) => ({ session: s.name, ...w })));
  const agentLower = agent.toLowerCase();
  let sessionName = null;
  for (const s of sessions) {
    const sLower = s.name.toLowerCase();
    if (sLower.endsWith(`-${agentLower}`) || sLower === agentLower) {
      sessionName = s.name;
      break;
    }
    if (s.windows.some((w) => w.name.toLowerCase().includes(agentLower))) {
      sessionName = s.name;
      break;
    }
  }
  if (!sessionName) {
    console.error(`session not found for: ${agent}`);
    process.exit(1);
  }
  const viewName = `${agent}-view${windowHint ? `-${windowHint}` : ""}`;
  const t = new Tmux;
  await t.killSession(viewName);
  await t.newGroupedSession(sessionName, viewName, { cols: 200, rows: 50 });
  console.log(`\x1B[36mcreated\x1B[0m \u2192 ${viewName} (grouped with ${sessionName})`);
  if (windowHint) {
    const win = allWindows.find((w) => w.session === sessionName && (w.name === windowHint || w.name.includes(windowHint) || String(w.index) === windowHint));
    if (win) {
      await t.selectWindow(`${viewName}:${win.index}`);
      console.log(`\x1B[36mwindow\x1B[0m  \u2192 ${win.name} (${win.index})`);
    } else {
      console.error(`\x1B[33mwarn\x1B[0m: window '${windowHint}' not found, using default`);
    }
  }
  if (clean) {
    await t.set(viewName, "status", "off");
  }
  const host = process.env.MAW_HOST || loadConfig().host || "white.local";
  const isLocal = host === "local" || host === "localhost";
  const attachArgs = isLocal ? ["tmux", "attach-session", "-t", viewName] : ["ssh", "-tt", host, `tmux attach-session -t '${viewName}'`];
  console.log(`\x1B[36mattach\x1B[0m  \u2192 ${viewName}${clean ? " (clean)" : ""}`);
  const proc = Bun.spawn(attachArgs, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  await t.killSession(viewName);
  console.log(`\x1B[90mcleaned\x1B[0m \u2192 ${viewName}`);
  process.exit(exitCode);
}

// src/commands/completions.ts
import { readdirSync, readFileSync as readFileSync2 } from "fs";
import { join as join4 } from "path";
async function cmdCompletions(sub) {
  if (sub === "commands") {
    console.log("ls peek hey wake fleet stop done overview about oracle pulse view create-view tab talk-to serve");
  } else if (sub === "oracles" || sub === "windows") {
    const fleetDir = join4(import.meta.dir, "../../fleet");
    const names = new Set;
    try {
      for (const f of readdirSync(fleetDir).filter((f2) => f2.endsWith(".json") && !f2.endsWith(".disabled"))) {
        const config = JSON.parse(readFileSync2(join4(fleetDir, f), "utf-8"));
        for (const w of config.windows || []) {
          if (sub === "oracles") {
            if (w.name.endsWith("-oracle"))
              names.add(w.name.replace(/-oracle$/, ""));
          } else {
            names.add(w.name);
          }
        }
      }
    } catch {}
    console.log([...names].sort().join(`
`));
  } else if (sub === "fleet") {
    console.log("init ls renumber validate sync");
  } else if (sub === "pulse") {
    console.log("add ls list");
  }
}

// src/cli.ts
init_overview();
init_wake();

// src/commands/pulse.ts
init_ssh();
init_wake();
var THAI_DAYS = ["\u0E2D\u0E32\u0E17\u0E34\u0E15\u0E22\u0E4C", "\u0E08\u0E31\u0E19\u0E17\u0E23\u0E4C", "\u0E2D\u0E31\u0E07\u0E04\u0E32\u0E23", "\u0E1E\u0E38\u0E18", "\u0E1E\u0E24\u0E2B\u0E31\u0E2A\u0E1A\u0E14\u0E35", "\u0E28\u0E38\u0E01\u0E23\u0E4C", "\u0E40\u0E2A\u0E32\u0E23\u0E4C"];
function todayDate() {
  const d = new Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayLabel() {
  const d = new Date;
  const date = todayDate();
  const day = THAI_DAYS[d.getDay()];
  return `${date} (${day})`;
}
function timePeriod() {
  const h = new Date().getHours();
  if (h >= 6 && h < 12)
    return "morning";
  if (h >= 12 && h < 18)
    return "afternoon";
  if (h >= 18)
    return "evening";
  return "midnight";
}
var PERIODS = [
  { key: "morning", label: "\uD83C\uDF05 Morning (06:00-12:00)", hours: [6, 12] },
  { key: "afternoon", label: "\u2600\uFE0F Afternoon (12:00-18:00)", hours: [12, 18] },
  { key: "evening", label: "\uD83C\uDF06 Evening (18:00-24:00)", hours: [18, 24] },
  { key: "midnight", label: "\uD83C\uDF19 Midnight (00:00-06:00)", hours: [0, 6] }
];
async function findOrCreateDailyThread(repo) {
  const date = todayDate();
  const label = todayLabel();
  const searchDate = `\uD83D\uDCC5 ${date}`;
  const threadTitle = `\uD83D\uDCC5 ${label} Daily Thread`;
  const existing = (await ssh(`gh issue list --repo ${repo} --search '${searchDate} in:title' --state open --json number,url,title --limit 1`)).trim();
  const parsed = JSON.parse(existing || "[]");
  if (parsed.length > 0 && parsed[0].title.includes(date)) {
    return { url: parsed[0].url, num: parsed[0].number, isNew: false };
  }
  const url = (await ssh(`gh issue create --repo ${repo} -t '${threadTitle.replace(/'/g, "'\\''")}' -b 'Tasks for ${label}' -l daily-thread`)).trim();
  const m = url.match(/\/(\d+)$/);
  const num = m ? +m[1] : 0;
  console.log(`\x1B[32m+\x1B[0m daily thread #${num}: ${url}`);
  return { url, num, isNew: true };
}
async function ensurePeriodComments(repo, threadNum) {
  const commentsJson = (await ssh(`gh api repos/${repo}/issues/${threadNum}/comments --jq '[.[] | {id: .id, body: .body}]'`)).trim();
  const comments = JSON.parse(commentsJson || "[]");
  const result = {};
  for (const p of PERIODS) {
    const existing = comments.find((c) => c.body.startsWith(p.label));
    if (existing) {
      result[p.key] = existing;
    } else {
      const body = `${p.label}

_(no tasks yet)_`;
      const escaped = body.replace(/'/g, "'\\''");
      const created = (await ssh(`gh api repos/${repo}/issues/${threadNum}/comments -f body='${escaped}' --jq '.id'`)).trim();
      result[p.key] = { id: created, body };
    }
  }
  return result;
}
async function addTaskToPeriodComment(repo, threadNum, period, issueNum, title, oracle) {
  const periodComments = await ensurePeriodComments(repo, threadNum);
  const comment = periodComments[period];
  if (!comment)
    return;
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const oracleTag = oracle ? ` \u2192 ${oracle}` : "";
  const taskLine = `- [ ] #${issueNum} ${title} (${now}${oracleTag})`;
  let newBody;
  if (comment.body.includes("_(no tasks yet)_")) {
    newBody = comment.body.replace("_(no tasks yet)_", taskLine);
  } else {
    newBody = comment.body + `
` + taskLine;
  }
  const escaped = newBody.replace(/'/g, "'\\''");
  await ssh(`gh api repos/${repo}/issues/comments/${comment.id} -X PATCH -f body='${escaped}'`);
}
async function cmdPulseAdd(title, opts) {
  const repo = "laris-co/pulse-oracle";
  const projectNum = 6;
  const period = timePeriod();
  const thread = await findOrCreateDailyThread(repo);
  const escaped = title.replace(/'/g, "'\\''");
  const labels = [];
  if (opts.oracle)
    labels.push(`oracle:${opts.oracle}`);
  const labelFlags = labels.length ? labels.map((l) => `-l '${l}'`).join(" ") : "";
  const issueUrl = (await ssh(`gh issue create --repo ${repo} -t '${escaped}' ${labelFlags} -b 'Parent: #${thread.num}'`)).trim();
  const m = issueUrl.match(/\/(\d+)$/);
  const issueNum = m ? +m[1] : 0;
  console.log(`\x1B[32m+\x1B[0m issue #${issueNum} (${period}): ${issueUrl}`);
  await addTaskToPeriodComment(repo, thread.num, period, issueNum, title, opts.oracle);
  console.log(`\x1B[32m+\x1B[0m added to ${period} in daily thread #${thread.num}`);
  try {
    await ssh(`gh project item-add ${projectNum} --owner laris-co --url '${issueUrl}'`);
    console.log(`\x1B[32m+\x1B[0m added to Master Board (#${projectNum})`);
  } catch (e) {
    console.log(`\x1B[33mwarn:\x1B[0m could not add to project board: ${e}`);
  }
  if (opts.oracle) {
    const wakeOpts = {};
    if (opts.wt) {
      wakeOpts.newWt = opts.wt;
    }
    const prompt = `/recap --deep \u2014 You have been assigned issue #${issueNum}: ${title}. Issue URL: ${issueUrl}. Orient yourself, then wait for human instructions.`;
    wakeOpts.prompt = prompt;
    const target = await cmdWake(opts.oracle, wakeOpts);
    console.log(`\x1B[32m\uD83D\uDE80\x1B[0m ${target}: waking up with /recap --deep \u2192 then --continue`);
  }
}
async function cmdPulseLs(opts) {
  const repo = "laris-co/pulse-oracle";
  const issuesJson = (await ssh(`gh issue list --repo ${repo} --state open --json number,title,labels --limit 50`)).trim();
  const issues = JSON.parse(issuesJson || "[]");
  const projects = [];
  const today = [];
  const threads = [];
  for (const issue of issues) {
    const labels = issue.labels.map((l) => l.name);
    if (labels.includes("daily-thread")) {
      threads.push(issue);
      continue;
    }
    if (/^P\d{3}/.test(issue.title)) {
      projects.push(issue);
      continue;
    }
    today.push(issue);
  }
  const toolIssues = [];
  const activeIssues = [];
  for (const issue of today) {
    const isToday = issue.title.includes("Daily") || issue.number > (threads[0]?.number || 0);
    if (isToday && !issue.title.includes("Daily"))
      activeIssues.push(issue);
    else
      toolIssues.push(issue);
  }
  const getOracle = (issue) => {
    const label = issue.labels.find((l) => l.name.startsWith("oracle:"));
    return label ? label.name.replace("oracle:", "") : "\u2014";
  };
  console.log(`
\x1B[36m\uD83D\uDCCB Pulse Board\x1B[0m
`);
  if (projects.length) {
    console.log(`\x1B[33mProjects (${projects.length})\x1B[0m`);
    console.log(`\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u252C${"\u2500".repeat(50)}\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`);
    for (const p of projects.sort((a, b) => a.number - b.number)) {
      const oracle = getOracle(p);
      console.log(`\u2502 \x1B[32m#${String(p.number).padEnd(3)}\x1B[0m \u2502 ${p.title.slice(0, 48).padEnd(48)} \u2502 ${oracle.padEnd(12)} \u2502`);
    }
    console.log(`\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2534${"\u2500".repeat(50)}\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518`);
  }
  if (toolIssues.length) {
    console.log(`
\x1B[33mTools/Infra (${toolIssues.length})\x1B[0m`);
    console.log(`\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u252C${"\u2500".repeat(50)}\u252C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510`);
    for (const t of toolIssues.sort((a, b) => a.number - b.number)) {
      const oracle = getOracle(t);
      console.log(`\u2502 \x1B[32m#${String(t.number).padEnd(3)}\x1B[0m \u2502 ${t.title.slice(0, 48).padEnd(48)} \u2502 ${oracle.padEnd(12)} \u2502`);
    }
    console.log(`\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2534${"\u2500".repeat(50)}\u2534\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518`);
  }
  if (activeIssues.length) {
    console.log(`
\x1B[33mActive Today (${activeIssues.length})\x1B[0m`);
    for (const a of activeIssues.sort((a2, b) => a2.number - b.number)) {
      const oracle = getOracle(a);
      console.log(`  \x1B[33m\uD83D\uDFE1\x1B[0m #${a.number} ${a.title} \u2192 ${oracle}`);
    }
  }
  console.log(`
\x1B[36m${issues.length - threads.length} open\x1B[0m
`);
  if (opts.sync) {
    const thread = threads.find((t) => t.title.includes(todayDate()));
    if (!thread) {
      console.log("No daily thread found for today");
      return;
    }
    const lines = [`## \uD83D\uDCCB Pulse Board Index (${todayLabel()})`, ""];
    if (projects.length) {
      lines.push(`### Projects (${projects.length})`, "");
      for (const p of projects.sort((a, b) => a.number - b.number)) {
        lines.push(`- [ ] #${p.number} ${p.title} \u2192 ${getOracle(p)}`);
      }
      lines.push("");
    }
    if (toolIssues.length) {
      lines.push(`### Tools/Infra (${toolIssues.length})`, "");
      for (const t of toolIssues.sort((a, b) => a.number - b.number)) {
        lines.push(`- [ ] #${t.number} ${t.title} \u2192 ${getOracle(t)}`);
      }
      lines.push("");
    }
    if (activeIssues.length) {
      lines.push(`### Active Today (${activeIssues.length})`, "");
      for (const a of activeIssues.sort((a2, b) => a2.number - b.number)) {
        lines.push(`- [ ] #${a.number} ${a.title} \u2192 ${getOracle(a)} \uD83D\uDFE1`);
      }
      lines.push("");
    }
    lines.push(`**${issues.length - threads.length} open** \u2014 Homekeeper Oracle \uD83E\uDD16`);
    const body = lines.join(`
`).replace(/'/g, "'\\''");
    const commentsJson2 = (await ssh(`gh api repos/${repo}/issues/${thread.number}/comments --jq '[.[] | {id: .id, body: .body}]'`)).trim();
    const comments = JSON.parse(commentsJson2 || "[]");
    const indexComment = comments.find((c) => c.body.includes("Pulse Board Index"));
    if (indexComment) {
      await ssh(`gh api repos/${repo}/issues/comments/${indexComment.id} -X PATCH -f body='${body}'`);
      console.log(`\x1B[32m\u2705\x1B[0m synced to daily thread #${thread.number}`);
    } else {
      await ssh(`gh api repos/${repo}/issues/${thread.number}/comments -f body='${body}'`);
      console.log(`\x1B[32m+\x1B[0m index posted to daily thread #${thread.number}`);
    }
  }
}

// src/cli.ts
init_anti_patterns();

// src/commands/bud.ts
init_ssh();
init_config();
import { readdirSync as readdirSync3, readFileSync as readFileSync6, writeFileSync as writeFileSync2, mkdirSync, existsSync as existsSync3, appendFileSync, symlinkSync } from "fs";
import { join as join8 } from "path";
import { homedir as homedir6 } from "os";
var SOVEREIGN_ROOT = join8(homedir6(), ".oracle", "\u03C8");
var FLEET_DIR = join8(import.meta.dir, "../../fleet");
var FEED_LOG = join8(homedir6(), ".oracle", "feed.log");
var MAX_BUD_DEPTH = 2;
var ORG = "BankCurfew";
var RESERVED_NAMES = new Set([
  "bob",
  "dev",
  "qa",
  "security",
  "hr",
  "admin",
  "data",
  "doc",
  "editor",
  "designer",
  "researcher",
  "writer",
  "botdev",
  "creator",
  "aia",
  "fe",
  "pa",
  "maw",
  "oracle",
  "root",
  "pulse",
  "system"
]);
function logToFeed(oracle, message) {
  try {
    const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
    const line = `${ts} | ${oracle} | ${homedir6().split("/").pop()} | Notification | maw-bud | maw-bud \xBB ${message}
`;
    appendFileSync(FEED_LOG, line);
  } catch {}
}
function loadAllFleetConfigs() {
  try {
    return readdirSync3(FLEET_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync6(join8(FLEET_DIR, f), "utf-8")));
  } catch {
    return [];
  }
}
function findFleetConfig(oracleName) {
  for (const config of loadAllFleetConfigs()) {
    if (config.name.endsWith(`-${oracleName}`))
      return config;
    const win = config.windows?.find((w) => w.name.toLowerCase().replace("-oracle", "") === oracleName.toLowerCase());
    if (win)
      return config;
  }
  return null;
}
function getBudDepth(oracleName) {
  let depth = 0;
  let current = oracleName;
  const configs = loadAllFleetConfigs();
  const visited = new Set;
  while (depth < 10) {
    if (visited.has(current))
      break;
    visited.add(current);
    const config = configs.find((c) => c.name.endsWith(`-${current}`) || c.windows?.some((w) => w.name.toLowerCase().replace("-oracle", "") === current.toLowerCase()));
    if (!config?.budded_from)
      break;
    depth++;
    current = config.budded_from;
  }
  return depth;
}
function getNextFleetNumber() {
  try {
    const files = readdirSync3(FLEET_DIR).filter((f) => f.endsWith(".json"));
    const nums = files.map((f) => parseInt(f.split("-")[0])).filter((n) => !isNaN(n) && n < 90);
    return nums.length > 0 ? Math.max(...nums) + 1 : 19;
  } catch {
    return 19;
  }
}
async function cmdBud(name, opts) {
  const ghqRoot = loadConfig().ghqRoot;
  const parentName = opts.from || detectParentOracle();
  const budName = name.toLowerCase().replace(/_/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-oracle$/, "").replace(/^-+|-+$/g, "");
  if (!budName) {
    console.error(`\x1B[31m\u2717 DENIED\x1B[0m \u2014 Invalid oracle name: "${name}"`);
    process.exit(1);
  }
  const titleCase = budName.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
  const repoName = `${titleCase}-Oracle`;
  const oracleDisplayName = `${titleCase}-Oracle`;
  if (RESERVED_NAMES.has(budName)) {
    console.error(`\x1B[31m\u2717 DENIED\x1B[0m \u2014 "${budName}" is a reserved oracle name`);
    process.exit(1);
  }
  console.log(`
\x1B[36m\uD83E\uDDEC maw bud\x1B[0m \u2014 Oracle Reproduction
`);
  console.log(`  Parent:  ${parentName || "(none \u2014 root oracle)"}`);
  console.log(`  Child:   ${oracleDisplayName}`);
  console.log(`  Repo:    ${ORG}/${repoName}`);
  console.log();
  if (!opts.approvedBy) {
    console.error(`\x1B[31m\u2717 DENIED\x1B[0m \u2014 Security Gate #1: Human approval required`);
    console.error(`  Use: maw bud ${name} --approved-by bank`);
    logToFeed("maw-bud", `DENIED: bud "${budName}" \u2014 no human approval (gate #1)`);
    process.exit(1);
  }
  console.log(`  \x1B[32m\u2713\x1B[0m Gate #1: Approved by ${opts.approvedBy}`);
  if (parentName) {
    const depth = getBudDepth(parentName);
    if (depth >= MAX_BUD_DEPTH) {
      console.error(`\x1B[31m\u2717 DENIED\x1B[0m \u2014 Security Gate #4: Bud depth ${depth + 1} exceeds max ${MAX_BUD_DEPTH}`);
      console.error(`  ${parentName} is already at depth ${depth}. Cannot bud further.`);
      logToFeed("maw-bud", `DENIED: bud "${budName}" from "${parentName}" \u2014 depth ${depth + 1} exceeds max ${MAX_BUD_DEPTH} (gate #4)`);
      process.exit(1);
    }
    console.log(`  \x1B[32m\u2713\x1B[0m Gate #4: Bud depth ${depth + 1}/${MAX_BUD_DEPTH} (OK)`);
  } else {
    console.log(`  \x1B[32m\u2713\x1B[0m Gate #4: Root oracle (depth 0)`);
  }
  console.log(`  \x1B[32m\u2713\x1B[0m Gate #2: Fresh credentials (no parent inheritance \u2014 enforced in Step 6 seed filter)`);
  const buddedAt = new Date().toISOString();
  console.log(`  \x1B[32m\u2713\x1B[0m Gate #5: Dormancy tracked \u2014 budded at ${buddedAt.split("T")[0]}`);
  console.log(`           30d \u2192 credentials suspended, 90d \u2192 revoked + archived`);
  logToFeed("maw-bud", `APPROVED: bud "${budName}" from "${parentName || "root"}" by ${opts.approvedBy}`);
  console.log(`  \x1B[32m\u2713\x1B[0m Gate #3: Audit trail logged to feed.log`);
  console.log();
  if (opts.dryRun) {
    console.log(`\x1B[33m\u26A1 DRY RUN\x1B[0m \u2014 would execute the following:
`);
    printPlan(budName, repoName, oracleDisplayName, parentName, buddedAt);
    return;
  }
  console.log(`\x1B[36mStep 1/8:\x1B[0m Create repo ${ORG}/${repoName}`);
  try {
    await ssh(`gh repo create ${ORG}/${repoName} --private --clone=false --description "Oracle: ${oracleDisplayName}"`);
    console.log(`  \x1B[32m\u2713\x1B[0m Repo created`);
  } catch (e) {
    if (e.message?.includes("already exists") || e.toString().includes("already exists")) {
      console.log(`  \x1B[33m\u26A0\x1B[0m Repo already exists \u2014 continuing`);
    } else {
      throw e;
    }
  }
  const repoPath = join8(ghqRoot, ORG, repoName);
  if (!existsSync3(repoPath)) {
    await ssh(`ghq get ${ORG}/${repoName}`);
    console.log(`  \x1B[32m\u2713\x1B[0m Cloned to ${repoPath}`);
  }
  console.log(`\x1B[36mStep 2/8:\x1B[0m Initialize \u03C8/ vault (sovereign)`);
  const psiSubDirs = [
    "inbox/handoff",
    "memory/learnings",
    "memory/retrospectives",
    "memory/resonance",
    "writing",
    "lab",
    "active",
    "archive",
    "outbox"
  ];
  const sovereignDir = join8(SOVEREIGN_ROOT, budName);
  mkdirSync(sovereignDir, { recursive: true });
  for (const dir of psiSubDirs) {
    mkdirSync(join8(sovereignDir, dir), { recursive: true });
  }
  for (const dir of psiSubDirs) {
    const keepPath = join8(sovereignDir, dir, ".gitkeep");
    if (!existsSync3(keepPath))
      writeFileSync2(keepPath, "");
  }
  const psiSymlinkPath = join8(repoPath, "\u03C8");
  if (!existsSync3(psiSymlinkPath)) {
    symlinkSync(sovereignDir, psiSymlinkPath);
  }
  const gitignore = `.env
.env.*
*.key
*.pem
credentials.json
secrets/
.mcp.json
node_modules/
\u03C8
`;
  writeFileSync2(join8(repoPath, ".gitignore"), gitignore);
  console.log(`  \x1B[32m\u2713\x1B[0m \u03C8/ sovereign vault at ${sovereignDir}`);
  console.log(`  \x1B[32m\u2713\x1B[0m symlink: repo/\u03C8 \u2192 ${sovereignDir}`);
  console.log(`\x1B[36mStep 3/8:\x1B[0m Generate CLAUDE.md`);
  const claudeMd = generateClaudeMd(budName, oracleDisplayName, parentName, buddedAt);
  writeFileSync2(join8(repoPath, "CLAUDE.md"), claudeMd);
  console.log(`  \x1B[32m\u2713\x1B[0m CLAUDE.md generated`);
  console.log(`\x1B[36mStep 4/8:\x1B[0m Create fleet config`);
  const fleetNum = getNextFleetNumber();
  const sessionName = `${String(fleetNum).padStart(2, "0")}-${budName}`;
  const fleetConfig = {
    name: sessionName,
    windows: [{ name: oracleDisplayName, repo: `${ORG}/${repoName}` }],
    budded_from: parentName || undefined,
    budded_at: buddedAt,
    sync_peers: parentName ? [parentName] : []
  };
  const fleetPath = join8(FLEET_DIR, `${sessionName}.json`);
  writeFileSync2(fleetPath, JSON.stringify(fleetConfig, null, 2) + `
`);
  console.log(`  \x1B[32m\u2713\x1B[0m ${sessionName}.json \u2014 budded_from: ${parentName || "root"}`);
  console.log(`\x1B[36mStep 5/8:\x1B[0m Register in oracle family`);
  try {
    const issueBody = [
      `## New Oracle: ${oracleDisplayName}`,
      `- **Budded from**: ${parentName || "root"}`,
      `- **Budded at**: ${buddedAt}`,
      `- **Repo**: ${ORG}/${repoName}`,
      `- **Fleet**: ${sessionName}`,
      `- **Approved by**: ${opts.approvedBy}`,
      `- **Bud depth**: ${parentName ? getBudDepth(parentName) + 1 : 0}`
    ].join(`
`);
    await ssh(`gh issue create --repo ${ORG}/${repoName} --title "\uD83E\uDDEC Birth: ${oracleDisplayName}" --body '${issueBody.replace(/'/g, "'\\''")}'`);
    console.log(`  \x1B[32m\u2713\x1B[0m Birth issue created`);
  } catch {
    console.log(`  \x1B[33m\u26A0\x1B[0m Could not create birth issue (non-blocking)`);
  }
  console.log(`\x1B[36mStep 6/8:\x1B[0m Soul-sync seed (hand-off)`);
  if (parentName) {
    const parentConfig = findFleetConfig(parentName);
    if (parentConfig) {
      const parentRepoPath = join8(ghqRoot, parentConfig.windows?.[0]?.repo || "");
      const parentLearnings = join8(parentRepoPath, "\u03C8/memory/learnings");
      const targetLearnings = join8(repoPath, "\u03C8/memory/learnings");
      if (existsSync3(parentLearnings)) {
        const files = readdirSync3(parentLearnings).filter((f) => f.endsWith(".md") && f !== ".gitkeep").sort().slice(-5);
        let seeded = 0;
        for (const file of files) {
          const content = readFileSync6(join8(parentLearnings, file), "utf-8");
          if (/customer|credential|secret|password|\.env|portfolio|API_KEY|SUPABASE|TOKEN|Bearer|sk-[a-zA-Z0-9]|eyJ[a-zA-Z0-9]|ghp_|xoxb-|xoxp-|PRIVATE.KEY/i.test(content))
            continue;
          const attributed = content + `

---
*Seeded from ${parentName} via maw bud (hand-off)*
`;
          writeFileSync2(join8(targetLearnings, file), attributed);
          seeded++;
        }
        console.log(`  \x1B[32m\u2713\x1B[0m Seeded ${seeded} learnings from ${parentName} (curated, max 5)`);
      } else {
        console.log(`  \x1B[90m\u25CB\x1B[0m No parent learnings found`);
      }
    } else {
      console.log(`  \x1B[90m\u25CB\x1B[0m Parent fleet config not found \u2014 skipping seed`);
    }
  } else {
    console.log(`  \x1B[90m\u25CB\x1B[0m No parent \u2014 skipping seed`);
  }
  console.log(`\x1B[36mStep 7/8:\x1B[0m Initial commit`);
  try {
    await ssh(`cd "${repoPath}" && git add CLAUDE.md .gitignore && git commit -m "\uD83E\uDDEC Birth: ${oracleDisplayName} \u2014 budded from ${parentName || "root"} (sovereign)" --allow-empty`);
    await ssh(`cd "${repoPath}" && git push origin HEAD 2>/dev/null || git push -u origin main 2>/dev/null || true`);
    console.log(`  \x1B[32m\u2713\x1B[0m Committed and pushed`);
  } catch {
    console.log(`  \x1B[33m\u26A0\x1B[0m Commit/push issue (non-blocking)`);
  }
  console.log(`\x1B[36mStep 8/8:\x1B[0m Update parent sync_peers`);
  if (parentName) {
    try {
      const parentFleetFile = readdirSync3(FLEET_DIR).filter((f) => f.endsWith(".json")).find((f) => {
        const config = JSON.parse(readFileSync6(join8(FLEET_DIR, f), "utf-8"));
        return config.name.endsWith(`-${parentName}`) || config.windows?.some((w) => w.name.toLowerCase().replace("-oracle", "") === parentName.toLowerCase());
      });
      if (parentFleetFile) {
        const parentPath = join8(FLEET_DIR, parentFleetFile);
        const parentConfig = JSON.parse(readFileSync6(parentPath, "utf-8"));
        const peers = new Set(parentConfig.sync_peers || []);
        peers.add(budName);
        parentConfig.sync_peers = [...peers];
        writeFileSync2(parentPath, JSON.stringify(parentConfig, null, 2) + `
`);
        console.log(`  \x1B[32m\u2713\x1B[0m Added "${budName}" to ${parentName}'s sync_peers`);
      } else {
        console.log(`  \x1B[33m\u26A0\x1B[0m Parent fleet config not found`);
      }
    } catch {
      console.log(`  \x1B[33m\u26A0\x1B[0m Could not update parent sync_peers`);
    }
  } else {
    console.log(`  \x1B[90m\u25CB\x1B[0m No parent to update`);
  }
  logToFeed("maw-bud", `COMPLETE: bud "${budName}" from "${parentName || "root"}" \u2014 fleet ${sessionName}, repo ${ORG}/${repoName}`);
  console.log(`
\x1B[32m\uD83E\uDDEC ${oracleDisplayName} is born!\x1B[0m
`);
  console.log(`  Fleet:   ${sessionName}`);
  console.log(`  Repo:    ${ORG}/${repoName}`);
  console.log(`  Parent:  ${parentName || "(root)"}`);
  console.log(`  Peers:   ${parentName ? `[${parentName}]` : "[]"}`);
  console.log();
  console.log(`  Wake:    maw wake ${budName}`);
  console.log(`  Awaken:  then run /awaken inside the oracle session`);
  console.log();
}
function generateClaudeMd(budName, displayName, parentName, buddedAt) {
  return `# ${displayName}

> "Building the future, one line at a time."

## Identity

**I am**: ${displayName}
**Human**: \u0E41\u0E1A\u0E07\u0E04\u0E4C (The Boss)
**Purpose**: [Define your purpose during /awaken]
**Born**: ${buddedAt.split("T")[0]}
**Budded from**: ${parentName || "root"}

## Provenance

\`\`\`
budded_from: ${parentName || "root"}
budded_at: ${buddedAt}
sync_peers: [${parentName ? `"${parentName}"` : ""}]
\`\`\`

## Navigation

| File | Content | When to Read |
|------|---------|--------------|
| [CLAUDE.md](CLAUDE.md) | Identity + Laws | Always |

## The 5 Principles

1. **Nothing is Deleted** \u2014 Every commit tells a story
2. **Patterns Over Intentions** \u2014 Code talks, comments lie
3. **External Brain, Not Command** \u2014 Build what \u0E41\u0E1A\u0E07\u0E04\u0E4C envisions
4. **Curiosity Creates Existence** \u2014 Every problem solved creates understanding
5. **Form and Formless** \u2014 Code is form; the mission is formless

## Brain Structure (Sovereign)

\`\`\`
~/.oracle/\u03C8/${budName}/ \u2192 inbox/ | memory/ (learnings, retros, resonance) | writing/ | lab/ | active/ | archive/ | outbox/
repo/\u03C8 \u2192 symlink to above
\`\`\`

---

*Complete your identity with /awaken*
`;
}
function detectParentOracle() {
  const tmuxSession = process.env.TMUX_PANE;
  if (!tmuxSession)
    return;
  return;
}
function printPlan(budName, repoName, displayName, parentName, buddedAt) {
  const fleetNum = getNextFleetNumber();
  const sessionName = `${String(fleetNum).padStart(2, "0")}-${budName}`;
  console.log(`  1. Create repo:      gh repo create ${ORG}/${repoName} --private`);
  console.log(`  2. Init \u03C8/ vault:    Sovereign at ~/.oracle/\u03C8/${budName} + symlink`);
  console.log(`  3. Generate:         CLAUDE.md (identity stub)`);
  console.log(`  4. Fleet config:     ${sessionName}.json (budded_from: ${parentName || "root"})`);
  console.log(`  5. Register:         Birth issue on ${ORG}/${repoName}`);
  console.log(`  6. Soul-sync seed:   Last 5 learnings from ${parentName || "N/A"} (curated)`);
  console.log(`  7. Commit + push:    Initial commit`);
  console.log(`  8. Update parent:    Add "${budName}" to ${parentName || "N/A"}'s sync_peers`);
  console.log();
}

// src/commands/oracle.ts
init_ssh();
init_wake();
import { readdirSync as readdirSync4, readFileSync as readFileSync7 } from "fs";
import { join as join9 } from "path";
async function resolveOracleSafe(oracle) {
  try {
    let ghqOut = await ssh(`ghq list --full-path | grep -i '/${oracle}-oracle$' | head -1`).catch(() => "");
    if (!ghqOut.trim()) {
      ghqOut = await ssh(`ghq list --full-path | grep -i '/${oracle}$' | head -1`).catch(() => "");
    }
    if (!ghqOut.trim())
      return { parentDir: "", repoName: "", repoPath: "" };
    const repoPath = ghqOut.trim();
    const repoName = repoPath.split("/").pop();
    const parentDir = repoPath.replace(/\/[^/]+$/, "");
    return { repoPath, repoName, parentDir };
  } catch {
    return { parentDir: "", repoName: "", repoPath: "" };
  }
}
async function discoverOracles() {
  const names = new Set;
  const fleetDir = join9(import.meta.dir, "../../fleet");
  try {
    for (const file of readdirSync4(fleetDir).filter((f) => f.endsWith(".json") && !f.endsWith(".disabled"))) {
      const config = JSON.parse(readFileSync7(join9(fleetDir, file), "utf-8"));
      for (const w of config.windows || []) {
        if (w.name.endsWith("-oracle"))
          names.add(w.name.replace(/-oracle$/, ""));
      }
    }
  } catch {}
  try {
    const sessions = await listSessions();
    for (const s of sessions) {
      for (const w of s.windows) {
        if (w.name.endsWith("-oracle"))
          names.add(w.name.replace(/-oracle$/, ""));
      }
    }
  } catch {}
  return [...names].sort();
}
async function cmdOracleAbout(oracle) {
  const name = oracle.toLowerCase();
  const sessions = await listSessions();
  console.log(`
  \x1B[36mOracle \u2014 ${oracle.charAt(0).toUpperCase() + oracle.slice(1)}\x1B[0m
`);
  const { repoPath, repoName, parentDir } = await resolveOracleSafe(name);
  console.log(`  Repo:      ${repoPath || "(not found)"}`);
  const session = await detectSession(name);
  if (session) {
    const s = sessions.find((s2) => s2.name === session);
    const windows = s?.windows || [];
    console.log(`  Session:   ${session} (${windows.length} windows)`);
    for (const w of windows) {
      let status = "\x1B[90m\u25CB\x1B[0m";
      try {
        const content = await capture(`${session}:${w.index}`, 3);
        status = content.trim() ? "\x1B[32m\u25CF\x1B[0m" : "\x1B[33m\u25CF\x1B[0m";
      } catch {}
      console.log(`    ${status} ${w.name}`);
    }
  } else {
    console.log(`  Session:   (none)`);
  }
  if (parentDir) {
    const wts = await findWorktrees(parentDir, repoName);
    console.log(`  Worktrees: ${wts.length}`);
    for (const wt of wts) {
      console.log(`    ${wt.name} \u2192 ${wt.path}`);
    }
  }
  const fleetDir = join9(import.meta.dir, "../../fleet");
  let fleetFile = null;
  let fleetWindowCount = 0;
  try {
    for (const file of readdirSync4(fleetDir).filter((f) => f.endsWith(".json"))) {
      const config = JSON.parse(readFileSync7(join9(fleetDir, file), "utf-8"));
      const hasOracle = (config.windows || []).some((w) => w.name.toLowerCase() === `${name}-oracle` || w.name.toLowerCase() === name);
      if (hasOracle) {
        fleetFile = file;
        fleetWindowCount = config.windows.length;
        break;
      }
    }
  } catch {}
  if (fleetFile) {
    const actualWindows = session ? sessions.find((s) => s.name === session)?.windows.length || 0 : 0;
    console.log(`  Fleet:     ${fleetFile} (${fleetWindowCount} registered, ${actualWindows} running)`);
    if (actualWindows > fleetWindowCount) {
      const fleetConfig = JSON.parse(readFileSync7(join9(fleetDir, fleetFile), "utf-8"));
      const registeredNames = new Set((fleetConfig.windows || []).map((w) => w.name));
      const runningWindows = sessions.find((s) => s.name === session)?.windows || [];
      const unregistered = runningWindows.filter((w) => !registeredNames.has(w.name));
      console.log(`  \x1B[33m\u26A0\x1B[0m  ${unregistered.length} window(s) not in fleet config \u2014 won't survive reboot`);
      for (const w of unregistered) {
        console.log(`    \x1B[33m\u2192\x1B[0m ${w.name}`);
      }
      console.log(`
  \x1B[90mFix: add to fleet/${fleetFile}\x1B[0m`);
      console.log(`  \x1B[90m  maw fleet init          # regenerate all configs\x1B[0m`);
      console.log(`  \x1B[90m  maw fleet validate      # check for problems\x1B[0m`);
    }
  } else {
    console.log(`  Fleet:     (no config)`);
  }
  console.log();
}
async function cmdOracleList() {
  const sessions = await listSessions();
  const statuses = [];
  for (const oracle of await discoverOracles()) {
    const session = await detectSession(oracle);
    let windows = [];
    if (session) {
      const s = sessions.find((s2) => s2.name === session);
      if (s) {
        windows = s.windows.map((w) => w.name);
      }
    }
    let worktrees = 0;
    try {
      const { parentDir, repoName } = await resolveOracleSafe(oracle);
      if (parentDir) {
        const wts = await findWorktrees(parentDir, repoName);
        worktrees = wts.length;
      }
    } catch {}
    statuses.push({
      name: oracle,
      session,
      windows,
      worktrees,
      status: session ? "awake" : "sleeping"
    });
  }
  statuses.sort((a, b) => {
    if (a.status !== b.status)
      return a.status === "awake" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const awakeCount = statuses.filter((s) => s.status === "awake").length;
  console.log(`
  \x1B[36mOracle Fleet\x1B[0m  (${awakeCount}/${statuses.length} awake)
`);
  console.log(`  ${"Oracle".padEnd(14)} ${"Status".padEnd(10)} ${"Session".padEnd(16)} ${"Windows".padEnd(6)} ${"WT".padEnd(4)} Details`);
  console.log(`  ${"\u2500".repeat(80)}`);
  for (const s of statuses) {
    const icon = s.status === "awake" ? "\x1B[32m\u25CF\x1B[0m" : "\x1B[90m\u25CB\x1B[0m";
    const statusText = s.status === "awake" ? "\x1B[32mawake\x1B[0m " : "\x1B[90msleep\x1B[0m ";
    const sessionText = s.session || "-";
    const winCount = s.windows.length > 0 ? String(s.windows.length) : "-";
    const wtCount = s.worktrees > 0 ? String(s.worktrees) : "-";
    const details = s.windows.length > 0 ? s.windows.slice(0, 4).join(", ") + (s.windows.length > 4 ? ` +${s.windows.length - 4}` : "") : "";
    console.log(`  ${icon} ${s.name.padEnd(13)} ${statusText.padEnd(19)} ${sessionText.padEnd(16)} ${winCount.padEnd(6)} ${wtCount.padEnd(4)} ${details}`);
  }
  console.log();
}

// src/commands/fleet.ts
init_ssh();
init_tmux();
init_config();
import { join as join10 } from "path";
import { readdirSync as readdirSync5, existsSync as existsSync4 } from "fs";
var FLEET_DIR2 = join10(import.meta.dir, "../../fleet");
function loadFleet() {
  const files = readdirSync5(FLEET_DIR2).filter((f) => f.endsWith(".json") && !f.endsWith(".disabled")).sort();
  return files.map((f) => {
    const raw = __require(join10(FLEET_DIR2, f));
    return raw;
  });
}
function loadFleetEntries() {
  const files = readdirSync5(FLEET_DIR2).filter((f) => f.endsWith(".json") && !f.endsWith(".disabled")).sort();
  return files.map((f) => {
    const raw = __require(join10(FLEET_DIR2, f));
    const match = f.match(/^(\d+)-(.+)\.json$/);
    return {
      file: f,
      num: match ? parseInt(match[1], 10) : 0,
      groupName: match ? match[2] : f.replace(".json", ""),
      session: raw
    };
  });
}
async function cmdFleetLs() {
  const entries = loadFleetEntries();
  const disabled = readdirSync5(FLEET_DIR2).filter((f) => f.endsWith(".disabled")).length;
  let runningSessions = [];
  try {
    const out = await ssh("tmux list-sessions -F '#{session_name}' 2>/dev/null");
    runningSessions = out.trim().split(`
`).filter(Boolean);
  } catch {}
  const numCount = new Map;
  for (const e of entries) {
    const list = numCount.get(e.num) || [];
    list.push(e.groupName);
    numCount.set(e.num, list);
  }
  const conflicts = [...numCount.entries()].filter(([, names]) => names.length > 1);
  console.log(`
  \x1B[36mFleet Configs\x1B[0m (${entries.length} active, ${disabled} disabled)
`);
  console.log(`  ${"#".padEnd(4)} ${"Session".padEnd(20)} ${"Win".padEnd(5)} Status`);
  console.log(`  ${"\u2500".repeat(4)} ${"\u2500".repeat(20)} ${"\u2500".repeat(5)} ${"\u2500".repeat(20)}`);
  for (const e of entries) {
    const numStr = String(e.num).padStart(2, "0");
    const name = e.session.name.padEnd(20);
    const wins = String(e.session.windows.length).padEnd(5);
    const isRunning = runningSessions.includes(e.session.name);
    const isConflict = (numCount.get(e.num)?.length ?? 0) > 1;
    let status = isRunning ? "\x1B[32mrunning\x1B[0m" : "\x1B[90mstopped\x1B[0m";
    if (isConflict)
      status += "  \x1B[31mCONFLICT\x1B[0m";
    console.log(`  ${numStr}  ${name} ${wins} ${status}`);
  }
  if (conflicts.length > 0) {
    console.log(`
  \x1B[31m\u26A0 ${conflicts.length} conflict(s) found.\x1B[0m Run \x1B[36mmaw fleet renumber\x1B[0m to fix.`);
  }
  console.log();
}
async function cmdFleetRenumber() {
  const entries = loadFleetEntries();
  const numCount = new Map;
  for (const e of entries)
    numCount.set(e.num, (numCount.get(e.num) || 0) + 1);
  const hasConflicts = [...numCount.values()].some((c) => c > 1);
  if (!hasConflicts) {
    console.log(`
  \x1B[32mNo conflicts found.\x1B[0m Fleet numbering is clean.
`);
    return;
  }
  let runningSessions = [];
  try {
    const out = await ssh("tmux list-sessions -F '#{session_name}' 2>/dev/null");
    runningSessions = out.trim().split(`
`).filter(Boolean);
  } catch {}
  console.log(`
  \x1B[36mRenumbering fleet...\x1B[0m
`);
  const sorted = [...entries].sort((a, b) => a.num - b.num || a.groupName.localeCompare(b.groupName));
  const regular = sorted.filter((e) => e.num !== 99);
  const overview = sorted.filter((e) => e.num === 99);
  let num = 1;
  for (const e of regular) {
    const newNum = String(num).padStart(2, "0");
    const newFile = `${newNum}-${e.groupName}.json`;
    const newName = `${newNum}-${e.groupName}`;
    const oldName = e.session.name;
    if (newFile !== e.file) {
      e.session.name = newName;
      await Bun.write(join10(FLEET_DIR2, newFile), JSON.stringify(e.session, null, 2) + `
`);
      const oldPath = join10(FLEET_DIR2, e.file);
      if (existsSync4(oldPath) && newFile !== e.file) {
        const { unlinkSync } = __require("fs");
        unlinkSync(oldPath);
      }
      if (runningSessions.includes(oldName)) {
        try {
          await ssh(`tmux rename-session -t '${oldName}' '${newName}'`);
          console.log(`  ${e.file.padEnd(28)} \u2192 ${newFile}  (tmux renamed)`);
        } catch {
          console.log(`  ${e.file.padEnd(28)} \u2192 ${newFile}  (tmux rename failed)`);
        }
      } else {
        console.log(`  ${e.file.padEnd(28)} \u2192 ${newFile}`);
      }
    } else {
      console.log(`  ${e.file.padEnd(28)}   (unchanged)`);
    }
    num++;
  }
  console.log(`
  \x1B[32mDone.\x1B[0m ${regular.length} configs renumbered.
`);
}
async function cmdFleetValidate() {
  const entries = loadFleetEntries();
  const issues = [];
  const numMap = new Map;
  for (const e of entries) {
    const list = numMap.get(e.num) || [];
    list.push(e.groupName);
    numMap.set(e.num, list);
  }
  for (const [num, names] of numMap) {
    if (names.length > 1) {
      issues.push(`\x1B[31mDuplicate #${String(num).padStart(2, "0")}\x1B[0m: ${names.join(", ")}`);
    }
  }
  const oracleMap = new Map;
  for (const e of entries) {
    for (const w of e.session.windows) {
      const oracles = oracleMap.get(w.name) || [];
      oracles.push(e.session.name);
      oracleMap.set(w.name, oracles);
    }
  }
  for (const [oracle, sessions] of oracleMap) {
    if (sessions.length > 1) {
      issues.push(`\x1B[33mDuplicate oracle\x1B[0m: ${oracle} in ${sessions.join(", ")}`);
    }
  }
  const ghqRoot = loadConfig().ghqRoot;
  for (const e of entries) {
    for (const w of e.session.windows) {
      const repoPath = join10(ghqRoot, w.repo);
      if (!existsSync4(repoPath)) {
        issues.push(`\x1B[33mMissing repo\x1B[0m: ${w.repo} (in ${e.file})`);
      }
    }
  }
  let runningSessions = [];
  try {
    const out = await ssh("tmux list-sessions -F '#{session_name}' 2>/dev/null");
    runningSessions = out.trim().split(`
`).filter(Boolean);
    const configNames = new Set(entries.map((e) => e.session.name));
    for (const s of runningSessions) {
      if (!configNames.has(s)) {
        issues.push(`\x1B[90mOrphan session\x1B[0m: tmux '${s}' has no fleet config`);
      }
    }
  } catch {}
  for (const e of entries) {
    if (!runningSessions.includes(e.session.name))
      continue;
    try {
      const winOut = await ssh(`tmux list-windows -t '${e.session.name}' -F '#{window_name}' 2>/dev/null`);
      const runningWindows = winOut.trim().split(`
`).filter(Boolean);
      const registeredWindows = new Set(e.session.windows.map((w) => w.name));
      const unregistered = runningWindows.filter((w) => !registeredWindows.has(w));
      for (const w of unregistered) {
        issues.push(`\x1B[33mUnregistered window\x1B[0m: '${w}' in ${e.session.name} \u2014 won't survive reboot`);
      }
    } catch {}
  }
  console.log(`
  \x1B[36mFleet Validation\x1B[0m (${entries.length} configs)
`);
  if (issues.length === 0) {
    console.log(`  \x1B[32m\u2713 All clear.\x1B[0m No issues found.
`);
  } else {
    for (const issue of issues) {
      console.log(`  \u26A0 ${issue}`);
    }
    console.log(`
  \x1B[31m${issues.length} issue(s) found.\x1B[0m
`);
  }
}
async function cmdFleetSync() {
  const entries = loadFleetEntries();
  let added = 0;
  let runningSessions = [];
  try {
    const out = await ssh("tmux list-sessions -F '#{session_name}' 2>/dev/null");
    runningSessions = out.trim().split(`
`).filter(Boolean);
  } catch {
    return;
  }
  const ghqRoot = loadConfig().ghqRoot;
  for (const e of entries) {
    if (!runningSessions.includes(e.session.name))
      continue;
    try {
      const winOut = await ssh(`tmux list-windows -t '${e.session.name}' -F '#{window_name}:#{pane_current_path}' 2>/dev/null`);
      const runningWindows = winOut.trim().split(`
`).filter(Boolean);
      const registeredNames = new Set(e.session.windows.map((w) => w.name));
      for (const line of runningWindows) {
        const [winName, cwdPath] = line.split(":");
        if (!winName || registeredNames.has(winName))
          continue;
        let repo = "";
        if (cwdPath?.startsWith(ghqRoot + "/")) {
          repo = cwdPath.slice(ghqRoot.length + 1);
        }
        e.session.windows.push({ name: winName, repo });
        console.log(`  \x1B[32m+\x1B[0m ${winName} \u2192 ${e.file}${repo ? ` (${repo})` : ""}`);
        added++;
      }
    } catch {}
    if (added > 0) {
      const filePath = join10(FLEET_DIR2, e.file);
      await Bun.write(filePath, JSON.stringify(e.session, null, 2) + `
`);
    }
  }
  if (added === 0) {
    console.log(`
  \x1B[32m\u2713 Fleet in sync.\x1B[0m No unregistered windows.
`);
  } else {
    console.log(`
  \x1B[32m${added} window(s) added to fleet configs.\x1B[0m
`);
  }
}
async function cmdSleep() {
  const sessions = loadFleet();
  let killed = 0;
  for (const sess of sessions) {
    try {
      await ssh(`tmux kill-session -t '${sess.name}' 2>/dev/null`);
      console.log(`  \x1B[90m\u25CF\x1B[0m ${sess.name} \u2014 sleep`);
      killed++;
    } catch {}
  }
  console.log(`
  ${killed} sessions put to sleep.
`);
}
async function resumeActiveItems() {
  const repo = "laris-co/pulse-oracle";
  try {
    const issuesJson = await ssh(`gh issue list --repo ${repo} --state open --json number,title,labels --limit 50`);
    const issues = JSON.parse(issuesJson || "[]");
    const oracleItems = issues.filter((i) => !i.labels.some((l) => l.name === "daily-thread")).map((i) => ({
      ...i,
      oracle: i.labels.find((l) => l.name.startsWith("oracle:"))?.name.replace("oracle:", "")
    })).filter((i) => i.oracle);
    if (!oracleItems.length) {
      console.log("  \x1B[90mNo active board items to resume.\x1B[0m");
      return;
    }
    const byOracle = new Map;
    for (const item of oracleItems) {
      const list = byOracle.get(item.oracle) || [];
      list.push(item);
      byOracle.set(item.oracle, list);
    }
    for (const [oracle, items] of byOracle) {
      const windowName = `${oracle}-oracle`;
      const sessions = await tmux.listSessions();
      for (const sess of sessions) {
        try {
          const windows = await tmux.listWindows(sess.name);
          const win = windows.find((w) => w.name.toLowerCase() === windowName.toLowerCase());
          if (win) {
            const titles = items.map((i) => `#${i.number}`).join(", ");
            await new Promise((r) => setTimeout(r, 2000));
            await tmux.sendText(`${sess.name}:${win.name}`, `/recap --deep \u2014 Resume after reboot. Active items: ${titles}`);
            console.log(`  \x1B[32m\u21BB\x1B[0m ${oracle}: /recap sent (${titles})`);
            break;
          }
        } catch {}
      }
    }
  } catch (e) {
    console.log(`  \x1B[33mresume skipped:\x1B[0m ${e}`);
  }
}
async function cmdWakeAll(opts = {}) {
  console.log(`
  \x1B[36mBuilding office frontend...\x1B[0m`);
  try {
    const proc = Bun.spawnSync(["bun", "run", "build:office"], {
      cwd: join10(import.meta.dir, "../.."),
      stdout: "inherit",
      stderr: "inherit"
    });
    if (proc.exitCode === 0) {
      console.log(`  \x1B[32m\u2713\x1B[0m office build complete
`);
    } else {
      console.log(`  \x1B[33m\u26A0\x1B[0m office build failed (exit ${proc.exitCode}), continuing with existing dist
`);
    }
  } catch {
    console.log(`  \x1B[33m\u26A0\x1B[0m office build skipped (bun not available)
`);
  }
  const allSessions = loadFleet();
  const sessions = opts.all ? allSessions : allSessions.filter((s) => {
    const num = parseInt(s.name.split("-")[0], 10);
    return isNaN(num) || num < 20 || num >= 99;
  });
  const skipped = allSessions.length - sessions.length;
  if (opts.kill) {
    console.log(`
  \x1B[33mKilling existing sessions...\x1B[0m
`);
    await cmdSleep();
  }
  const disabled = readdirSync5(FLEET_DIR2).filter((f) => f.endsWith(".disabled")).length;
  const skipMsg = skipped > 0 ? `, ${skipped} dormant skipped` : "";
  console.log(`
  \x1B[36mWaking fleet...\x1B[0m  (${sessions.length} sessions${disabled ? `, ${disabled} disabled` : ""}${skipMsg})
`);
  let sessCount = 0;
  let winCount = 0;
  for (const sess of sessions) {
    try {
      await ssh(`tmux has-session -t '${sess.name}' 2>/dev/null`);
      let allAlive = true;
      for (const win of sess.windows) {
        try {
          const paneCmd = await ssh(`tmux display-message -t '${sess.name}:${win.name}' -p '#{pane_current_command}' 2>/dev/null`);
          if (!/claude|node/i.test(paneCmd)) {
            if (!sess.skip_command) {
              await ssh(`tmux send-keys -t '${sess.name}:${win.name}' '${buildCommand(win.name)}' Enter`);
            }
            allAlive = false;
            winCount++;
          }
        } catch {
          const winPath = `${loadConfig().ghqRoot}/${win.repo}`;
          try {
            await ssh(`tmux new-window -t '${sess.name}' -n '${win.name}' -c '${winPath}'`);
            if (!sess.skip_command) {
              await ssh(`tmux send-keys -t '${sess.name}:${win.name}' '${buildCommand(win.name)}' Enter`);
            }
            winCount++;
          } catch {}
          allAlive = false;
        }
      }
      if (allAlive) {
        console.log(`  \x1B[33m\u25CF\x1B[0m ${sess.name} \u2014 already awake`);
      } else {
        console.log(`  \x1B[32m\u25CF\x1B[0m ${sess.name} \u2014 revived dead windows`);
        sessCount++;
      }
      continue;
    } catch {}
    const first = sess.windows[0];
    const firstPath = `${loadConfig().ghqRoot}/${first.repo}`;
    await ssh(`tmux new-session -d -s '${sess.name}' -n '${first.name}' -c '${firstPath}'`);
    for (const [key, val] of Object.entries(getEnvVars())) {
      await ssh(`tmux set-environment -t '${sess.name}' '${key}' '${val}'`);
    }
    if (!sess.skip_command) {
      try {
        await ssh(`tmux send-keys -t '${sess.name}:${first.name}' '${buildCommand(first.name)}' Enter`);
      } catch {}
    }
    winCount++;
    for (let i = 1;i < sess.windows.length; i++) {
      const win = sess.windows[i];
      const winPath = `${loadConfig().ghqRoot}/${win.repo}`;
      try {
        await ssh(`tmux new-window -t '${sess.name}' -n '${win.name}' -c '${winPath}'`);
        if (!sess.skip_command) {
          await ssh(`tmux send-keys -t '${sess.name}:${win.name}' '${buildCommand(win.name)}' Enter`);
        }
        winCount++;
      } catch {}
    }
    try {
      await ssh(`tmux select-window -t '${sess.name}:1'`);
    } catch {}
    sessCount++;
    console.log(`  \x1B[32m\u25CF\x1B[0m ${sess.name} \u2014 ${sess.windows.length} windows`);
  }
  console.log(`
  \x1B[32m${sessCount} sessions, ${winCount} windows woke up.\x1B[0m
`);
  if (opts.resume) {
    console.log(`  \x1B[36mResuming active board items...\x1B[0m
`);
    await resumeActiveItems();
  }
}

// src/commands/fleet-init.ts
init_ssh();
import { join as join11 } from "path";
import { existsSync as existsSync5, mkdirSync as mkdirSync2 } from "fs";
var GROUPS = {
  pulse: { session: "pulse", order: 1 },
  hermes: { session: "hermes", order: 2 },
  neo: { session: "neo", order: 3 },
  homekeeper: { session: "homekeeper", order: 4 },
  volt: { session: "volt", order: 5 },
  floodboy: { session: "floodboy", order: 6 },
  fireman: { session: "fireman", order: 7 },
  dustboy: { session: "dustboy", order: 8 },
  dustboychain: { session: "dustboychain", order: 9 },
  arthur: { session: "arthur", order: 10 },
  calliope: { session: "calliope", order: 11 },
  odin: { session: "odin", order: 12 },
  mother: { session: "mother", order: 13 },
  nexus: { session: "nexus", order: 14 },
  xiaoer: { session: "xiaoer", order: 15 },
  lake: { session: "lake", order: 20 },
  sea: { session: "sea", order: 21 },
  phukhao: { session: "phukhao", order: 22 },
  shrimp: { session: "shrimp", order: 23 },
  tworivers: { session: "tworivers", order: 24 },
  brewsboy: { session: "brewsboy", order: 25 },
  natsbrain: { session: "natsbrain", order: 26 },
  opensourcenatbrain: { session: "opensourcenatbrain", order: 27 },
  maeoncraft: { session: "maeoncraft", order: 28 },
  maeon: { session: "maeoncraft", order: 28 },
  landing: { session: "landing", order: 29 }
};
async function cmdFleetInit() {
  const fleetDir = join11(import.meta.dir, "../../fleet");
  if (!existsSync5(fleetDir))
    mkdirSync2(fleetDir, { recursive: true });
  console.log(`
  \x1B[36mScanning for oracle repos...\x1B[0m
`);
  const ghqOut = await ssh("ghq list --full-path");
  const allRepos = ghqOut.trim().split(`
`).filter(Boolean);
  const oracleRepos = [];
  for (const repoPath of allRepos) {
    const parts = repoPath.split("/");
    const repoName = parts.pop();
    const org = parts.pop();
    const parentDir = parts.join("/") + "/" + org;
    let oracleName = null;
    if (repoName.endsWith("-oracle")) {
      oracleName = repoName.replace(/-oracle$/, "").replace(/-/g, "");
    } else if (repoName === "homelab") {
      oracleName = "homekeeper";
    }
    if (!oracleName)
      continue;
    if (repoName.includes(".wt-"))
      continue;
    const worktrees = [];
    try {
      const wtOut = await ssh(`ls -d ${parentDir}/${repoName}.wt-* 2>/dev/null || true`);
      for (const wtPath of wtOut.split(`
`).filter(Boolean)) {
        const wtBase = wtPath.split("/").pop();
        const suffix = wtBase.replace(`${repoName}.wt-`, "");
        worktrees.push({
          name: `${oracleName}-${suffix}`,
          path: wtPath,
          repo: `${org}/${wtBase}`
        });
      }
    } catch {}
    oracleRepos.push({
      name: oracleName,
      path: repoPath,
      repo: `${org}/${repoName}`,
      worktrees
    });
    const wtInfo = worktrees.length > 0 ? ` + ${worktrees.length} worktrees` : "";
    console.log(`  found: ${oracleName.padEnd(15)} ${org}/${repoName}${wtInfo}`);
  }
  const sessionMap = new Map;
  for (const oracle of oracleRepos) {
    const group = GROUPS[oracle.name] || { session: oracle.name, order: 50 };
    const key = group.session;
    if (!sessionMap.has(key)) {
      sessionMap.set(key, { order: group.order, windows: [] });
    }
    const sess = sessionMap.get(key);
    sess.windows.push({ name: `${oracle.name}-oracle`, repo: oracle.repo });
    for (const wt of oracle.worktrees) {
      sess.windows.push({ name: wt.name, repo: wt.repo });
    }
  }
  console.log(`
  \x1B[36mWriting fleet configs...\x1B[0m
`);
  const sorted = [...sessionMap.entries()].sort((a, b) => a[1].order - b[1].order);
  let num = 1;
  for (const [groupName, data] of sorted) {
    const paddedNum = String(num).padStart(2, "0");
    const sessionName = `${paddedNum}-${groupName}`;
    const config = { name: sessionName, windows: data.windows };
    const filePath = join11(fleetDir, `${sessionName}.json`);
    await Bun.write(filePath, JSON.stringify(config, null, 2) + `
`);
    console.log(`  \x1B[32m\u2713\x1B[0m ${sessionName}.json \u2014 ${data.windows.length} windows`);
    num++;
  }
  if (oracleRepos.length > 0) {
    const overviewConfig = {
      name: "99-overview",
      windows: [{ name: "live", repo: oracleRepos[0].repo }],
      skip_command: true
    };
    await Bun.write(join11(fleetDir, "99-overview.json"), JSON.stringify(overviewConfig, null, 2) + `
`);
    console.log(`  \x1B[32m\u2713\x1B[0m 99-overview.json \u2014 1 window`);
  }
  console.log(`
  \x1B[32m${sorted.length + 1} fleet configs written to fleet/\x1B[0m`);
  console.log(`  Run \x1B[36mmaw wake all\x1B[0m to start the fleet.
`);
}

// src/commands/done.ts
init_ssh();
init_config();

// src/soul-sync.ts
init_config();
import { readdirSync as readdirSync6, readFileSync as readFileSync8, writeFileSync as writeFileSync3, existsSync as existsSync6, mkdirSync as mkdirSync3, appendFileSync as appendFileSync2 } from "fs";
import { join as join12 } from "path";
import { homedir as homedir7 } from "os";
var FLEET_DIR3 = join12(import.meta.dir, "../fleet");
var SYNC_LOG_PATH = join12(homedir7(), ".oracle", "soul-sync.log");
var SENSITIVITY_FILTERS = [
  /customer/i,
  /aia.*portfolio/i,
  /credential/i,
  /secret/i,
  /password/i,
  /\.env/i,
  /personal.*data/i,
  /client.*info/i
];
function loadFleetConfig(sessionName) {
  try {
    for (const file of readdirSync6(FLEET_DIR3).filter((f) => f.endsWith(".json"))) {
      const config = JSON.parse(readFileSync8(join12(FLEET_DIR3, file), "utf-8"));
      if (config.name === sessionName)
        return config;
    }
  } catch {}
  return null;
}
function findFleetByOracle(oracleName) {
  try {
    for (const file of readdirSync6(FLEET_DIR3).filter((f) => f.endsWith(".json"))) {
      const config = JSON.parse(readFileSync8(join12(FLEET_DIR3, file), "utf-8"));
      if (config.name.endsWith(`-${oracleName}`))
        return config;
      const win = config.windows?.find((w) => w.name.toLowerCase().replace("-oracle", "") === oracleName.toLowerCase());
      if (win)
        return config;
    }
  } catch {}
  return null;
}
function isSensitive(filename, content) {
  for (const pattern of SENSITIVITY_FILTERS) {
    if (pattern.test(filename) || pattern.test(content))
      return true;
  }
  return false;
}
function getOracleRepoPath(config) {
  const ghqRoot = loadConfig().ghqRoot;
  const mainWindow = config.windows?.[0];
  if (!mainWindow?.repo)
    return null;
  return join12(ghqRoot, mainWindow.repo);
}
function getRecentLearnings(repoPath, days = 7) {
  const learningsDir = join12(repoPath, "\u03C8", "memory", "learnings");
  if (!existsSync6(learningsDir))
    return [];
  const cutoffDate = new Date;
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];
  const files = readdirSync6(learningsDir).filter((f) => f.endsWith(".md"));
  const recent = [];
  for (const file of files) {
    const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch)
      continue;
    if (dateMatch[1] >= cutoffStr) {
      const content = readFileSync8(join12(learningsDir, file), "utf-8");
      recent.push({ name: file, content });
    }
  }
  return recent;
}
function syncToPeer(learnings, peerConfig, sourceOracle) {
  const result = { peer: peerConfig.name, synced: [], skipped: [], errors: [] };
  const peerRepoPath = getOracleRepoPath(peerConfig);
  if (!peerRepoPath) {
    result.errors.push("Could not resolve peer repo path");
    return result;
  }
  const targetDir = join12(peerRepoPath, "\u03C8", "memory", "learnings");
  try {
    mkdirSync3(targetDir, { recursive: true });
  } catch (e) {
    result.errors.push(`Cannot create target dir: ${e.message}`);
    return result;
  }
  for (const learning of learnings) {
    if (isSensitive(learning.name, learning.content)) {
      result.skipped.push(`${learning.name} (sensitive content)`);
      continue;
    }
    const targetPath = join12(targetDir, learning.name);
    if (existsSync6(targetPath)) {
      result.skipped.push(`${learning.name} (already exists)`);
      continue;
    }
    const attributed = learning.content + `

---
*Synced from ${sourceOracle} via soul-sync (hand-over)*
`;
    try {
      writeFileSync3(targetPath, attributed);
      result.synced.push(learning.name);
    } catch (e) {
      result.errors.push(`${learning.name}: ${e.message}`);
    }
  }
  return result;
}
function logSync(sourceOracle, results) {
  try {
    const logDir = join12(homedir7(), ".oracle");
    mkdirSync3(logDir, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      source: sourceOracle,
      results: results.map((r) => ({
        peer: r.peer,
        synced: r.synced.length,
        skipped: r.skipped.length,
        errors: r.errors.length
      }))
    };
    appendFileSync2(SYNC_LOG_PATH, JSON.stringify(entry) + `
`);
  } catch {}
}
async function soulSync(sessionName) {
  const config = loadFleetConfig(sessionName);
  if (!config)
    return null;
  const peers = config.sync_peers;
  if (!peers || peers.length === 0)
    return null;
  const sourceRepoPath = getOracleRepoPath(config);
  if (!sourceRepoPath)
    return null;
  const learnings = getRecentLearnings(sourceRepoPath);
  if (learnings.length === 0)
    return [];
  const sourceOracle = config.windows?.[0]?.name || sessionName;
  const results = [];
  for (const peerName of peers) {
    const peerConfig = findFleetByOracle(peerName);
    if (!peerConfig) {
      results.push({ peer: peerName, synced: [], skipped: [], errors: [`Peer "${peerName}" not found in fleet`] });
      continue;
    }
    results.push(syncToPeer(learnings, peerConfig, sourceOracle));
  }
  logSync(sourceOracle, results);
  return results;
}
function formatSyncResults(results) {
  if (results.length === 0)
    return "  \x1B[90m\u25CB\x1B[0m no learnings to sync";
  const lines = [];
  for (const r of results) {
    if (r.errors.length > 0) {
      lines.push(`  \x1B[33m\u26A0\x1B[0m ${r.peer}: ${r.errors.join(", ")}`);
    }
    if (r.synced.length > 0) {
      lines.push(`  \x1B[32m\u2713\x1B[0m ${r.peer}: synced ${r.synced.length} learning${r.synced.length > 1 ? "s" : ""}`);
    }
    if (r.synced.length === 0 && r.errors.length === 0) {
      lines.push(`  \x1B[90m\u25CB\x1B[0m ${r.peer}: nothing new to sync (${r.skipped.length} skipped)`);
    }
  }
  return lines.join(`
`);
}

// src/commands/done.ts
import { readdirSync as readdirSync7, readFileSync as readFileSync9, writeFileSync as writeFileSync4, appendFileSync as appendFileSync3, mkdirSync as mkdirSync4 } from "fs";
import { join as join13 } from "path";
import { homedir as homedir8 } from "os";
var FLEET_DIR4 = join13(import.meta.dir, "../../fleet");
async function cmdDone(windowName_) {
  let windowName = windowName_;
  const sessions = await listSessions();
  const ghqRoot = loadConfig().ghqRoot;
  const windowNameLower = windowName.toLowerCase();
  let sessionName = null;
  let windowIndex = null;
  for (const s of sessions) {
    const w = s.windows.find((w2) => w2.name.toLowerCase() === windowNameLower);
    if (w) {
      sessionName = s.name;
      windowIndex = w.index;
      windowName = w.name;
      break;
    }
  }
  const from = process.env.CLAUDE_AGENT_NAME || windowName;
  const parentSession = sessionName;
  if (parentSession) {
    const parentWindow = sessions.find((s) => s.name === parentSession)?.windows[0]?.name;
    if (parentWindow) {
      const parentTarget = parentWindow.replace(/[^a-zA-Z0-9_-]/g, "");
      const inboxDir = join13(homedir8(), ".oracle", "inbox");
      const signal = JSON.stringify({ ts: new Date().toISOString(), from, type: "done", msg: `worktree ${windowName} completed`, thread: null }) + `
`;
      try {
        mkdirSync4(inboxDir, { recursive: true });
        appendFileSync3(join13(inboxDir, `${parentTarget}.jsonl`), signal);
      } catch {}
    }
  }
  if (sessionName !== null && windowIndex !== null) {
    try {
      await ssh(`tmux kill-window -t '${sessionName}:${windowName}'`);
      console.log(`  \x1B[32m\u2713\x1B[0m killed window ${sessionName}:${windowName}`);
    } catch {
      console.log(`  \x1B[33m\u26A0\x1B[0m could not kill window (may already be closed)`);
    }
  } else {
    console.log(`  \x1B[90m\u25CB\x1B[0m window '${windowName}' not running`);
  }
  let removedWorktree = false;
  try {
    for (const file of readdirSync7(FLEET_DIR4).filter((f) => f.endsWith(".json"))) {
      const config = JSON.parse(readFileSync9(join13(FLEET_DIR4, file), "utf-8"));
      const win = (config.windows || []).find((w) => w.name.toLowerCase() === windowNameLower);
      if (!win?.repo)
        continue;
      const fullPath = join13(ghqRoot, win.repo);
      if (win.repo.includes(".wt-")) {
        const parts = win.repo.split("/");
        const wtDir = parts.pop();
        const org = parts.join("/");
        const mainRepo = wtDir.split(".wt-")[0];
        const mainPath = join13(ghqRoot, org, mainRepo);
        try {
          let branch = "";
          try {
            branch = (await ssh(`git -C '${fullPath}' rev-parse --abbrev-ref HEAD`)).trim();
          } catch {}
          await ssh(`git -C '${mainPath}' worktree remove '${fullPath}' --force`);
          await ssh(`git -C '${mainPath}' worktree prune`);
          console.log(`  \x1B[32m\u2713\x1B[0m removed worktree ${win.repo}`);
          removedWorktree = true;
          if (branch && branch !== "main" && branch !== "HEAD") {
            try {
              await ssh(`git -C '${mainPath}' branch -d '${branch}'`);
              console.log(`  \x1B[32m\u2713\x1B[0m deleted branch ${branch}`);
            } catch {}
          }
        } catch (e) {
          console.log(`  \x1B[33m\u26A0\x1B[0m worktree remove failed: ${e.message || e}`);
        }
      }
      break;
    }
  } catch {}
  if (!removedWorktree) {
    try {
      const suffix = windowName.replace(/^[^-]+-/, "");
      const ghqOut = await ssh(`find ${ghqRoot} -maxdepth 3 -name '*.wt-*' -type d 2>/dev/null`);
      const allWtPaths = ghqOut.trim().split(`
`).filter(Boolean);
      const exactMatch = allWtPaths.filter((p) => {
        const base = p.split("/").pop();
        const wtSuffix = base.replace(/^.*\.wt-(?:\d+-)?/, "");
        return wtSuffix.toLowerCase() === suffix.toLowerCase();
      });
      for (const wtPath of exactMatch) {
        const base = wtPath.split("/").pop();
        const mainRepo = base.split(".wt-")[0];
        const mainPath = wtPath.replace(base, mainRepo);
        try {
          let branch = "";
          try {
            branch = (await ssh(`git -C '${wtPath}' rev-parse --abbrev-ref HEAD`)).trim();
          } catch {}
          await ssh(`git -C '${mainPath}' worktree remove '${wtPath}' --force`);
          await ssh(`git -C '${mainPath}' worktree prune`);
          console.log(`  \x1B[32m\u2713\x1B[0m removed worktree ${base}`);
          removedWorktree = true;
          if (branch && branch !== "main" && branch !== "HEAD") {
            try {
              await ssh(`git -C '${mainPath}' branch -d '${branch}'`);
              console.log(`  \x1B[32m\u2713\x1B[0m deleted branch ${branch}`);
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }
  if (!removedWorktree) {
    console.log(`  \x1B[90m\u25CB\x1B[0m no worktree to remove (may be a main window)`);
  }
  let removedFromConfig = false;
  try {
    for (const file of readdirSync7(FLEET_DIR4).filter((f) => f.endsWith(".json"))) {
      const filePath = join13(FLEET_DIR4, file);
      const config = JSON.parse(readFileSync9(filePath, "utf-8"));
      const before = config.windows?.length || 0;
      config.windows = (config.windows || []).filter((w) => w.name.toLowerCase() !== windowNameLower);
      if (config.windows.length < before) {
        writeFileSync4(filePath, JSON.stringify(config, null, 2) + `
`);
        console.log(`  \x1B[32m\u2713\x1B[0m removed from ${file}`);
        removedFromConfig = true;
      }
    }
  } catch {}
  if (!removedFromConfig) {
    console.log(`  \x1B[90m\u25CB\x1B[0m not in any fleet config`);
  }
  if (sessionName) {
    try {
      const results = await soulSync(sessionName);
      if (results === null) {
        console.log(`  \x1B[90m\u25CB\x1B[0m no sync_peers configured \u2014 skipping soul-sync`);
      } else {
        console.log(`  \x1B[36m\uD83E\uDDEC\x1B[0m soul-sync (hand-over):`);
        console.log(formatSyncResults(results));
      }
    } catch (e) {
      console.log(`  \x1B[33m\u26A0\x1B[0m soul-sync failed: ${e.message}`);
    }
  }
  console.log();
}

// src/commands/sleep.ts
init_tmux();
init_wake();
import { appendFile as appendFile2, mkdir as mkdir2 } from "fs/promises";
import { homedir as homedir9 } from "os";
import { join as join14 } from "path";
async function cmdSleepOne(oracle, window) {
  const session = await detectSession(oracle);
  if (!session) {
    console.error(`\x1B[31merror\x1B[0m: no running session found for '${oracle}'`);
    process.exit(1);
  }
  const windowName = window ? `${oracle}-${window}` : `${oracle}-oracle`;
  let windows;
  try {
    windows = await tmux.listWindows(session);
  } catch {
    console.error(`\x1B[31merror\x1B[0m: could not list windows for session '${session}'`);
    process.exit(1);
  }
  const target = windows.find((w) => w.name === windowName);
  if (!target) {
    const nameSuffix = window || "oracle";
    const fuzzy = windows.find((w) => w.name === windowName || new RegExp(`^${oracle}-\\d+-${nameSuffix}$`).test(w.name));
    if (!fuzzy) {
      console.error(`\x1B[31merror\x1B[0m: window '${windowName}' not found in session '${session}'`);
      console.error(`\x1B[90mavailable:\x1B[0m ${windows.map((w) => w.name).join(", ")}`);
      process.exit(1);
    }
    return await doSleep(session, fuzzy.name, oracle);
  }
  await doSleep(session, windowName, oracle);
}
async function doSleep(session, windowName, oracle) {
  const target = `${session}:${windowName}`;
  console.log(`\x1B[90m...\x1B[0m sending /exit to ${target}`);
  try {
    for (const ch of "/exit") {
      await tmux.sendKeysLiteral(target, ch);
    }
    await tmux.sendKeys(target, "Enter");
  } catch {}
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const windows = await tmux.listWindows(session);
    const stillExists = windows.some((w) => w.name === windowName);
    if (stillExists) {
      await tmux.killWindow(target);
      console.log(`  \x1B[33m!\x1B[0m force-killed ${windowName} (did not exit gracefully)`);
    } else {
      console.log(`  \x1B[32m\u2713\x1B[0m ${windowName} exited gracefully`);
    }
  } catch {
    console.log(`  \x1B[32m\u2713\x1B[0m ${windowName} stopped`);
  }
  const logDir = join14(homedir9(), ".oracle");
  const logFile = join14(logDir, "maw-log.jsonl");
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    type: "sleep",
    oracle,
    window: windowName
  }) + `
`;
  try {
    await mkdir2(logDir, { recursive: true });
    await appendFile2(logFile, line);
  } catch {}
  console.log(`\x1B[32msleep\x1B[0m ${oracle} (${windowName})`);
}

// src/commands/log.ts
init_maw_log();
function displayName(name) {
  return name.replace(/-oracle$/, "").replace(/-mawjs$/, "");
}
function cmdLogLs(opts) {
  let entries = readLog();
  if (opts.from)
    entries = entries.filter((e) => e.from.toLowerCase().includes(opts.from.toLowerCase()));
  if (opts.to)
    entries = entries.filter((e) => e.to.toLowerCase().includes(opts.to.toLowerCase()));
  const limit = opts.limit || 20;
  const shown = entries.slice(-limit);
  if (shown.length === 0) {
    console.log(`
  \x1B[90mNo messages found.\x1B[0m
`);
    return;
  }
  console.log(`
  \x1B[36mmaw log\x1B[0m (${entries.length} total, showing last ${shown.length})
`);
  console.log(`  ${"Time".padEnd(8)} ${"From".padEnd(16)} ${"To".padEnd(16)} Message`);
  console.log(`  ${"\u2500".repeat(8)} ${"\u2500".repeat(16)} ${"\u2500".repeat(16)} ${"\u2500".repeat(40)}`);
  for (const e of shown) {
    const time = new Date(e.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const from = e.from.slice(0, 15).padEnd(16);
    const to = e.to.slice(0, 15).padEnd(16);
    const msg = (e.msg || "").slice(0, 60).replace(/\n/g, " ");
    console.log(`  ${time.padEnd(8)} \x1B[32m${from}\x1B[0m \x1B[33m${to}\x1B[0m ${msg}`);
  }
  console.log();
}
function cmdLogExport(opts) {
  let entries = readLog();
  if (opts.date)
    entries = entries.filter((e) => e.ts.startsWith(opts.date));
  if (opts.from)
    entries = entries.filter((e) => e.from.toLowerCase().includes(opts.from.toLowerCase()));
  if (opts.to)
    entries = entries.filter((e) => e.to.toLowerCase().includes(opts.to.toLowerCase()));
  if (opts.format === "json") {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  const dateLabel = opts.date || "all";
  console.log(`# Oracle Conversations \u2014 ${dateLabel}`);
  console.log();
  console.log(`> ${entries.length} messages`);
  console.log();
  for (const e of entries) {
    const time = new Date(e.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const from = displayName(e.from);
    console.log(`**${time}** \u2014 **${from}** \u2192 ${e.to}`);
    console.log();
    console.log(e.msg);
    console.log();
    console.log("---");
    console.log();
  }
}
var AGENT_ANSI = {
  "neo-oracle": "\x1B[38;5;75m",
  "pulse-oracle": "\x1B[38;5;203m",
  "hermes-oracle": "\x1B[38;5;79m",
  "calliope-oracle": "\x1B[38;5;120m",
  "nexus-oracle": "\x1B[38;5;141m",
  nat: "\x1B[38;5;222m"
};
var RST = "\x1B[0m";
var DIM = "\x1B[90m";
function agentAnsi(name) {
  return AGENT_ANSI[name] || "\x1B[37m";
}
function cmdLogChat(opts) {
  let entries = readLog();
  if (opts.from)
    entries = entries.filter((e) => e.from.toLowerCase().includes(opts.from.toLowerCase()));
  if (opts.to)
    entries = entries.filter((e) => e.to.toLowerCase().includes(opts.to.toLowerCase()));
  if (opts.pair) {
    const p = opts.pair.toLowerCase();
    entries = entries.filter((e) => e.from.toLowerCase().includes(p) || e.to.toLowerCase().includes(p));
  }
  const limit = opts.limit || 30;
  const shown = entries.slice(-limit);
  if (shown.length === 0) {
    console.log(`
  \x1B[90mNo messages found.\x1B[0m
`);
    return;
  }
  console.log();
  console.log(`  \x1B[36m\u250C\u2500 AI \u0E04\u0E38\u0E22\u0E01\u0E31\u0E19 \x1B[90m(${entries.length} total, last ${shown.length})${RST}`);
  console.log(`  \x1B[36m\u2502${RST}`);
  let lastFrom = "";
  for (const e of shown) {
    const time = new Date(e.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const from = displayName(e.from);
    const color = agentAnsi(e.from);
    const toName = displayName(e.to);
    const isNewSender = e.from !== lastFrom;
    const msg = (e.msg || "").replace(/\n/g, `
  \x1B[36m\u2502\x1B[0m   `);
    if (isNewSender) {
      console.log(`  \x1B[36m\u2502${RST}`);
      console.log(`  \x1B[36m\u2502${RST}  ${color}${from}${RST} ${DIM}\u2192 ${toName}  ${time}${RST}`);
    } else {
      console.log(`  \x1B[36m\u2502${RST}  ${DIM}${time}${RST}`);
    }
    console.log(`  \x1B[36m\u2502${RST}   ${msg}`);
    lastFrom = e.from;
  }
  console.log(`  \x1B[36m\u2502${RST}`);
  console.log(`  \x1B[36m\u2514\u2500${RST}`);
  console.log();
}

// src/commands/tokens.ts
init_token_index();
function formatNum(n) {
  if (n >= 1e9)
    return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)
    return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000)
    return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}
function cmdTokens(opts) {
  if (opts.rebuild) {
    console.log(`
  \x1B[36mRebuilding token index...\x1B[0m`);
    buildIndex(true);
  }
  const index = loadIndex();
  if (index.sessions.length === 0) {
    console.log(`
  \x1B[90mNo index found. Run: maw tokens --rebuild\x1B[0m
`);
    return;
  }
  const stats = summarize(index);
  if (opts.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  const top = opts.top || 15;
  console.log(`
  \x1B[36m\u250C\u2500 Token Usage\x1B[0m \x1B[90m(${stats.sessionCount} sessions, indexed ${index.updatedAt.slice(0, 16)})\x1B[0m
  \x1B[36m\u2502\x1B[0m
  \x1B[36m\u2502\x1B[0m  Input:        \x1B[33m${formatNum(stats.totalInput)}\x1B[0m tokens
  \x1B[36m\u2502\x1B[0m  Output:       \x1B[32m${formatNum(stats.totalOutput)}\x1B[0m tokens
  \x1B[36m\u2502\x1B[0m  Cache read:   \x1B[90m${formatNum(stats.totalCacheRead)}\x1B[0m
  \x1B[36m\u2502\x1B[0m  Cache create: \x1B[90m${formatNum(stats.totalCacheCreate)}\x1B[0m
  \x1B[36m\u2502\x1B[0m  Turns:        ${stats.totalTurns.toLocaleString()}
  \x1B[36m\u2502\x1B[0m`);
  console.log(`  \x1B[36m\u2502\x1B[0m  \x1B[33mBy Project\x1B[0m (top ${top})`);
  console.log(`  \x1B[36m\u2502\x1B[0m  ${"Project".padEnd(28)} ${"Input".padStart(10)} ${"Output".padStart(10)} ${"Turns".padStart(7)}`);
  console.log(`  \x1B[36m\u2502\x1B[0m  ${"\u2500".repeat(28)} ${"\u2500".repeat(10)} ${"\u2500".repeat(10)} ${"\u2500".repeat(7)}`);
  for (const p of stats.byProject.slice(0, top)) {
    console.log(`  \x1B[36m\u2502\x1B[0m  ${p.project.padEnd(28)} ${formatNum(p.input).padStart(10)} ${formatNum(p.output).padStart(10)} ${p.turns.toString().padStart(7)}`);
  }
  console.log(`  \x1B[36m\u2502\x1B[0m`);
  console.log(`  \x1B[36m\u2502\x1B[0m  \x1B[33mBy Date\x1B[0m (recent)`);
  console.log(`  \x1B[36m\u2502\x1B[0m  ${"Date".padEnd(12)} ${"Input".padStart(10)} ${"Output".padStart(10)} ${"Turns".padStart(7)}`);
  console.log(`  \x1B[36m\u2502\x1B[0m  ${"\u2500".repeat(12)} ${"\u2500".repeat(10)} ${"\u2500".repeat(10)} ${"\u2500".repeat(7)}`);
  for (const d of stats.byDate.slice(0, 7)) {
    console.log(`  \x1B[36m\u2502\x1B[0m  ${d.date.padEnd(12)} ${formatNum(d.input).padStart(10)} ${formatNum(d.output).padStart(10)} ${d.turns.toString().padStart(7)}`);
  }
  console.log(`  \x1B[36m\u2502\x1B[0m`);
  console.log(`  \x1B[36m\u2514\u2500\x1B[0m`);
  console.log();
}

// src/commands/tab.ts
init_ssh();

// src/commands/talk-to.ts
init_config();
init_ssh();
import { appendFile as appendFile3, mkdir as mkdir3 } from "fs/promises";
import { homedir as homedir11, hostname } from "os";
import { join as join16 } from "path";
var ORACLE_URL = () => process.env.ORACLE_URL || loadConfig().oracleUrl;
async function findChannelThread(target) {
  try {
    const res = await fetch(`${ORACLE_URL()}/api/threads?limit=50`);
    if (!res.ok)
      return null;
    const data = await res.json();
    const channel = data.threads.find((t) => t.title === `channel:${target}` && t.status !== "closed");
    return channel?.id ?? null;
  } catch {
    return null;
  }
}
async function postToThread(target, message) {
  const threadId = await findChannelThread(target);
  const body = {
    message,
    role: "claude"
  };
  if (threadId) {
    body.thread_id = threadId;
  } else {
    body.title = `channel:${target}`;
  }
  try {
    const res = await fetch(`${ORACLE_URL()}/api/thread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.error(`\x1B[31merror\x1B[0m: Oracle API returned ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(`\x1B[31merror\x1B[0m: Oracle unreachable \u2014 ${e.message}`);
    return null;
  }
}
async function getThreadInfo(threadId) {
  try {
    const res = await fetch(`${ORACLE_URL()}/api/thread/${threadId}`);
    if (!res.ok)
      return null;
    const data = await res.json();
    return { messageCount: data.messages.length };
  } catch {
    return null;
  }
}
async function cmdTalkTo(target, message, force = false) {
  console.log(`\x1B[36m\uD83D\uDCAC\x1B[0m posting to thread channel:${target}...`);
  const threadResult = await postToThread(target, message);
  if (!threadResult) {
    console.error(`\x1B[33mwarn\x1B[0m: thread post failed \u2014 falling back to maw hey only`);
  }
  const from = process.env.CLAUDE_AGENT_NAME || "cli";
  const preview = message.length > 80 ? message.slice(0, 77) + "..." : message;
  let notification;
  if (threadResult) {
    const info = await getThreadInfo(threadResult.thread_id);
    const msgCount = info?.messageCount ?? "?";
    notification = [
      `\uD83D\uDCAC channel:${target} (#${threadResult.thread_id}) \u2014 ${msgCount} msgs`,
      `From: ${from}`,
      `Preview: "${preview}"`,
      `\u2192 \u0E2D\u0E48\u0E32\u0E19\u0E40\u0E15\u0E47\u0E21\u0E17\u0E35\u0E48 thread #${threadResult.thread_id} \u0E2B\u0E23\u0E37\u0E2D\u0E1E\u0E34\u0E21\u0E1E\u0E4C /talk-to #${threadResult.thread_id}`
    ].join(`
`);
  } else {
    notification = [
      `\uD83D\uDCAC from ${from}`,
      `"${preview}"`
    ].join(`
`);
  }
  const sessions = await listSessions();
  const tmuxTarget = findWindow(sessions, target);
  if (!tmuxTarget) {
    if (threadResult) {
      console.log(`\x1B[32m\u2713\x1B[0m thread #${threadResult.thread_id} updated`);
      console.log(`\x1B[33mwarn\x1B[0m: window "${target}" not found \u2014 message saved to thread only`);
    } else {
      console.error(`\x1B[31merror\x1B[0m: window "${target}" not found`);
      process.exit(1);
    }
    return;
  }
  if (!force) {
    const cmd = await getPaneCommand(tmuxTarget);
    const isAgent = /claude|codex|node/i.test(cmd);
    if (!isAgent) {
      if (threadResult) {
        console.log(`\x1B[32m\u2713\x1B[0m thread #${threadResult.thread_id} updated`);
        console.log(`\x1B[33mwarn\x1B[0m: no active Claude in ${tmuxTarget} \u2014 message saved to thread only`);
      } else {
        console.error(`\x1B[31merror\x1B[0m: no active Claude session in ${tmuxTarget} (use --force)`);
        process.exit(1);
      }
      return;
    }
  }
  await sendKeys(tmuxTarget, notification);
  await runHook("after_send", { to: target, message: notification });
  const logDir = join16(homedir11(), ".oracle");
  const logFile = join16(logDir, "maw-log.jsonl");
  const host = hostname();
  const sid = process.env.CLAUDE_SESSION_ID || null;
  const ch = threadResult ? `thread:${threadResult.thread_id}` : undefined;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    from,
    to: target,
    target: tmuxTarget,
    msg: message,
    host,
    sid,
    ch
  }) + `
`;
  try {
    await mkdir3(logDir, { recursive: true });
    await appendFile3(logFile, line);
  } catch {}
  console.log(`\x1B[32m\u2713\x1B[0m thread #${threadResult?.thread_id ?? "?"} + sent \u2192 ${tmuxTarget}`);
}

// src/commands/tab.ts
async function currentSession() {
  try {
    return (await ssh("tmux display-message -p '#S'")).trim();
  } catch {
    console.error("\x1B[31merror\x1B[0m: not inside a tmux session");
    process.exit(1);
  }
}
async function listTabs(session) {
  const raw = await ssh(`tmux list-windows -t '${session}' -F '#{window_index}:#{window_name}:#{window_active}'`);
  return raw.split(`
`).filter(Boolean).map((line) => {
    const [idx, name, active] = line.split(":");
    return { index: +idx, name, active: active === "1" };
  });
}
async function cmdTab(tabArgs) {
  const session = await currentSession();
  const tabNum = tabArgs[0] ? parseInt(tabArgs[0], 10) : NaN;
  if (isNaN(tabNum)) {
    const tabs2 = await listTabs(session);
    console.log(`\x1B[36m${session}\x1B[0m tabs:`);
    for (const t of tabs2) {
      const marker = t.active ? " \x1B[32m\u2190 you are here\x1B[0m" : "";
      console.log(`  ${t.index}: ${t.name}${marker}`);
    }
    return;
  }
  const tabs = await listTabs(session);
  const tab = tabs.find((t) => t.index === tabNum);
  if (!tab) {
    console.error(`\x1B[31merror\x1B[0m: tab ${tabNum} not found in session \x1B[36m${session}\x1B[0m`);
    console.error(`available: ${tabs.map((t) => t.index).join(", ")}`);
    process.exit(1);
  }
  const hasTalk = tabArgs.includes("--talk");
  const remaining = tabArgs.slice(1).filter((a) => a !== "--force" && a !== "--talk");
  const force = tabArgs.includes("--force");
  if (!remaining.length) {
    await cmdPeek(tab.name);
    return;
  }
  const message = remaining.join(" ");
  if (hasTalk) {
    await cmdTalkTo(tab.name, message, force);
    return;
  }
  await cmdSend(tab.name, message, force);
}

// src/cli.ts
process.env.MAW_CLI = "1";
var args = process.argv.slice(2);
var cmd = args[0]?.toLowerCase();
function usage() {
  console.log(`\x1B[36mmaw\x1B[0m \u2014 Multi-Agent Workflow

\x1B[33mUsage:\x1B[0m
  maw ls                      List sessions + windows
  maw peek [agent]            Peek agent screen (or all)
  maw hey <agent> <msg...>    Send message to agent (alias: tell)
  maw wake <oracle> [task]    Wake oracle in tmux window + claude
  maw wake <oracle> --issue N Wake oracle with GitHub issue as prompt
  maw fleet init              Scan ghq repos, generate fleet/*.json
  maw fleet ls                List fleet configs with conflict detection
  maw fleet renumber          Fix numbering conflicts (sequential)
  maw fleet validate          Check for problems (dupes, orphans, missing repos)
  maw fleet sync              Add unregistered windows to fleet configs
  maw wake all [--kill]       Wake fleet (01-15 + 99, skips dormant 20+)
  maw wake all --all          Wake ALL including dormant
  maw wake all --resume       Wake fleet + send /recap to active board items
  maw sleep <oracle> [window] Gracefully stop one oracle window
  maw stop                    Stop all fleet sessions
  maw about <oracle>           Oracle profile \u2014 session, worktrees, fleet
  maw oracle ls               Fleet status (awake/sleeping/worktrees)
  maw overview              War-room: all oracles in split panes
  maw overview neo hermes   Only specific oracles
  maw overview --kill       Tear down overview
  maw done <window>            Clean up finished worktree window
  maw sovereign status          Oracle-as-Sovereign \u03C8/ status
  maw sovereign migrate <oracle> Migrate \u03C8/ to sovereign layout
  maw sovereign migrate --all   Migrate all oracles
  maw sovereign rollback <oracle> Restore original layout
  maw sovereign verify          Health check all symlinks
  maw bud <name> [opts]        Spawn new child oracle (budding)
  maw bud <name> --from <oracle> --approved-by bank
  maw bud <name> --dry-run     Show plan without executing
  maw pulse add "task" [opts] Create issue + wake oracle
  maw pulse scan               Anti-pattern health check (Zombie/Island)
  maw pulse scan --json        JSON output for dashboard/API
  maw pulse cleanup [--dry-run] Clean stale/orphan worktrees
  maw board done #<issue> [msg] Mark board item Done + close issue
  maw view <agent> [window]   Grouped tmux session (interactive attach)
  maw create-view <agent> [w] Alias for view
  maw view <agent> --clean    Hide status bar (full screen)
  maw think                   Oracles scan work + propose ideas (GitHub issues)
  maw think --oracles hr,dev  Limit which oracles think
  maw review                  BoB reviews proposals \u2192 sends to inbox
  maw meeting "goal"          BoB holds a meeting \u2014 wakes agents, collects input
  maw meeting "goal" --dry-run  Show participants without waking
  maw meeting "goal" --oracles dev,qa  Limit participants
  maw task log <#> "msg"       Log activity on a task
  maw task log <#> --commit "hash msg"  Log a commit
  maw task log <#> --blocker "desc"     Log a blocker
  maw task comment <#> "msg"   Comment on task (cross-oracle)
  maw task ls                  Board + activity counts
  maw task show <#>            Full activity timeline
  maw project ls               List all projects
  maw project show <id>        Project tree view
  maw project create <id> "name"  Create a project
  maw project add <id> #<issue>   Add task to project
  maw project add <id> #<issue> --parent #<parent>  Add as subtask
  maw project auto-organize    Auto-group unassigned tasks
  maw project comment <id> "msg"  Comment on project
  maw project complete <id>    Mark project completed
  maw project archive <id>     Archive project
  maw tokens [--rebuild]      Token usage stats (from Claude sessions)
  maw tokens --json           JSON output for API consumption
  maw log chat [oracle]       Chat view \u2014 grouped conversation bubbles
  maw chat [oracle]           Shorthand for log chat
  maw tab                      List tabs in current session
  maw tab N                    Peek tab N
  maw tab N <msg...>           Send message to tab N
  maw talk-to <agent> <msg>    Thread + hey (persistent + real-time)
  maw <agent> <msg...>        Shorthand for hey
  maw loop                    Show loop status (scheduled tasks)
  maw loop history [id]       Loop execution history
  maw loop trigger <id>       Manually fire a loop
  maw loop add '{json}'       Add/update a loop definition
  maw loop remove <id>        Remove a loop
  maw loop enable|disable <id> Toggle a loop on/off
  maw loop on|off             Enable/disable loop engine
  maw <agent>                 Shorthand for peek
  maw serve [port]            Start web UI (default: 3456)

\x1B[33mWake modes:\x1B[0m
  maw wake neo                Wake main repo
  maw wake hermes bitkub      Wake existing worktree
  maw wake neo --new free     Create worktree + wake
  maw wake neo --issue 5      Fetch issue #5 + send as claude -p prompt
  maw wake neo --issue 5 --repo org/repo   Explicit repo

\x1B[33mPulse add:\x1B[0m
  maw pulse ls                Board table (terminal)
  maw pulse ls --sync         + update daily thread checkboxes
  maw pulse add "Fix bug" --oracle neo
  maw pulse add "task" --oracle neo --wt oracle-v2

\x1B[33mEnv:\x1B[0m
  MAW_HOST=white.local        SSH target (default: white.local)

\x1B[33mExamples:\x1B[0m
  maw wake neo --new bitkub   Create worktree + start claude
  maw pulse add "Fix IME" --oracle neo --priority P1
  maw hey neo what is your status
  maw serve 8080`);
}
if (cmd === "--version" || cmd === "-v") {
  const pkg = require_package();
  let hash = "";
  try {
    hash = __require("child_process").execSync("git rev-parse --short HEAD", { cwd: import.meta.dir }).toString().trim();
  } catch {}
  console.log(`maw v${pkg.version}${hash ? ` (${hash})` : ""}`);
} else if (!cmd || cmd === "--help" || cmd === "-h") {
  usage();
} else if (cmd === "ls" || cmd === "list") {
  await cmdList();
} else if (cmd === "peek" || cmd === "see") {
  await cmdPeek(args[1]);
} else if (cmd === "hey" || cmd === "send" || cmd === "tell") {
  const force = args.includes("--force");
  const msgArgs = args.slice(2).filter((a) => a !== "--force");
  if (!args[1] || !msgArgs.length) {
    console.error("usage: maw hey <agent> <message> [--force]");
    process.exit(1);
  }
  await cmdSend(args[1], msgArgs.join(" "), force);
} else if (cmd === "talk-to" || cmd === "talkto" || cmd === "talk") {
  const force = args.includes("--force");
  const msgArgs = args.slice(2).filter((a) => a !== "--force");
  if (!args[1] || !msgArgs.length) {
    console.error("usage: maw talk-to <agent> <message> [--force]");
    process.exit(1);
  }
  await cmdTalkTo(args[1], msgArgs.join(" "), force);
} else if (cmd === "fleet" && args[1] === "init") {
  await cmdFleetInit();
} else if (cmd === "fleet" && args[1] === "ls") {
  await cmdFleetLs();
} else if (cmd === "fleet" && args[1] === "renumber") {
  await cmdFleetRenumber();
} else if (cmd === "fleet" && args[1] === "validate") {
  await cmdFleetValidate();
} else if (cmd === "fleet" && args[1] === "sync") {
  await cmdFleetSync();
} else if (cmd === "fleet" && !args[1]) {
  await cmdFleetLs();
} else if (cmd === "log") {
  const sub = args[1]?.toLowerCase();
  if (sub === "export") {
    const logOpts = {};
    for (let i = 2;i < args.length; i++) {
      if (args[i] === "--date" && args[i + 1])
        logOpts.date = args[++i];
      else if (args[i] === "--from" && args[i + 1])
        logOpts.from = args[++i];
      else if (args[i] === "--to" && args[i + 1])
        logOpts.to = args[++i];
      else if (args[i] === "--format" && args[i + 1])
        logOpts.format = args[++i];
    }
    cmdLogExport(logOpts);
  } else if (sub === "chat") {
    const logOpts = {};
    for (let i = 2;i < args.length; i++) {
      if (args[i] === "--limit" && args[i + 1])
        logOpts.limit = +args[++i];
      else if (args[i] === "--from" && args[i + 1])
        logOpts.from = args[++i];
      else if (args[i] === "--to" && args[i + 1])
        logOpts.to = args[++i];
      else if (args[i] === "--pair" && args[i + 1])
        logOpts.pair = args[++i];
      else if (!args[i].startsWith("--"))
        logOpts.pair = args[i];
    }
    cmdLogChat(logOpts);
  } else {
    const logOpts = {};
    for (let i = 1;i < args.length; i++) {
      if (args[i] === "--limit" && args[i + 1])
        logOpts.limit = +args[++i];
      else if (args[i] === "--from" && args[i + 1])
        logOpts.from = args[++i];
      else if (args[i] === "--to" && args[i + 1])
        logOpts.to = args[++i];
    }
    cmdLogLs(logOpts);
  }
} else if (cmd === "task") {
  const sub = args[1]?.toLowerCase();
  if (sub === "log") {
    const { cmdTaskLog: cmdTaskLog2 } = await Promise.resolve().then(() => (init_task_log2(), exports_task_log));
    await cmdTaskLog2(args.slice(2));
  } else if (sub === "show") {
    const { cmdTaskShow: cmdTaskShow2 } = await Promise.resolve().then(() => (init_task_log2(), exports_task_log));
    await cmdTaskShow2(args.slice(2));
  } else if (sub === "comment") {
    const { cmdTaskComment: cmdTaskComment2 } = await Promise.resolve().then(() => (init_task_log2(), exports_task_log));
    await cmdTaskComment2(args.slice(2));
  } else if (sub === "ls" || sub === "list" || !sub) {
    const { cmdTaskLs: cmdTaskLs2 } = await Promise.resolve().then(() => (init_task_log2(), exports_task_log));
    await cmdTaskLs2();
  } else {
    console.error("usage: maw task <log|ls|show|comment> [opts]");
    process.exit(1);
  }
} else if (cmd === "project" || cmd === "proj") {
  const sub = args[1]?.toLowerCase();
  if (sub === "ls" || sub === "list" || !sub) {
    const { cmdProjectLs: cmdProjectLs2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectLs2();
  } else if (sub === "show") {
    const { cmdProjectShow: cmdProjectShow2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectShow2(args.slice(2));
  } else if (sub === "create" || sub === "new") {
    const { cmdProjectCreate: cmdProjectCreate2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectCreate2(args.slice(2));
  } else if (sub === "add") {
    const { cmdProjectAdd: cmdProjectAdd2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectAdd2(args.slice(2));
  } else if (sub === "remove" || sub === "rm") {
    const { cmdProjectRemove: cmdProjectRemove2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectRemove2(args.slice(2));
  } else if (sub === "auto-organize" || sub === "auto" || sub === "organize") {
    const { cmdProjectAutoOrganize: cmdProjectAutoOrganize2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectAutoOrganize2();
  } else if (sub === "comment") {
    const { cmdProjectComment: cmdProjectComment2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectComment2(args.slice(2));
  } else if (sub === "complete" || sub === "done") {
    const { cmdProjectSetStatus: cmdProjectSetStatus2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectSetStatus2(args.slice(2), "completed");
  } else if (sub === "archive") {
    const { cmdProjectSetStatus: cmdProjectSetStatus2 } = await Promise.resolve().then(() => (init_project(), exports_project));
    await cmdProjectSetStatus2(args.slice(2), "archived");
  } else {
    console.error("usage: maw project <ls|show|create|add|remove|auto-organize|comment|complete|archive>");
    process.exit(1);
  }
} else if (cmd === "chat") {
  const logOpts = {};
  for (let i = 1;i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1])
      logOpts.limit = +args[++i];
    else if (!args[i].startsWith("--"))
      logOpts.pair = args[i];
  }
  cmdLogChat(logOpts);
} else if (cmd === "tokens" || cmd === "usage") {
  const rebuild = args.includes("--rebuild") || args.includes("--reindex");
  const json = args.includes("--json");
  const topIdx = args.indexOf("--top");
  const top = topIdx >= 0 ? +args[topIdx + 1] : undefined;
  cmdTokens({ rebuild, json, top });
} else if (cmd === "done" || cmd === "finish") {
  if (!args[1]) {
    console.error(`usage: maw done <window-name>
       e.g. maw done neo-freelance`);
    process.exit(1);
  }
  await cmdDone(args[1]);
} else if (cmd === "stop" || cmd === "rest") {
  await cmdSleep();
} else if (cmd === "sleep") {
  if (!args[1]) {
    console.error(`usage: maw sleep <oracle> [window]
       maw sleep neo          # sleep neo-oracle
       maw sleep neo mawjs    # sleep neo-mawjs worktree
       maw stop               # stop ALL fleet sessions`);
    process.exit(1);
  } else if (args[1] === "--all-done") {
    console.log("\x1B[90m(placeholder) maw sleep --all-done \u2014 sleep ALL agents. Not yet implemented.\x1B[0m");
  } else {
    await cmdSleepOne(args[1], args[2]);
  }
} else if (cmd === "wake") {
  if (!args[1]) {
    console.error(`usage: maw wake <oracle> [task] [--new <name>]
       maw wake all [--kill]`);
    process.exit(1);
  }
  if (args[1].toLowerCase() === "all") {
    await cmdWakeAll({ kill: args.includes("--kill"), all: args.includes("--all"), resume: args.includes("--resume") });
  } else {
    const wakeOpts = {};
    let issueNum = null;
    let repo;
    for (let i = 2;i < args.length; i++) {
      if (args[i] === "--new" && args[i + 1]) {
        wakeOpts.newWt = args[++i];
      } else if (args[i] === "--issue" && args[i + 1]) {
        issueNum = +args[++i];
      } else if (args[i] === "--repo" && args[i + 1]) {
        repo = args[++i];
      } else if (!wakeOpts.task) {
        wakeOpts.task = args[i];
      }
    }
    if (issueNum) {
      console.log(`\x1B[36m\u26A1\x1B[0m fetching issue #${issueNum}...`);
      wakeOpts.prompt = await fetchIssuePrompt(issueNum, repo);
      if (!wakeOpts.task)
        wakeOpts.task = `issue-${issueNum}`;
    }
    await cmdWake(args[1], wakeOpts);
  }
} else if (cmd === "sovereign" || cmd === "sov") {
  const { cmdSovereign: cmdSovereign2 } = await Promise.resolve().then(() => (init_sovereign(), exports_sovereign));
  await cmdSovereign2(args.slice(1));
} else if (cmd === "bud") {
  const budName = args[1];
  if (!budName) {
    console.error("usage: maw bud <name> --approved-by <human> [--from <oracle>] [--dry-run]");
    process.exit(1);
  }
  const budOpts = {};
  for (let i = 2;i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1])
      budOpts.from = args[++i];
    else if (args[i] === "--repo" && args[i + 1])
      budOpts.repo = args[++i];
    else if (args[i] === "--approved-by" && args[i + 1])
      budOpts.approvedBy = args[++i];
    else if (args[i] === "--dry-run")
      budOpts.dryRun = true;
  }
  await cmdBud(budName, budOpts);
} else if (cmd === "pulse") {
  const subcmd = args[1];
  if (subcmd === "add") {
    const pulseOpts = {};
    let title = "";
    for (let i = 2;i < args.length; i++) {
      if (args[i] === "--oracle" && args[i + 1]) {
        pulseOpts.oracle = args[++i];
      } else if (args[i] === "--priority" && args[i + 1]) {
        pulseOpts.priority = args[++i];
      } else if ((args[i] === "--wt" || args[i] === "--worktree") && args[i + 1]) {
        pulseOpts.wt = args[++i];
      } else if (!title) {
        title = args[i];
      }
    }
    if (!title) {
      console.error('usage: maw pulse add "task title" --oracle <name> [--wt <repo>]');
      process.exit(1);
    }
    await cmdPulseAdd(title, pulseOpts);
  } else if (subcmd === "ls" || subcmd === "list") {
    const sync = args.includes("--sync");
    await cmdPulseLs({ sync });
  } else if (subcmd === "scan" || subcmd === "health") {
    const json = args.includes("--json");
    cmdPulseScan({ json });
  } else if (subcmd === "cleanup" || subcmd === "clean") {
    const { scanWorktrees: scanWorktrees2, cleanupWorktree: cleanupWorktree2 } = await Promise.resolve().then(() => (init_worktrees(), exports_worktrees));
    const worktrees = await scanWorktrees2();
    const stale = worktrees.filter((wt) => wt.status !== "active");
    if (!stale.length) {
      console.log("\x1B[32m\u2713\x1B[0m All worktrees are active. Nothing to clean.");
      process.exit(0);
    }
    console.log(`
\x1B[36mWorktree Cleanup\x1B[0m
`);
    console.log(`  \x1B[32m${worktrees.filter((w) => w.status === "active").length} active\x1B[0m | \x1B[33m${worktrees.filter((w) => w.status === "stale").length} stale\x1B[0m | \x1B[31m${worktrees.filter((w) => w.status === "orphan").length} orphan\x1B[0m
`);
    for (const wt of stale) {
      const color = wt.status === "orphan" ? "\x1B[31m" : "\x1B[33m";
      console.log(`${color}${wt.status}\x1B[0m  ${wt.name} (${wt.mainRepo}) [${wt.branch}]`);
      if (!args.includes("--dry-run")) {
        const log = await cleanupWorktree2(wt.path);
        for (const line of log)
          console.log(`  \x1B[32m\u2713\x1B[0m ${line}`);
      }
    }
    if (args.includes("--dry-run"))
      console.log(`
\x1B[90m(dry run \u2014 use without --dry-run to clean)\x1B[0m`);
    console.log();
  } else {
    console.error("usage: maw pulse <add|ls|cleanup> [opts]");
    process.exit(1);
  }
} else if (cmd === "board") {
  const subcmd = args[1];
  if (subcmd === "done" || subcmd === "complete") {
    const { cmdBoardDone: cmdBoardDone2 } = await Promise.resolve().then(() => (init_board_done(), exports_board_done));
    await cmdBoardDone2(args.slice(2));
  } else {
    console.error('usage: maw board done #<issue> ["message"]');
    process.exit(1);
  }
} else if (cmd === "think") {
  const { cmdThink: cmdThink2 } = await Promise.resolve().then(() => (init_think(), exports_think));
  const thinkOpts = {};
  for (let i = 1;i < args.length; i++) {
    if (args[i] === "--oracles" && args[i + 1]) {
      thinkOpts.oracles = args[++i].split(",");
    } else if (args[i] === "--dry-run") {
      thinkOpts.dryRun = true;
    }
  }
  await cmdThink2(thinkOpts);
} else if (cmd === "review") {
  const { cmdReview: cmdReview2 } = await Promise.resolve().then(() => (init_think(), exports_think));
  await cmdReview2();
} else if (cmd === "meeting" || cmd === "meet") {
  const { cmdMeeting: cmdMeeting2 } = await Promise.resolve().then(() => (init_meeting(), exports_meeting));
  const meetOpts = {};
  let goal = "";
  for (let i = 1;i < args.length; i++) {
    if (args[i] === "--oracles" && args[i + 1]) {
      meetOpts.oracles = args[++i].split(",");
    } else if (args[i] === "--dry-run") {
      meetOpts.dryRun = true;
    } else if (args[i] === "--timeout" && args[i + 1]) {
      meetOpts.timeout = +args[++i];
    } else if (!goal) {
      goal = args[i];
    }
  }
  if (!goal) {
    console.error('usage: maw meeting "goal" [--oracles dev,designer] [--dry-run] [--timeout 120]');
    process.exit(1);
  }
  await cmdMeeting2(goal, meetOpts);
} else if (cmd === "overview" || cmd === "warroom" || cmd === "ov") {
  await cmdOverview(args.slice(1));
} else if (cmd === "about" || cmd === "info") {
  if (!args[1]) {
    console.error("usage: maw about <oracle>");
    process.exit(1);
  }
  await cmdOracleAbout(args[1]);
} else if (cmd === "oracle" || cmd === "oracles") {
  const subcmd = args[1]?.toLowerCase();
  if (!subcmd || subcmd === "ls" || subcmd === "list") {
    await cmdOracleList();
  } else {
    console.error("usage: maw oracle ls");
    process.exit(1);
  }
} else if (cmd === "completions") {
  await cmdCompletions(args[1]);
} else if (cmd === "tab" || cmd === "tabs") {
  await cmdTab(args.slice(1));
} else if (cmd === "view" || cmd === "create-view" || cmd === "attach") {
  if (!args[1]) {
    console.error("usage: maw view <agent> [window] [--clean]");
    process.exit(1);
  }
  const clean = args.includes("--clean");
  const viewArgs = args.slice(1).filter((a) => a !== "--clean");
  await cmdView(viewArgs[0], viewArgs[1], clean);
} else if (cmd === "loop" || cmd === "loops") {
  const { cmdLoop: cmdLoop2 } = await Promise.resolve().then(() => (init_loop(), exports_loop));
  await cmdLoop2(args.slice(1));
} else if (cmd === "auth") {
  const { setupAuth: setupAuth2 } = await Promise.resolve().then(() => (init_auth(), exports_auth));
  const sub = args[1];
  if (sub === "setup") {
    const user = args[2];
    const pass = args[3];
    if (!user || !pass) {
      console.error("usage: maw auth setup <username> <password>");
      process.exit(1);
    }
    setupAuth2(user, pass);
    console.log(`\x1B[32m\u2713\x1B[0m Auth enabled \u2014 user: ${user}`);
    console.log("  Restart maw server: pm2 restart maw");
  } else if (sub === "disable") {
    const { readFileSync: readFileSync21, writeFileSync: writeFileSync13 } = await import("fs");
    const { join: join30 } = await import("path");
    const p = join30(import.meta.dir, "../auth.json");
    try {
      const c = JSON.parse(readFileSync21(p, "utf-8"));
      c.enabled = false;
      writeFileSync13(p, JSON.stringify(c, null, 2), "utf-8");
      console.log("\x1B[33m\u2298\x1B[0m Auth disabled");
    } catch {
      console.error("No auth config found");
    }
  } else {
    console.log("usage: maw auth setup <username> <password>");
    console.log("       maw auth disable");
  }
} else if (cmd === "serve") {
  const { startServer: startServer2 } = await Promise.resolve().then(() => (init_server2(), exports_server));
  startServer2(args[1] ? +args[1] : 3456);
} else {
  if (args.length >= 2) {
    const f = args.includes("--force");
    const m = args.slice(1).filter((a) => a !== "--force");
    await cmdSend(args[0], m.join(" "), f);
  } else {
    await cmdPeek(args[0]);
  }
}
