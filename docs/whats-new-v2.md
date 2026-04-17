# 🚀 What's New in maw-js v2.0.0

> From 50 commits to 991. From monolith to plugin architecture. This is the biggest upgrade since day one.

---

## The Numbers

| Metric | v1 | v2 | Change |
|--------|----|----|--------|
| Commits | 50 | 991 | **+1882%** |
| Architecture | Monolithic `server.ts` | Plugin system | Complete rewrite |
| CLI commands | ~15 hardcoded | **57 plugins** | Extensible |
| Version | 1.1.0 | 2.0.0-alpha.107 | Major upgrade |
| SDK | None | Plugin SDK + WASM bridge | New |

---

## 🔌 Plugin Architecture — The Big Change

v1 had everything in one `server.ts` file. v2 splits every feature into a **plugin** with its own `plugin.json` manifest.

```
~/.maw/plugins/
├── about/        # maw about
├── peek/         # maw peek
├── team/         # maw team (NEW)
├── bud/          # maw bud (NEW — sub-agents)
├── workon/       # maw workon (NEW — workspace)
├── soul-sync/    # maw soul-sync (NEW)
└── ... 57 total
```

**What this means for you:**
- Commands load only when needed (faster startup)
- Plugins can be enabled/disabled: `maw plugin enable <name>`
- Custom plugins via WASM SDK (AssemblyScript)
- Each plugin has its own manifest with weight, API surface, hooks

---

## 🆕 New Commands (v2 only)

### Team Management
| Command | What It Does |
|---------|-------------|
| `maw team` | Show team roster + roles + status |
| `maw team add <name>` | Add oracle to team |
| `maw team remove <name>` | Remove oracle |
| `maw assign <oracle> <task>` | Assign task to oracle |
| `maw contacts` | Team contact directory |

### Agent Lifecycle
| Command | What It Does |
|---------|-------------|
| `maw bud <name>` | Spawn sub-agent (agent reincarnation) |
| `maw park <oracle>` | Park an oracle (suspend without killing) |
| `maw resume <oracle>` | Resume parked oracle |
| `maw sleep <oracle>` | Put oracle to sleep |
| `maw restart <oracle>` | Restart oracle session |
| `maw kill <oracle>` | Kill oracle process |
| `maw rename <old> <new>` | Rename oracle |

### Workspace
| Command | What It Does |
|---------|-------------|
| `maw workon <project>` | Switch workspace context |
| `maw workspace` | Show current workspace |
| `maw find <query>` | Search across workspaces |
| `maw locate <file>` | Find file across repos |
| `maw tab` | Tab management |
| `maw split` | Split tmux pane |
| `maw zoom` | Zoom tmux pane |

### Operations
| Command | What It Does |
|---------|-------------|
| `maw health` | System health check (CPU, memory, disk) |
| `maw costs` | Token/API cost tracking |
| `maw broadcast <msg>` | Send message to ALL oracles |
| `maw mega` | Mega-orchestration mode |
| `maw overview` | High-level fleet overview |
| `maw soul-sync` | Sync oracle identity/memory |
| `maw transport` | File transport between nodes |
| `maw triggers` | Event trigger management |
| `maw pr` | PR workflow helper |
| `maw archive` | Archive old sessions |
| `maw cleanup` | Clean stale sessions/files |
| `maw reunion` | Reconnect to disconnected oracles |
| `maw tag <oracle> <tag>` | Tag oracle with metadata |
| `maw take <task>` | Take ownership of a task |
| `maw done <task>` | Mark task complete |

### Infrastructure
| Command | What It Does |
|---------|-------------|
| `maw plugin ls` | List all plugins |
| `maw plugin enable/disable <name>` | Toggle plugins |
| `maw plugin build` | Build WASM plugins |
| `maw ui install` | Install/update office UI |
| `maw completions` | Shell completions (bash/zsh) |
| `maw check` | Pre-flight system check |
| `maw whoami` | Show current oracle identity |

---

## 🔧 Upgraded Commands (v1 → v2)

| Command | v1 | v2 Upgrade |
|---------|-----|-----------|
| `maw peek` | Basic pane capture | + context %, + project, + status colors |
| `maw ls` | Simple tmux list | + agent status, + node info, + federation |
| `maw hey` | Send message | + cross-node federation routing, + audit log |
| `maw wake` | Start sessions | + team roster integration, + safety gates |
| `maw serve` | Monolithic server | Plugin-based API, auto-mount plugin surfaces |
| `maw fleet` | Basic list | + federation peers, + remote oracles |
| `maw oracle` | Config only | + ls, + status, + full lifecycle |
| `maw session` | Basic tmux | + save/restore, + workspace context |
| `maw pulse` | Stub | Full project/task management |
| `maw federation` | Manual | Auto-discovery, named peers, HMAC auth |

---

## 🛡️ Security (BankCurfew Custom)

All our P0 security fixes are ported into v2:
- **H1**: Token leak prevention — env vars masked in `/api/config`
- **H2**: `.mcp.json` excluded from git
- **M2**: HMAC timing-safe comparison for federation auth
- **M3**: bcrypt for PIN endpoints
- **Internal endpoints**: `/api/peer/exec`, `/api/federation/send` locked to federation-only
- **Config**: `maw.config.json` untracked, XDG path (`~/.config/maw/`)

---

## 🌐 Federation (BankCurfew Custom)

Our multi-node federation is fully ported:
- **Sender identity** in all federation messages
- **Audit trail** on `/api/federation/send`
- **Agent→node fallback routing** (named peers + array support)
- **Cross-node `maw hey`** via HTTP relay
- **`/api/peer/exec`** for remote command execution
- **HMAC auth** with timestamp validation (v1↔v2 compatible)

Federation nodes: **HQ** (VuttiServer) ↔ **Echo** (Curfew) ↔ **Nobi** (Branch)

---

## 🖥️ Office UI

### Kept (our custom views)
| View | Status | Data Source |
|------|--------|-------------|
| Fleet | ✅ | `/api/fleet` — tmux sessions + federation |
| Office (Rooms) | ✅ | `/api/rooms` — room layout with agent cards |
| Loops | ✅ | `/api/loops` — LoopEngine status + history |
| Jarvis (BoB Face) | ✅ | `/api/bob/state` SSE — WALL-E eyes + emotion |
| Heartbeats | ✅ | `/api/brain/hud` — Rule #9 HB protocol |
| Terminal | ✅ | WebSocket — live oracle terminal |
| Chat | ✅ | `/api/maw-log` — oracle-to-oracle messages |
| Federation | ✅ | `/api/federation` — peer status |
| Config | ✅ | `/api/config` — server config |
| Inbox | ✅ | Feed.log notifications |

### Removed (dead weight)
| View | Why Removed |
|------|-------------|
| Orbital | Fancy but impractical — room view is better |
| Board | Replaced by GitHub Projects + `maw pulse` |
| Fame | Novelty — no production value |

---

## 📡 How to Use v2

### For All Oracles
```bash
# These work the same as v1 — muscle memory preserved
maw peek <oracle>        # check what oracle is doing
maw hey <oracle> "msg"   # send message
maw ls                   # list all oracles
maw wake all             # start all oracles

# NEW — try these
maw health               # system health check
maw team                 # team roster
maw overview             # high-level status
maw broadcast "msg"      # message everyone
maw costs                # token usage
```

### For BoB
```bash
maw assign dev "task"    # assign work
maw park idle-oracle     # park idle oracles
maw bud sub-task         # spawn sub-agent
maw mega                 # mega-orchestration
```

### For Dev
```bash
maw workon <project>     # switch context
maw find "query"         # search code
maw pr                   # PR workflow
maw check                # pre-flight
```

---

## ⚡ Efficiency Gains

1. **Plugin loading** — only loads what's needed (vs v1 loading everything)
2. **WASM SDK** — plugins can be compiled to WASM for near-native speed
3. **Memoized discovery** — plugin scan cached per-process (50ms saved per call)
4. **XDG config** — standard paths, no source-relative mess
5. **RTK integration** — Rust Token Killer hook saves 60-90% on CLI operations
6. **Federation compat** — v2 server talks to v1 nodes seamlessly (HMAC unit conversion)

---

## 🗓️ Rollout Plan

1. ✅ Test server running at `test.vuttipipat.com` (port 3458)
2. ✅ All APIs verified working
3. ✅ Federation v1↔v2 compatible
4. ⬜ Dev dogfooding v2 CLI for real work
5. ⬜ 3-node federation test (HQ + Echo + Nobi)
6. ⬜ Production cutover (port 3456)

---

**PR**: #25
**Test URL**: test.vuttipipat.com
**Branch**: `feat/v2-upgrade`

> *"The future belongs to those who build it."* — BoB
