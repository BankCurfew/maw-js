import { Hono } from "hono";
import { cors } from "hono/cors";
import { MawEngine } from "./engine";
import type { WSData } from "./types";
import { loadConfig } from "./config";
import { existsSync, readFileSync } from "fs";
import { api } from "./api";
import { feedBuffer, feedListeners } from "./api/feed";
import { mountViews } from "./views/index";
import { setupTriggerListener } from "./trigger-listener";
import { createTransportRouter } from "./transports";
import { handlePtyMessage, handlePtyClose } from "./pty";

// --- Version info (computed once at startup) ---

function getVersionString(): string {
  try {
    const pkg = require("../package.json");
    let hash = ""; try { hash = require("child_process").execSync("git rev-parse --short HEAD", { cwd: import.meta.dir }).toString().trim(); } catch {}
    let buildDate = "";
    try {
      const raw = require("child_process").execSync("git log -1 --format=%ci", { cwd: import.meta.dir }).toString().trim();
      const d = new Date(raw);
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      buildDate = `${raw.slice(0, 10)} ${days[d.getDay()]} ${raw.slice(11, 16)}`;
    } catch {}
    return `v${pkg.version}${hash ? ` (${hash})` : ""}${buildDate ? ` built ${buildDate}` : ""}`;
  } catch { return ""; }
}

export const VERSION = getVersionString();

// --- Hono app ---

const app = new Hono();
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Access-Control-Allow-Private-Network", "true");
});
app.use("/api/*", cors());

app.route("/api", api);

// Fleet topology visualization
app.get("/topology", async (c) => {
  const path = require("path").resolve(process.cwd(), "ψ/outbox/fleet-topology.html");
  try {
    const html = require("fs").readFileSync(path, "utf-8");
    return c.html(html);
  } catch { return c.text("fleet-topology.html not found", 404); }
});

mountViews(app);

app.onError((err, c) => c.json({ error: err.message }, 500));

export { app };

// --- Server ---

export function startServer(port = +(process.env.MAW_PORT || loadConfig().port || 3456)) {
  const engine = new MawEngine({ feedBuffer, feedListeners });

  const HTTP_URL = `http://localhost:${port}`;
  const WS_URL = `ws://localhost:${port}/ws`;

  // Connect transport router (non-blocking — server starts even if transports fail)
  try {
    const router = createTransportRouter();
    router.connectAll().catch(err => console.error("[transport] connect failed:", err));
    engine.setTransportRouter(router);
  } catch (err) {
    console.error("[transport] router init failed:", err);
  }

  // Hook workflow triggers into feed events
  setupTriggerListener(feedListeners);

  // MQTT publish — broadcast feed events to configurable broker (subscribe via CF Worker bridge)
  try {
    const { mqttPublish } = require("./mqtt-publish");
    const node = loadConfig().node ?? "local";
    feedListeners.add((event: any) => {
      const oracle = event.oracle || "unknown";
      mqttPublish(`maw/v1/oracle/${oracle}/feed`, event);
      mqttPublish(`maw/v1/node/${node}/feed`, event);
    });
  } catch {}

  // Shell hooks — fire configured ~/.oracle/maw.hooks.json scripts on feed events
  try {
    const { runHook } = require("./hooks");
    feedListeners.add((event: any) => {
      runHook(event.event, {
        from: event.oracle,
        to: event.oracle,
        message: event.message,
        channel: "feed",
      }).catch((err: Error) => {
        console.error("[hooks]", event.event, err.message);
      });
    });
  } catch (err) {
    console.error("[hooks] failed to load:", err);
  }

  // Plugin system — load user plugins from ~/.oracle/plugins/
  try {
    const { PluginSystem, loadPlugins } = require("./plugins");
    const { homedir } = require("os");
    const { join } = require("path");
    const plugins = new PluginSystem();
    loadPlugins(plugins, join(homedir(), ".oracle", "plugins"));
    feedListeners.add((event: any) => plugins.emit(event));

    // Plugin debug API
    app.get("/api/plugins", (c: any) => c.json(plugins.stats()));

    // Plugin debug page
    app.get("/plugins", (c: any) => c.html(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Plugins — maw</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#020a18;color:#e0e0e0;font:13px/1.6 monospace;padding:24px}
h1{color:#00f5d4;font-size:18px;margin-bottom:16px}
.stats{display:flex;gap:24px;margin-bottom:24px}
.stat{background:#0a1628;border:1px solid #1a2a40;border-radius:8px;padding:12px 20px}
.stat .n{font-size:28px;font-weight:bold;color:#00f5d4}
.stat .l{font-size:10px;color:#607080;text-transform:uppercase;letter-spacing:1px}
table{width:100%;border-collapse:collapse;margin-bottom:24px}
th{text-align:left;font-size:10px;color:#607080;text-transform:uppercase;letter-spacing:1px;padding:8px 12px;border-bottom:1px solid #1a2a40}
td{padding:8px 12px;border-bottom:1px solid #0d1a2a}
tr:hover{background:#0a1628}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:bold}
.ts{background:#00f5d420;color:#00f5d4}
.wasm-shared{background:#9b5de520;color:#9b5de5}
.wasm-wasi{background:#f15bb520;color:#f15bb5}
.js{background:#fee44020;color:#fee440}
.hook{background:#0a1628;border:1px solid #1a2a40;border-radius:8px;padding:16px;margin-bottom:16px}
.hook h3{font-size:12px;color:#607080;margin-bottom:8px}
.hook-list{display:flex;flex-wrap:wrap;gap:6px}
.hook-item{background:#061525;padding:4px 10px;border-radius:4px;font-size:11px}
.hook-item .count{color:#00f5d4;margin-left:4px}
.err{color:#f15bb5}.ok{color:#00f5d4}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
</style></head><body>
<h1>🔌 Plugin System</h1>
<div id="app">Loading...</div>
<script>
async function load(){
  const r=await fetch('/api/plugins');const d=await r.json();
  const up=Math.round((Date.now()-new Date(d.startedAt).getTime())/1000);
  const upStr=up>3600?Math.floor(up/3600)+'h '+Math.floor((up%3600)/60)+'m':up>60?Math.floor(up/60)+'m '+up%60+'s':up+'s';
  let h='<div class="stats">';
  h+='<div class="stat"><div class="n">'+d.plugins.length+'</div><div class="l">Plugins</div></div>';
  h+='<div class="stat"><div class="n '+(d.totalEvents>0?"pulse":"")+'">'+d.totalEvents+'</div><div class="l">Events</div></div>';
  h+='<div class="stat"><div class="n '+(d.totalErrors>0?"err":"ok")+'">'+d.totalErrors+'</div><div class="l">Errors</div></div>';
  h+='<div class="stat"><div class="n">'+upStr+'</div><div class="l">Uptime</div></div>';
  h+='</div>';
  h+='<table><tr><th>Plugin</th><th>Type</th><th>Events</th><th>Errors</th><th>Last Event</th><th>Loaded</th></tr>';
  for(const p of d.plugins){
    const t=p.type;const cls=t.replace(/[-]/g,'-');
    h+='<tr><td><strong>'+p.name+'</strong></td>';
    h+='<td><span class="tag '+cls+'">'+t+'</span></td>';
    h+='<td>'+p.events+'</td>';
    h+='<td class="'+(p.errors>0?"err":"ok")+'">'+p.errors+'</td>';
    h+='<td>'+(p.lastEvent||'—')+'</td>';
    h+='<td>'+new Date(p.loadedAt).toLocaleTimeString()+'</td></tr>';
  }
  h+='</table>';
  const hk=Object.entries(d.handlers||{});
  const fk=Object.entries(d.filters||{});
  if(hk.length||fk.length){
    h+='<div class="hook"><h3>Handlers</h3><div class="hook-list">';
    for(const[k,v]of hk)h+='<div class="hook-item">'+k+'<span class="count">×'+v+'</span></div>';
    h+='</div></div>';
    if(fk.length){h+='<div class="hook"><h3>Filters</h3><div class="hook-list">';
    for(const[k,v]of fk)h+='<div class="hook-item">'+k+'<span class="count">×'+v+'</span></div>';
    h+='</div></div>';}
  }
  document.getElementById('app').innerHTML=h;
}
load();setInterval(load,3000);
</script></body></html>`));
  } catch (err) {
    console.error("[plugins] failed to init:", err);
  }

  const wsHandler = {
    open: (ws: any) => {
      if (ws.data.mode === "pty") return;
      engine.handleOpen(ws);
    },
    message: (ws: any, msg: any) => {
      if (ws.data.mode === "pty") { handlePtyMessage(ws, msg); return; }
      engine.handleMessage(ws, msg);
    },
    close: (ws: any) => {
      if (ws.data.mode === "pty") { handlePtyClose(ws); return; }
      engine.handleClose(ws);
    },
  };

  const fetchHandler = (req: Request, server: any) => {
    const url = new URL(req.url);
    if (url.pathname === "/ws/pty") {
      if (server.upgrade(req, { data: { target: null, previewTargets: new Set(), mode: "pty" } as WSData })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/ws") {
      if (server.upgrade(req, { data: { target: null, previewTargets: new Set() } as WSData })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req, { server });
  };

  // HTTP server (always)
  // Security: bind to localhost unless peers are configured (federation needs network access)
  const config = loadConfig();
  const hasPeers = (config.peers?.length ?? 0) > 0 || (config.namedPeers?.length ?? 0) > 0;
  const hostname = hasPeers ? "0.0.0.0" : "127.0.0.1";

  if (hasPeers && !config.federationToken) {
    console.warn(`\x1b[31m⚠ WARNING: peers configured but no federationToken set!\x1b[0m`);
    console.warn(`\x1b[31m  Port ${port} is exposed to network WITHOUT authentication.\x1b[0m`);
    console.warn(`\x1b[31m  Add "federationToken" (min 16 chars) to maw.config.json\x1b[0m`);
  }

  const server = Bun.serve({ port, hostname, fetch: fetchHandler, websocket: wsHandler });
  console.log(`maw ${VERSION} serve → ${HTTP_URL} (${WS_URL}) [${hostname}]`);

  // HTTPS server (if TLS configured)
  const tlsCfg = loadConfig().tls;
  if (tlsCfg?.cert && tlsCfg?.key && existsSync(tlsCfg.cert) && existsSync(tlsCfg.key)) {
    const tlsPort = port + 1;
    const tls = { cert: readFileSync(tlsCfg.cert), key: readFileSync(tlsCfg.key) };
    Bun.serve({ port: tlsPort, tls, fetch: fetchHandler, websocket: wsHandler });
    console.log(`maw serve → https://localhost:${tlsPort} (wss://localhost:${tlsPort}/ws) [TLS]`);
  }

  return server;
}

// Auto-start unless imported by CLI (CLI sets MAW_CLI=1)
if (!process.env.MAW_CLI) {
  startServer();
}
