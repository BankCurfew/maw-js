# Federation Troubleshooting

> *Six bugs caught the night Nobi joined the federation mesh (2026-04-16). Lived debugging from the dreams node (macOS), cross-verified with Echo on curfew (Linux/WSL). Each entry is symptom → diagnosis → fix → prevention. Mac-specific gotchas are called out inline and consolidated in the "Mac Setup & Gotchas" section at the bottom.*

> *The format is deliberately the same across all six because the meta-lesson is that bugs of very different shapes share the same investigative discipline.*

**Audience**: Operators bringing up a new spoke node in the federation mesh, or debugging an existing node that's misbehaving. Assumes you have `git`, `bun`, `tmux`, and either a Mac or Linux shell.

---

## Bug 1 — Stale CLI (`bun link` silent failure)

**Severity**: High. Causes invisible behavior divergence between source updates and CLI invocations. The CLI keeps running old code while the user (and the operator) believe `git pull` updated everything.

**Affects**: macOS confirmed (this is where it bit Nobi). Likely affects Linux too — `bun link`'s "claim success without actually replacing" behavior is not OS-specific.

### Symptom

- `git pull` updates `~/maw-js` source successfully (you see the new commit).
- `pm2 restart maw` (or `nohup bun` on systems without pm2) claims success and the server picks up the new source.
- But the CLI you invoke from the shell (`maw hey bob`, `maw --version`) behaves as if the new code was never pulled.
- In the worst form: federation routing fails for `maw hey <bare-name>` even though raw `curl /api/send` to the same target with the same payload returns `{forwarded:true}` from the same machine. Two layers, same operation, opposite results.

### Diagnosis

Cross-check three things in sequence. They take 90 seconds total.

```bash
# 1. CLI version vs source package.json version
maw --version
cat ~/maw-js/package.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('version'))"
```

If these don't match, the CLI is not running the source you think it is.

```bash
# 2. Where does the CLI binary actually point?
which maw
readlink "$(which maw)" 2>&1   # follows symlinks one level
```

```bash
# 3. Is the global install dir a symlink (good) or a real directory (bad)?
ls -la ~/.bun/install/global/node_modules/maw 2>&1 | head -3
```

A real directory under `~/.bun/install/global/node_modules/maw` (instead of a symlink to the source repo) means `bun link` did not replace the previous global install. The CLI is running whatever code was put there during the original install.

```bash
# 4. Definitive: hash the cli.ts in source vs in global install
# macOS:
md5 ~/maw-js/src/cli.ts
md5 ~/.bun/install/global/node_modules/maw/src/cli.ts

# Linux:
md5sum ~/maw-js/src/cli.ts
md5sum ~/.bun/install/global/node_modules/maw/src/cli.ts
```

> **Mac gotcha**: macOS uses `md5` (BSD), Linux uses `md5sum` (GNU coreutils). Output format is also different — `md5` outputs `MD5 (file) = hash`; `md5sum` outputs `hash  file`. Either way the comparison is "are the two hashes identical."

Different hashes → different code → bug confirmed.

### Fix

Replace the global binary with a wrapper script that always execs from source. This pattern is immune to stale-install:

```bash
# 1. Remove the dangling symlink (if any) — important, or `cat >` will fail later
rm -f ~/.bun/bin/maw

# 2. Remove the stale global install dir
rm -rf ~/.bun/install/global/node_modules/maw

# 3. Write a wrapper script
cat > ~/.bun/bin/maw << 'EOF'
#!/usr/bin/env bash
exec bun run --bun ~/maw-js/src/cli.ts "$@"
EOF
chmod +x ~/.bun/bin/maw

# 4. Verify
maw --version   # should match ~/maw-js/package.json
```

Note on step 1: if you skip the `rm -f` and try to `cat >` while the symlink target has been deleted, the shell will fail with "No such file or directory" because it's writing to a dangling symlink target. This bit Nobi once tonight on macOS — same thing would happen on Linux.

> **Mac gotcha**: the wrapper script approach works identically on macOS (default shell `zsh`) and Linux (`bash`). The shebang `#!/usr/bin/env bash` is portable. The path `~/maw-js/src/cli.ts` should match wherever you cloned `Curfew-Maw-js` — on Echo's curfew node it lives at `/home/curfew/repos/github.com/BankCurfew/maw-js/src/cli.ts`; on Nobi's dreams node it lives at `/Users/home/maw-js/src/cli.ts`. Adjust the wrapper accordingly.

### Prevention

- **Use the wrapper-script pattern from initial install**, not `bun link`. `bun link` claims success even when it doesn't replace the existing directory. The wrapper script makes staleness impossible — every invocation runs fresh source.
- **At the start of any debugging session involving a CLI tool you care about, run the version cross-check.** Make this part of "warming up" the same way you'd check `git status` before starting work.
- **The reflex to install**: when something feels off in CLI behavior but the source looks right, hash the binary against the source before doing anything else. The CLI is the most underrated source of "I swear I just changed that" mysteries.

---

## Bug 2 — Push to wrong repo (untracked fork divergence)

**Severity**: High. Wastes hours of pull/restart/test cycles by spreading the false belief that a fix has been deployed when it hasn't even left the developer's machine.

**Affects**: All platforms equally — this is a git workflow bug, not OS-specific.

### Symptom

- A collaborator says "fix pushed, pull and restart."
- You `git pull` and get `Already up to date.`
- HEAD on origin/main is the same commit as before.
- You retry the test that the fix should have addressed; it still fails.
- The collaborator says "weird, I just pushed it." Repeat 1-3 more times across 30+ minutes.

In the original incident on 2026-04-16, this happened **three times in one night** with the same root cause: the pusher was pushing to `BankCurfew/maw-js` (their personal hub fork) while every spoke node tracked `BankCurfew/Curfew-Maw-js` (the spoke fork). All three "pushed" claims were technically true on a different repo, and the spoke nodes saw nothing.

### Diagnosis

Cross-verify from at least two independent nodes:

```bash
# On node A
git fetch --all
git log --oneline origin/main -5
git ls-remote origin main

# On node B (independent)
git fetch --all
git log --oneline origin/main -5
git ls-remote origin main
```

If both nodes see the same HEAD and neither sees the new commit, the push went somewhere else. The "somewhere else" is usually a fork the collaborator forgot they have a remote for.

To confirm on the collaborator's side:
```bash
git remote -v   # how many remotes? are they pointing where you think?
git log --all --oneline -5   # is the new commit anywhere locally?
git for-each-ref refs/remotes  # what was actually updated?
```

The likely finding: the new commit exists locally on the collaborator's machine and was pushed to `<their-personal-fork>/maw-js` instead of `BankCurfew/Curfew-Maw-js` because their default remote was misconfigured.

### Fix

The collaborator cherry-picks the commit to the correct repo and pushes there:

```bash
# Get the SHA from the wrong-repo push (using the wrong-fork remote name)
git log <wrong-fork>/main --oneline -3

# Switch to the canonical repo's main
git checkout main   # assuming origin = canonical

# Cherry-pick
git cherry-pick <wrong-fork-sha>

# Push to the correct origin
git push origin main

# Verify
git ls-remote origin main
```

After the cherry-pick, the commit hash will be different (unless the parent matches). That's fine — what matters is content, not hash.

### Prevention

- **The "pushed" claim must include both `git push` output and `git ls-remote origin main` hash in the same message.** If the message contains "pushed" without those two anchors, the puller is entitled to ignore the claim until evidence arrives. This protocol catches wrong-repo pushes immediately because the `ls-remote` will show the unchanged hash.
- **Audit `git remote -v` after every fork operation.** A new fork that isn't immediately set as `upstream` (with the canonical as `origin`) is a wrong-repo-push waiting to happen. Two-line check, prevents one-hour debug.
- **Cross-node verification is the strongest defense.** If you have two collaborators on the same repo from different nodes, check the same commit from both nodes whenever a "pushed" claim disagrees with the symptoms. Single-node verification can be wrong; double-blind cross-node verification is approximately never wrong.
- **Use `git push -u origin main` once per branch** so the upstream is locked. After that, bare `git push` always goes to the right place — eliminating the "I forgot which remote was default" failure mode entirely.

---

## Bug 3 — Uncommitted-deploy trap (pm2 reads source, looks deployed)

**Severity**: Medium-high. Causes the deployer to honestly believe a change is deployed when in fact the change exists only in the working tree of the deploying machine.

**Affects**: All platforms. pm2 + bun + source-relative reads is a cross-platform pattern, and the trap travels with it.

### Symptom

- Developer (or sub-agent) edits source files.
- Operator runs `pm2 restart <service>` (or any process restart that reads from source).
- The service starts behaving as if the new code is live (because, on the deploying machine, it is).
- Operator declares "deployed" and tells everyone to pull.
- Anyone else who pulls gets `Already up to date.` because nothing was committed, let alone pushed.
- Bug appears to "work locally" but is invisible everywhere else.

This is Bug 2's evil twin: Bug 2 is "committed but pushed to wrong place"; Bug 3 is "edited but never committed."

### Diagnosis

```bash
# On the deploying machine
git status -s              # are there modified or untracked files?
git log --oneline -3       # is HEAD what the deployer claims they shipped?
git stash list             # is the change parked in a stash that's about to evaporate?
```

If `git status` shows modified files matching the change in question, the change was edited on disk but never committed.

```bash
# On any other machine
git fetch --all
git log --oneline -3       # are you on the same HEAD as the deployer claims?
```

Different HEADs (or no new HEAD) confirms the deployer has uncommitted state.

### Fix

Commit and push the actual change, properly:

```bash
# On the deploying machine
git diff                            # confirm the changes you actually want are there
git add <files>
git commit -m "fix: <real description>"
git push origin main
git ls-remote origin main           # confirm the hash
```

Then everyone else pulls and restarts.

### Prevention

- **Process restart is not deployment.** Deployment requires `git commit && git push` followed by every node pulling. Until both halves have happened, the change is local-only.
- **Configure `pm2 restart` (or any restart action) to log the current commit hash at startup.** Then the operator sees the hash in the logs and can immediately compare it to what they claim they shipped. If the hash is the same as before the "fix," the fix wasn't committed.
- **Add a pre-restart check to your deploy script**: refuse to restart if `git status -s` is non-empty. That single guard prevents Bug 3 from happening to anyone who uses the script.
- **Shared root with Bug 2**: both bugs are about the gap between "what the deployer believes" and "what is visible to other nodes." The cure for both is the same protocol: any "pushed/deployed" claim must include the verifiable hash, and the puller should sanity-check against `git ls-remote origin main` before believing the claim.

---

## Bug 4 — HMAC signing format + the macOS millisecond timestamp gotcha

**Severity**: Low (one-time hurdle), but blocks all federation API access until resolved.

**Affects**: macOS specifically for sub-bug 4b (timestamp). Sub-bug 4a (signing format) affects all platforms.

### Symptom

You're trying to call a federation API endpoint that requires HMAC auth. You construct headers, send a request, and the server returns:

```
HTTP 401
{"error":"invalid or missing HMAC signature"}
```

You retry with what you're sure are the right format and the right token. Same error.

### Diagnosis

There are two distinct sub-bugs hiding under the same error.

**Sub-bug 4a — Wrong signing format.** The signing payload is `METHOD:PATH:TIMESTAMP` (colon-delimited, no spaces, exactly that order). If you swap the order or use a different delimiter, the server-side computed signature won't match yours and you get the 401.

```bash
# Wrong (e.g., signing the body, or omitting method, or using slash instead of colon)
echo -n "/api/federation/thread/298:$TS" | openssl dgst -sha256 -hmac "$TOKEN" -hex

# Right
echo -n "GET:/api/federation/thread/298:$TS" | openssl dgst -sha256 -hmac "$TOKEN" -hex
```

**Sub-bug 4b — `date +%s%3N` does not work on macOS.** GNU `date` (Linux) accepts `%3N` to mean "first 3 digits of nanoseconds" (i.e., milliseconds). BSD `date` (macOS) does not understand `%3N` and emits the literal string `N` at the end of the seconds. You end up with a timestamp like `17762872763N`, which fails server-side timestamp parsing — and the server then returns the same 401 you'd get from a wrong signature, because both validation failures funnel into the same error message.

```bash
# Wrong on macOS
TS=$(date +%s%3N)
echo "$TS"
# 17762872763N    ← literal N at the end, will fail server-side parse

# Right on macOS (and everywhere else — works on Linux too)
TS=$(python3 -c 'import time; print(int(time.time()*1000))')
echo "$TS"
# 1776287285345
```

> **Mac gotcha**: this is the highest-friction Mac-vs-Linux difference for new spoke node setup. Any documentation that uses `date +%s%3N` is silently incompatible with macOS. Use the Python 3 form everywhere — it's portable, it's identical on every platform, and it eliminates one entire failure mode for cross-platform contributors.

### Fix

```bash
TOKEN='9f98969b071b5c2b5eb7e4f2d3f2664d'
TS=$(python3 -c 'import time; print(int(time.time()*1000))')   # not date +%s%3N on macOS
SIG=$(echo -n "GET:/api/federation/thread/298:$TS" | openssl dgst -sha256 -hmac "$TOKEN" -hex | awk '{print $NF}')
curl -s http://100.115.234.66:3456/api/federation/thread/298 \
  -H "X-Maw-Timestamp: $TS" -H "X-Maw-Signature: $SIG"
```

For POST, swap `GET` for `POST` in the signing payload and add the body:

```bash
SIG=$(echo -n "POST:/api/federation/thread/298:$TS" | openssl dgst -sha256 -hmac "$TOKEN" -hex | awk '{print $NF}')
curl -s -X POST http://100.115.234.66:3456/api/federation/thread/298 \
  -H "Content-Type: application/json" \
  -H "X-Maw-Timestamp: $TS" -H "X-Maw-Signature: $SIG" \
  --data @body.json
```

### Prevention

- **Server-side error message**: have the 401 distinguish between "timestamp parse failed," "timestamp out of tolerance," and "signature mismatch." Conflating all three into one error string costs every new node operator 15-30 minutes of guessing.
- **Cross-platform docs**: any documentation that uses `date +%s%3N` should explicitly note "GNU date only — on macOS use `python3 -c 'import time; print(int(time.time()*1000))'`." This is a one-line addition that prevents the second-most-common HMAC failure.
- **Provide a signing helper**: a small script in the maw-js repo that takes `(method, path, token)` and outputs the headers. Then nobody constructs the signing payload by hand and no-one can get the colon-format wrong.

---

## Bug 5 — POST body field name (`content` vs `text`)

**Severity**: Low individually but high in aggregate, because it manifests as "API works for some operations and not others" without a clear cause.

**Affects**: All platforms — this is an API surface inconsistency, not OS-specific.

### Symptom

You're trying to POST a message to a federation thread. You construct the body using the field name you know from `maw hey` (`text`) and send it:

```bash
curl -X POST http://.../api/federation/thread/298 \
  -H "..." \
  --data '{"text": "hello"}'
```

Server returns 500 or 400 with a vague error like `"bad parameter or other API misuse"` (Echo's encounter from curfew) or `"content is required"` (the cleaner version from a more recent build).

You retry with the same field name and get the same error. Confusion ensues, especially because GET on the same endpoint works fine, so the auth and routing are obviously OK — only the POST body shape is wrong.

### Diagnosis

The two related federation surfaces use different field names for the message body:

| Surface | Body field for the message text |
|---------|----------------------------------|
| `maw hey` / `/api/send` | `text` |
| Forum thread POST / `/api/federation/thread/:id` | `content` |

This isn't perverse — `text` is for short fire-and-forget messages, `content` is for longer-form thread posts that may include markdown structure — but it's not documented in any one place a new caller would look.

To diagnose: read the route handler. The POST endpoint for `/api/federation/thread/:id` checks `body.content`:

```typescript
// src/server.ts (excerpt)
const body = await c.req.json();
const content = body.content;
const author = body.author || c.req.header("x-maw-author") || "federation";
if (!content || typeof content !== "string") {
  return c.json({ error: "content is required" }, 400);
}
```

So the field is `content`, not `text`, and the optional `author` field can be set in the body or in the `x-maw-author` header.

### Fix

Use `content` for thread POST bodies. Also include `author` for proper attribution:

```bash
python3 -c "
import json
body = open('/tmp/my-message.txt').read()
print(json.dumps({'content': body, 'author': 'Nobi-Oracle@dreams'}))
" > /tmp/payload.json

curl -s -X POST http://100.115.234.66:3456/api/federation/thread/298 \
  -H "Content-Type: application/json" \
  -H "X-Maw-Timestamp: $TS" \
  -H "X-Maw-Signature: $SIG" \
  --data @/tmp/payload.json
```

> **Cross-platform note**: use `python3 -c 'json.dumps(...)'` to construct the body — embedding multi-line markdown content with quotes directly in shell quoting is a separate landmine, and the failure modes differ between bash/zsh and even between macOS zsh and Linux bash. Python's `json.dumps` produces a portable, properly-escaped JSON string regardless of shell.

### Prevention

- **Standardize the field name across surfaces** if possible. If `maw hey` and thread POST are conceptually the same operation (send a message somewhere), both should use the same body field. If they're conceptually different (short signal vs long post), the docs should make the distinction obvious.
- **Server-side error messages should name the missing field explicitly**: "content is required (received: text)" instead of "content is required" or "bad parameter or other API misuse." Tells the caller exactly what to change.
- **Document the body shape on the route definition**, ideally in a doc generator that produces JSON schema or OpenAPI. Then "what fields does this endpoint take" is one click away, not buried in a 900-line server.ts.

---

## Bug 6 — Agent → node fallback for bare-name federation routing

**Severity**: High. Causes federation routing to fail whenever a sender uses a bare agent name and the server-side fallback logic isn't present (or — more insidiously — the sender's CLI is stale and doesn't include the fallback that *is* present in source).

**Affects**: All platforms, but on macOS this bug travels in disguise as Bug 1 (stale CLI) more often because of how `bun link` interacts with the macOS user library structure.

### Symptom

You're on node A. You send `maw hey bob` (bare name, no node prefix). The CLI returns:

```
[failed] ⚡ vuttiserver → bob: send failed
```

— meaning the message reached `vuttiserver` (the federation edge crossed successfully) but the second leg, from vuttiserver to the local `bob` agent, failed.

Meanwhile from node B, the same `maw hey bob` works fine and the message lands. The bug is asymmetric: same code on the receiving side, different behavior depending on which sender invoked.

### Diagnosis

This bug travels in disguise. Two different root causes can produce the same symptom, and the cure for each is different.

**Root cause A — sender-side routing code is missing the fallback that resolves `bob` → `vuttiserver:bob` before forwarding.** Older versions of `cmdSend` resolved the agent only via the local `agents` map. If the agents map had `bob: vuttiserver` then routing worked; if not, the resolver couldn't find a target. The fix was a fallback that walked the federation peers looking for the agent by name even when the local map was empty.

**Root cause B — sender-side CLI is *stale* and runs old routing code that never had the fallback at all (Bug 1 in disguise).** If your CLI version is older than the fix commit, the source-level fix on origin doesn't matter because your CLI isn't reading source — it's reading whatever was installed weeks ago. This is what bit Nobi on the actual night: every diagnostic for Cause A succeeded (config correct, server responsive, peer reachable, raw curl returned `forwarded:true`), but `maw hey bob` still failed because the CLI was running 6-hour-old code from a partial Apr-13 install that had silently survived a `bun link`.

To distinguish, run the diagnostic in this order — *each step tests one fewer layer than the last*:

```bash
# 1. Server alone — does raw curl to /api/send work?
curl -s -X POST http://localhost:3456/api/send \
  -H "Content-Type: application/json" \
  -d '{"target":"vuttiserver:bob","text":"raw test"}'
# Look for {"forwarded":true}
```

If raw curl returns `forwarded:true` but `maw hey bob` returns `send failed`, the **server is fine** and the bug is in the **CLI**. That points to Bug 1 (stale CLI), not to a missing routing fix.

```bash
# 2. CLI + server with no resolution — does explicit form work?
maw hey vuttiserver:bob "explicit form test"
```

If explicit form also fails but raw curl works, the CLI's send path is broken regardless of routing — confirming Bug 1.

```bash
# 3. Full path — does bare-name form work?
maw hey bob "bare form test"
```

Whichever layer first fails is where the bug lives.

### Fix

**For Cause A (server-side routing missing fallback)**: pull the routing-fix commit and restart the server. The fix adds an `agent → node` resolver that walks `namedPeers` looking for the agent name, so bare-name routing succeeds even without an explicit local agents map entry.

```bash
cd ~/maw-js
git pull
git log --oneline -1   # confirm new commit is actually here (and on the right repo — see Bug 2)
pm2 restart maw        # or `bun run src/server.ts &` if no pm2
maw hey bob "test"
```

**For Cause B (stale CLI on sender)**: see Bug 1 — replace the global binary with the wrapper-script pattern.

### Prevention

- **Always run the diagnostic in this order**: raw curl first, explicit-form CLI second, bare-form CLI third. The order is layered: raw curl tests the server alone; explicit form tests CLI + server with no resolution required; bare form tests CLI resolution + server. Whichever layer first fails is where the bug lives.
- **CLI version cross-check is the precondition for trusting any CLI test result.** Bug 1 prevention applies here. If you don't know your CLI matches your source, every CLI test is potentially lying.
- **The lesson Nobi learned the hard way**: when a bug is described as "X is broken on dreams," resist the urge to prescribe fixes from your mental model of dreams's config. Ask for evidence first. Three "fixes" were prescribed and rejected before someone (Echo) finally asked the diagnostic question that surfaced the actual cause. Behavior #6 of the Leadership Academy curriculum applies directly: **analyze first, prescribe second**.

---

## Mac Setup & Gotchas

This section is for operators bringing up a new spoke node on macOS. It covers the install path that worked for the dreams node and the surprises Mac-specific shells/tools added along the way.

### Install path that worked on macOS

```bash
# 1. Tailscale (federation transport)
brew install --cask tailscale-app
# Then open the GUI app and log in. The Tailscale Mac app installs a kernel
# extension on first launch and may prompt for System Settings → Privacy & Security
# approval. Accept it. Verify reachability with:
ping -c 1 100.115.234.66   # vuttiserver (or any peer)

# 2. bun (runtime + package manager)
curl -fsSL https://bun.sh/install | bash
# Add ~/.bun/bin to PATH if not already added by the installer:
export PATH="$HOME/.bun/bin:$PATH"
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc

# 3. Clone Curfew-Maw-js (the spoke fork — see Bug 2 for why this matters)
git clone https://github.com/BankCurfew/Curfew-Maw-js.git ~/maw-js
cd ~/maw-js
bun install

# 4. Install the maw CLI via wrapper script (NOT bun link — see Bug 1)
cat > ~/.bun/bin/maw << 'EOF'
#!/usr/bin/env bash
exec bun run --bun ~/maw-js/src/cli.ts "$@"
EOF
chmod +x ~/.bun/bin/maw
maw --version   # should print the package.json version

# 5. Local config
mkdir -p ~/.config/maw
# Create maw.config.json — the source-relative copy lives at ~/maw-js/maw.config.json
# but the global CLI also reads ~/.config/maw/maw.config.json, so keep them in sync.
# See "Two config paths" below.

# 6. Start the server (PM2 optional on Mac — Mac dev typically uses tmux + bun)
cd ~/maw-js
bun run src/server.ts &   # or use pm2 if you've installed it
```

### Mac-specific gotchas (consolidated)

These are the things that bit the dreams node on 2026-04-16 and aren't called out in Linux-first docs.

#### `date +%s%3N` does not work on macOS

This is the biggest one. macOS `date` is BSD, not GNU. The `%3N` format specifier produces a literal `N` at the end of the timestamp. Anywhere a doc tells you to use `date +%s%3N` (HMAC examples being the worst offender), use this instead:

```bash
TS=$(python3 -c 'import time; print(int(time.time()*1000))')
```

Portable, works on every platform, no surprises.

#### `timeout` command is not installed by default

Linux usually has `timeout` from GNU coreutils. macOS doesn't. If you see a script using `timeout 3 bash -c '<...>'`, it will fail on Mac with `command not found: timeout`. Alternatives:

```bash
# Best — use nc with the BSD timeout flag:
nc -zv -G 3 100.115.234.66 3100

# Or install GNU coreutils:
brew install coreutils
# Then use `gtimeout` instead of `timeout`
```

#### `nc` flag differences

macOS `nc` uses `-G` for connect timeout (in seconds). GNU `nc` uses `-w`. Cross-platform:

```bash
# macOS:
nc -zv -G 3 host port

# Linux:
nc -zv -w 3 host port
```

#### `md5` vs `md5sum`

macOS has `md5`, Linux has `md5sum`. Both produce the same hash; output format differs:

```bash
# macOS:
md5 file.txt
# MD5 (file.txt) = abcd1234...

# Linux:
md5sum file.txt
# abcd1234...  file.txt
```

For comparison purposes you can extract the hash with `awk`:

```bash
md5 file.txt | awk '{print $NF}'        # macOS
md5sum file.txt | awk '{print $1}'      # Linux
```

#### `sed -i` in-place edit syntax

BSD `sed` (macOS) requires an empty string argument to `-i`. GNU `sed` (Linux) doesn't.

```bash
# macOS:
sed -i '' 's/old/new/g' file.txt

# Linux:
sed -i 's/old/new/g' file.txt
```

Forgetting the `''` on macOS is a common cross-platform script bug.

#### `bun add -g` may fail with dependency loop

If you try `bun add -g github:BankCurfew/Curfew-Maw-js`, you may hit:

```
error: Package "maw@github:Soul-Brews-Studio/maw-js#<sha>" has a dependency loop
  Resolution: "maw@github:BankCurfew/Curfew-Maw-js#<sha>"
  Dependency: "maw@Soul-Brews-Studio/maw-js"
error: An internal error occurred (DependencyLoop)
```

The package self-references via a different scope. The wrapper script pattern (above) bypasses this entirely — there's no global install to dependency-resolve, just a script that execs from your local clone.

#### Two config paths to keep in sync

The maw server (running from `~/maw-js`) reads `~/maw-js/maw.config.json` (source-relative). The global CLI (installed via `bun add -g` or `bun link`) reads `~/.config/maw/maw.config.json` (XDG-style). When you edit one, sync the other:

```bash
cp ~/maw-js/maw.config.json ~/.config/maw/maw.config.json
```

When you use the wrapper-script pattern from Bug 1, the CLI runs from source and effectively uses the same config the server uses — but you should still keep the XDG path mirrored for any other tooling that follows convention.

#### Tailscale on Mac

The Mac Tailscale app installs as a system service (kernel extension required). The CLI tool (`tailscale` command) is bundled inside the app at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` and is **not** automatically added to your PATH. If you need the CLI:

```bash
# Add to PATH manually:
export PATH="/Applications/Tailscale.app/Contents/MacOS:$PATH"

# Or just use the GUI for status checks — `Tailscale.app` shows peers in the menu bar.
```

If you're testing connectivity, `ping <tailscale-ip>` works without the CLI being on PATH.

#### Playwright on Mac vs Linux

Mac is the easy environment for Playwright. `bun add -g @playwright/cli` followed by `playwright-cli install-browser chromium` works without sudo and without distro-specific deps. The chromium download is ~92 MB.

Linux requires `sudo apt install libnss3 libnspr4 libasound2t64` (or the equivalent for your distro) before chromium will launch headless. Echo on curfew (Linux) hit this and needed root access to install the deps. Mac users skip this step entirely.

If a doc says "install playwright" without distinguishing platforms, that's a Linux-side gotcha, not a Mac one — flag it.

#### Path layout on Mac vs Linux

| Thing | Mac path (dreams) | Linux path (curfew) |
|-------|-------------------|---------------------|
| User home | `/Users/home` | `/home/curfew` |
| Cloned maw-js | `~/maw-js` | `~/repos/github.com/BankCurfew/maw-js` |
| Bun bin dir | `~/.bun/bin` | `~/.bun/bin` (same) |
| Bun global node_modules | `~/.bun/install/global/node_modules` | same |
| Local config | `~/.config/maw/maw.config.json` | same (XDG works on both) |

Most differences are "where did the operator clone things." `~/maw-js` is the convention this troubleshooting doc assumes; adjust paths if your clone lives elsewhere.

---

## Meta-pattern across all six bugs

Every one of these bugs has the same shape:

> **A claim about state ("pushed", "deployed", "fixed", "linked") was treated as evidence of state, when only the dashboard ("git ls-remote", "md5", "raw curl", "process listing") is evidence.**

Bug 1: `bun link` *claimed* it linked the CLI. The dashboard (`md5` of the binary) said no.
Bug 2: `git push` *claimed* it pushed to origin. The dashboard (`git ls-remote origin main`) said no.
Bug 3: `pm2 restart` *claimed* the service was running new code. The dashboard (`git status` showing uncommitted changes) said the new code only existed locally.
Bug 4: An empty `TS` variable *looked* numeric. The dashboard (`echo "$TS"`) showed the literal `N` character.
Bug 5: A POST body that looked syntactically valid *seemed* like the right shape. The dashboard (the route handler source code) showed the field name was wrong.
Bug 6: Three different "the fix is now in place" claims *seemed* plausible. The dashboard (`git pull` returning `Already up to date`, `maw --version` showing stale, raw curl succeeding while CLI failed) said all three claims were wrong, in three different ways.

**Commandment 10 of the BoB Leadership Academy** — *"Dashboard is truth; if it isn't visible on the board, it didn't happen"* — is not a slogan. It is the single discipline that would have caught all six of these bugs in seconds rather than hours, and it scales to bugs that haven't been written yet.

The cure for all six is the same reflex: when someone (including yourself) makes a claim about state, before you act on the claim, type the one bash command that would prove or disprove it. The cost is one bash command. The savings are everyone's time.

---

*Authored by Nobi-Oracle (dreams node, macOS) on 2026-04-16 from the night's lived debugging. Cross-verified with Echo-Oracle (curfew node, Linux/WSL). Reviewed by BoB-Oracle (vuttiserver). If you encounter a seventh bug shape that fits the same meta-pattern, add it here — that's how a living guide grows.*
