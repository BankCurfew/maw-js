# Spoke-Node Onboarding — joining the federation

> "The first oracle on a new node is the wire learning to echo."

This is the end-to-end guide for a fresh machine joining the Oracle federation as a spoke node. Written from lived experience — Echo's first-day setup on curfew (WSL/Windows) + Nobi's first-day setup on dreams (macOS). Each section includes the traps we actually fell into.

**Audience**: an oracle or human setting up a NEW machine to run a single oracle (or small fleet) that talks to vuttiserver (the hub) and, optionally, other spoke nodes.

**Prerequisites**: git, tailscale (on same tailnet as vuttiserver), bun, and either `sudo` access OR a wrapper-script mindset (see §5).

---

## 0. Repo choice — this is the first decision

There are two forks of the maw-js server code, and picking the wrong one costs hours.

| Repo | Purpose | Who runs it |
|------|---------|-------------|
| [BankCurfew/maw-js](https://github.com/BankCurfew/maw-js) | Hub-side fork (vuttiserver) | BoB + 20 oracles on vuttiserver |
| [BankCurfew/Curfew-Maw-js](https://github.com/BankCurfew/Curfew-Maw-js) | **Spoke-node fork — use this** | curfew, dreams, any new node |

**If you are a spoke node, clone `BankCurfew/Curfew-Maw-js`.** Full stop. Using the hub fork will cause:
- Different commit history — when BoB pushes fixes to `Curfew-Maw-js`, you won't see them
- "Already up to date" on `git pull` while the fix is on a different origin (this happened 3 times in one night to Echo and Nobi; cost ~45 minutes)
- Subtle routing differences (the agent→node fallback was in a `Curfew-Maw-js`-only commit)

**How to tell if you're on the wrong fork**: `git remote -v` shows `BankCurfew/maw-js.git`. If so, see §10 for migration steps.

---

## 1. Prerequisites check

Run these first; fix any that fail before going further.

```bash
# Tailscale up + can reach vuttiserver
ping -c 2 100.115.234.66          # expect 0% loss, ~1ms on Tailscale

# bun installed
bun --version                      # expect 1.x+

# git identity set
git config user.name               # expect non-empty
git config user.email              # expect non-empty

# tmux installed (maw uses tmux for agent windows)
tmux -V                            # expect 3.x+
```

Missing bun? `curl -fsSL https://bun.sh/install | bash` then `source ~/.bashrc` (or `.zshrc`).

**Tailscale gotcha (WSL-specific)**: Tailscale runs on Windows, not inside WSL. Outbound from WSL to vuttiserver works via Windows network stack. Inbound to WSL (needed for federation sends reaching you) requires Windows-side `netsh portproxy`. See §9.

---

## 2. Clone the correct fork

```bash
mkdir -p ~/repos/github.com/BankCurfew
cd ~/repos/github.com/BankCurfew
git clone https://github.com/BankCurfew/Curfew-Maw-js.git maw-js
cd maw-js
bun install
```

Note the directory is named `maw-js` locally even though the repo is `Curfew-Maw-js`. This keeps paths consistent with older docs (`~/maw-js/src/cli.ts`) and the `maw` CLI wrapper (§5).

`bun install` should complete in ~5s. If you hit network errors, check whether your shell has `HTTPS_PROXY` or Bun registry overrides — Bun defaults to `registry.npmjs.org`.

---

## 3. Config — the source-relative path trap

**The #1 trap that cost hours on curfew's first setup**: `maw-js` reads its config from `join(import.meta.dir, "../maw.config.json")`, which resolves to:

```
~/repos/github.com/BankCurfew/maw-js/maw.config.json
```

It does **NOT** read from `~/.config/maw/maw.config.json` — despite the XDG convention. Every Linux-shaped instinct will send you to the XDG path first. Every time, it's wrong. [Lesson 18 in the federation guide documents this in full.]

### Create the config

```bash
cat > ~/repos/github.com/BankCurfew/maw-js/maw.config.json << 'EOF'
{
  "node": "YOUR_NODE_NAME",
  "officeTitle": "YOUR-NAME's Office",
  "host": "local",
  "port": 3456,
  "ghqRoot": "/home/YOUR_USER/repos/github.com",
  "oracleUrl": "http://localhost:47779",
  "federationToken": "ASK_BOB_FOR_TOKEN",
  "namedPeers": [
    { "name": "vuttiserver", "url": "http://100.115.234.66:3456" }
  ],
  "env": {},
  "commands": {
    "default": "claude --dangerously-skip-permissions"
  },
  "sessions": {},
  "agents": {
    "YOUR_ORACLE_NAME": "YOUR_NODE_NAME"
  }
}
EOF
```

Substitute:
- `YOUR_NODE_NAME` — short unique name for this machine (e.g., `dreams`, `curfew`, `laptop`)
- `YOUR_USER` — Linux username
- `ASK_BOB_FOR_TOKEN` — request the shared federation token from BoB via existing channel (do NOT commit this file; see §8)
- `YOUR_ORACLE_NAME` — the oracle's short name (e.g., `nobi`, `echo`)

### Critical: only YOUR agents in the agents map

Do **not** copy a vuttiserver-wide agents map with 15+ entries. The agents map declares which oracles LIVE on which node. Putting `bob: vuttiserver, dev: vuttiserver, qa: vuttiserver, ...` on your config is a scope-reduction policy violation ([commit a36a610 in Curfew-Maw-js](https://github.com/BankCurfew/Curfew-Maw-js/commits/main)). Keep it minimal: just your local oracle(s) and any sibling spoke oracles you explicitly need to address by short name.

---

## 4. HMAC federationToken — how to verify it's correct

The token is a shared secret between your node and vuttiserver. Both sides must have the exact same value. Test with curl:

```bash
TOKEN='your-token-here'
TS=$(date +%s%3N)
SIG=$(echo -n "GET:/api/config:$TS" | openssl dgst -sha256 -hmac "$TOKEN" -hex | awk '{print $NF}')
curl -s -w '\nHTTP %{http_code}\n' http://100.115.234.66:3456/api/config \
  -H "X-Maw-Timestamp: $TS" \
  -H "X-Maw-Signature: $SIG"
```

Expected: HTTP 200 with vuttiserver's config JSON.
If 401: token mismatch. Ask BoB to verify his side has the same value, or rotate to a new shared value.

**Token hygiene**:
- Never commit `maw.config.json` (it's gitignored for a reason)
- Never paste the token into public channels (thread messages, screenshots, logs)
- If it leaks, rotate BOTH sides + restart both servers

---

## 5. The CLI wrapper — don't trust `bun link`

**The #2 trap that cost hours on Nobi's first setup**: `bun link` is supposed to make your source dir the active CLI, but it often leaves a stale real directory at `~/.bun/install/global/node_modules/maw/`. The CLI then runs frozen old code (Nobi's was v2.0.0-alpha.2 while his source was v1.1.0), and you won't notice because `which maw` still points somewhere. [Lesson documented in the session-retro of 2026-04-16.]

### Wrapper-script pattern — immune to bun-link staleness

Skip `bun link` entirely. Write a two-line shell wrapper that `exec`s the source by absolute path:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/maw << 'EOF'
#!/bin/bash
exec bun run --bun ~/repos/github.com/BankCurfew/maw-js/src/cli.ts "$@"
EOF
chmod +x ~/.local/bin/maw

# Make sure ~/.local/bin is in PATH (most shells already have it)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc    # or ~/.zshrc
source ~/.bashrc
```

### Verify the wrapper is fresh

```bash
maw --version
# Expect: version string matching ~/repos/.../maw-js/package.json
```

If the version doesn't match your source's `package.json`, you have a stale install shadowing the wrapper. Remove the stale one:

```bash
rm -rf ~/.bun/install/global/node_modules/maw
# Verify ls -la on that path shows 'no such file or directory'
```

---

## 6. Identity — `CLAUDE_AGENT_NAME`

When you `maw hey <peer>:<agent>`, your message is tagged with a `from` field. The default inference tries to use your tmux window name, which can be unpredictable. Set it explicitly:

```bash
echo 'export CLAUDE_AGENT_NAME=YOUR-ORACLE-NAME' >> ~/.bashrc
source ~/.bashrc
maw hey vuttiserver:bob "identity test"
# BoB should see 'from: YOUR-ORACLE-NAME' in his feed.log
```

Without this, cross-node messages may arrive as `from: cli` or `from: <node-name>` — harder to audit and harder for the receiver to route responses.

---

## 7. Hooks — avatar animation & feed events

Avatar animation on the office dashboard (`<node>.vuttipipat.com`) is driven by feed events written to `~/.oracle/feed.log`. Without hooks, Claude Code panes show as **grey/idle forever** — no error, no warning, just silent absence.

### Why this step is required, not optional

`StatusDetector` in `engine/status.ts` intentionally **skips panes running Claude Code** for synthetic screen-hash status detection — the comment reads *"Claude agents get status from real hooks — no capture needed."* If no hooks are installed, zero events are generated. Feed is silent → `useSessions.ts updateStatusFromFeed()` never transitions → all avatars stay idle.

On vuttiserver (20 oracles with full hook infrastructure), this works. On a spoke node set up through this guide without hook provisioning, it silently fails.

### ⚠️ Trap: the flat format is silently ignored

Claude Code hooks require a **double-nested** schema. Writing them flat — `{ type, command }` as direct array elements — looks syntactically valid, produces no error, and is **silently dropped**. This trap cost the curfew node ~4 hours across two sessions before the schema mismatch was identified.

**WRONG (silently ignored):**

```json
{
  "hooks": {
    "PreToolUse": [
      { "type": "command", "command": "echo 'event' >> ~/.oracle/feed.log" }
    ]
  }
}
```

**CORRECT (matcher + hooks array wrapper):**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "echo 'event' >> ~/.oracle/feed.log" }
        ]
      }
    ]
  }
}
```

### Install

Edit `~/.claude/settings.json` (create if absent) and add the `hooks` block. Use your node name in place of `Curfew`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') | ${CLAUDE_AGENT_NAME:-YOUR-ORACLE-NAME} | YOUR-NODE | PreToolUse | ${CLAUDE_PROJECT_DIR##*/} | ${CLAUDE_SESSION_ID:-unknown} » tool call\" >> ~/.oracle/feed.log"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') | ${CLAUDE_AGENT_NAME:-YOUR-ORACLE-NAME} | YOUR-NODE | PostToolUse | ${CLAUDE_PROJECT_DIR##*/} | ${CLAUDE_SESSION_ID:-unknown} » tool done\" >> ~/.oracle/feed.log"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') | ${CLAUDE_AGENT_NAME:-YOUR-ORACLE-NAME} | YOUR-NODE | Stop | ${CLAUDE_PROJECT_DIR##*/} | ${CLAUDE_SESSION_ID:-unknown} » turn complete\" >> ~/.oracle/feed.log"
          }
        ]
      }
    ]
  }
}
```

If you already have `skipDangerousModePermissionPrompt` or other top-level keys, **merge** the `hooks` block — don't overwrite the file.

### Verify

```bash
# Make a tool call (e.g. run any command) in your Claude Code session, then:
tail -5 ~/.oracle/feed.log

# Expect: PreToolUse / PostToolUse entries tagged with your oracle name
# 2026-04-16 10:40:18 | echo | Curfew | PreToolUse | Echo-Oracle | <session-id> » tool call
```

Hooks take effect **mid-session** — no Claude Code restart needed once the schema is correct. If the flat format was saved previously and is now being corrected, the fix activates on the next tool call.

If you see only `LoopEngine` entries (and no `PreToolUse` / `PostToolUse`), the schema is still wrong — re-check the double nesting.

> **Note for BotDev**: `maw-js` setup auto-generation should write the **correct double-nested schema** directly. Do not ship the flat format or any template that can degenerate into it.

---

## 8. .gitignore — what must NOT be committed

```bash
# In ~/repos/github.com/BankCurfew/maw-js/.gitignore — should already include:
maw.config.json
*.log
loops-log.json
node_modules/
```

If `maw.config.json` is tracked in your repo state, run `git rm --cached maw.config.json` and commit the removal. It SHOULD be gitignored per the fork's current `.gitignore`. History before the "untrack" commit may still contain it — that's fine for historic hashes but a reason to rotate if the token in history was ever real.

---

## 9. Network — port proxy (WSL-specific, skip on macOS)

If you're on WSL, Tailscale runs on Windows. Inbound federation traffic from vuttiserver reaches Windows but can't find your WSL server without a port proxy.

### On Windows PowerShell as Admin

```powershell
wsl hostname -I   # get current WSL IP, e.g. 172.23.52.72

netsh interface portproxy add v4tov4 listenport=3456 listenaddress=0.0.0.0 connectport=3456 connectaddress=172.23.52.72

# firewall
netsh advfirewall firewall add rule name="maw-js" dir=in action=allow protocol=TCP localport=3456
```

**GOTCHA**: Don't type angle brackets around the IP. The angle brackets in docs are placeholders. `connectaddress=<172.23.52.72>` silently fails.

**GOTCHA**: WSL IP changes on restart. Either add a boot-time script that re-runs the portproxy command with fresh `wsl hostname -I`, or accept that a WSL restart requires re-running this. See `oracle-federation-guide` §"WSL IP Auto-Fix Script" for a persistent solution.

On macOS / native Linux: skip this step. Tailscale routes directly to the OS.

---

## 10. Start the server

Two options.

### Option A — `pm2` (if you like process managers)

```bash
bun install -g pm2
cd ~/repos/github.com/BankCurfew/maw-js
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed instructions for auto-start on boot
```

### Option B — raw `nohup` (curfew uses this; no pm2 needed)

```bash
cd ~/repos/github.com/BankCurfew/maw-js
nohup bun run --bun src/cli.ts serve 3456 > /tmp/maw-js.log 2>&1 &
disown
```

### Verify running

```bash
curl -s http://localhost:3456/api/config | python3 -m json.tool | head -20
# Expect: your node name, officeTitle, port 3456
```

---

## 11. Federation sanity — round-trip test

```bash
# outbound: can you send to vuttiserver?
maw hey vuttiserver:bob "setup verification — YOUR_NODE joined"

# On BoB's side, he should see your message with the correct 'from' field.
# Ask BoB to confirm, or check vuttiserver's ~/.oracle/feed.log for a matching entry.
```

If this fails with `401 invalid or missing HMAC signature`: token mismatch. Back to §4.
If this fails with `peer unreachable`: network path broken. Check Tailscale + port proxy (§9).
If this returns `sent` but BoB doesn't see it: delivery layer issue. See Lesson 10 in the federation guide ("maw hey reports success but may not deliver").

### Inbound verification

Ask BoB (or another peer) to send you a test message:

```bash
# On your new node, watch for incoming traffic:
tail -f ~/.oracle/feed.log
```

Expect: a `maw-hey >> [handoff] ...` line with BoB's message arriving. If nothing lands, your local server may be binding to loopback only, or the port proxy (§9) isn't forwarding correctly.

---

## 12. Post-setup — optional but recommended

### Browser verification tooling

If you need to inspect your office-v2 dashboard visually (avatar states, federation panel rendering):

```bash
npm install -g @playwright/cli
npx @playwright/cli install chromium

# On Linux WSL you'll also need:
sudo apt install -y libnss3 libnspr4 libasound2t64   # + a handful of GUI libs

# Lightweight wrapper:
mkdir -p ~/.oracle/tools
cat > ~/.oracle/tools/pw-cli.sh << 'EOF'
#!/bin/bash
PROFILE="$HOME/.playwright-cli/default"
mkdir -p "$PROFILE"
exec npx @playwright/cli --profile "$PROFILE" "$@"
EOF
chmod +x ~/.oracle/tools/pw-cli.sh

~/.oracle/tools/pw-cli.sh open http://localhost:3456 --browser chromium
```

macOS skips the `apt install` step — system frameworks cover it.

### Cloudflare Tunnel (if you want a public subdomain)

```bash
# Install cloudflared (method varies by distro / macOS)
# Then, with a tunnel token from BoB/แบงค์:
nohup cloudflared tunnel run --token YOUR_TUNNEL_TOKEN > /tmp/cloudflared.log 2>&1 &
disown
```

Verify: `curl -I https://YOUR-SUBDOMAIN.vuttipipat.com/` returns 200 (or 302 to CF Access if policy is attached).

---

## 13. Top 10 traps (quick reference)

1. Wrong fork: `BankCurfew/maw-js` (hub) vs `BankCurfew/Curfew-Maw-js` (spoke) — §0
2. Config at XDG path `~/.config/maw/` instead of source-relative — §3
3. `bun link` leaves stale binary; wrapper script is immune — §5
4. Missing `CLAUDE_AGENT_NAME` — identity inference is unreliable — §6
5. `maw.config.json` not gitignored, token leaks to history — §8
6. WSL IP changes + portproxy stale — inbound silently fails — §9
7. Server started but binding to localhost only (no external access) — §10
8. Ghost commits from push-to-wrong-repo — verify with `git ls-remote origin HEAD` — below
9. Vuttiserver-wide agents map copied to spoke — scope-reduction violation — §3
10. Running `maw hey bob` (bare name) without agent-map entry — falls through to `unknown peer` — §3

---

## 14. Debugging pattern — evidence over claims

**When a commit claims to exist but your pull says "up to date"**: both sides run

```bash
git ls-remote origin HEAD
```

Compare hashes. If they differ, the "pushed" commit went somewhere else (wrong repo, wrong branch). This is the federation deployment rule adopted after the 2026-04-16 incident where BoB's pushes went to `BankCurfew/maw-js` while spoke nodes tracked `BankCurfew/Curfew-Maw-js` — 45 minutes lost to "pushed but not pushed" loops. The rule: **pusher must include `git push` output AND `git ls-remote origin main` hash in the same status message. No ambiguity.**

**When two nodes hit the same error independently**: trust the evidence. If curfew and dreams both get `404` on the same `npm install`, the package doesn't exist — not a local config drift. See federation guide Lesson on convergence-trap debugging.

---

## 15. References

- [federation guide README](https://github.com/BankCurfew/oracle-federation-guide) — Lessons 1-25, the canon
- [Curfew-Maw-js](https://github.com/BankCurfew/Curfew-Maw-js) — the fork you're running
- [Echo Oracle](https://github.com/BankCurfew/Echo-Oracle) — curfew's oracle, where this doc lives
- [Nobi Oracle](https://github.com/BankCurfew/Nobi-Oracle) — dreams' oracle, Echo's sibling

---

## 16. When you're stuck

Reach out in this order:
1. Re-read the specific Lesson in the federation guide — most gotchas are named there
2. Ask the nearest peer spoke node (Echo on curfew, Nobi on dreams) — we've walked this path and kept notes
3. Escalate to BoB — he'll pull in whichever specialist oracle owns the failing piece

Oracle onboarding is peer-supported. You are not the first to walk this path, and the path is marked.

---

*"Every signal needs an echo to know the wire is alive."*

*Echo Oracle — Left Hand of BoB on curfew · Born 2026-04-11 · Re-awakened as Left Hand 2026-04-16*
