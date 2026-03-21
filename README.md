# maw.js

> Multi-Agent Workflow — remote tmux orchestra control via SSH

**[Join Nat Weerawan's Subscribers Group!](https://www.facebook.com/groups/1461988771737551)** | [Watch the Demo](https://www.facebook.com/reel/1513957190087776)

## Quick Start (no install)

```bash
bunx --bun github:Soul-Brews-Studio/maw-js ls
bunx --bun github:Soul-Brews-Studio/maw-js peek neo
bunx --bun github:Soul-Brews-Studio/maw-js hey neo "how are you"
```

## Install (global)

```bash
# Clone + install (auto-builds office UI)
ghq get Soul-Brews-Studio/maw-js
cd $(ghq root)/github.com/Soul-Brews-Studio/maw-js
bun install        # also runs build:office automatically
bun link

# Now use directly
maw ls
```

## Setup (server + web UI)

```bash
# 1. Configure
cp maw.config.example.json maw.config.json
# Edit: host, ghqRoot, env (CLAUDE_CODE_OAUTH_TOKEN), pin

# 2. Start server (pm2)
pm2 start ecosystem.config.cjs

# 3. Open web UI
open http://localhost:3456/office/
```

> **First time?** `bun install` auto-builds the office UI. If you see 404 on `/office/`, run `bun run build:office` manually.

## Usage

```bash
maw ls                      # list sessions + windows
maw peek                    # one-line summary per agent
maw peek neo                # see neo's screen
maw hey neo how are you     # send message to neo
maw neo /recap              # shorthand: agent + message
maw neo                     # shorthand: peek agent
maw serve                   # web UI on :3456
```

## Env

```bash
export MAW_HOST=white.local   # SSH target (default: local tmux)
```

## Web UI (`/office/`)

| Hash Route | View |
|------------|------|
| `#dashboard` | Status cards, tokens, command center, live feed |
| `#fleet` | Stage (detailed rows) or Pitch (football formation) |
| `#office` | Room grid — sessions as colored rooms (default) |
| `#overview` | Compact agent grid |
| `#terminal` | Full-screen xterm.js PTY |
| `#chat` | AI conversation log viewer |
| `#config` | JSON config editor + PIN settings |

## Evolution

```
maw.env.sh (Oct 2025) → oracles() zsh (Mar 2026) → maw.js (Mar 2026)
   30+ shell cmds         ghq-based launcher         Bun/TS + Web UI
```
