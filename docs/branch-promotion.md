# Branch Promotion — main → stable

> Adopted 2026-04-16 (Strategy C). Spokes track `stable`; hub develops on `main`.
> Purpose: give spoke nodes (curfew, dreams, …) a branch that is, by construction, known-good.

## The rule

Spokes **never** fetch `main`. Every commit a spoke sees must first pass a deliberate **promotion** from `main` to `stable`. Promotion is an explicit merge commit on `stable`, not a fast-forward — so `git log stable` reads as a ledger of releases, not a firehose of hub WIP.

## When to promote

Only when **all** of the following hold on the candidate `main` HEAD:

1. **Build is clean** on vuttiserver — `bun build src/server.ts src/serve-bob.ts src/cli.ts` runs without errors
2. **Server boots + passes smoke** — `pm2 restart maw` stays green; `curl localhost:3456/api/config` returns 200 JSON
3. **Federation round-trip works** — `maw hey vuttiserver:bob` → delivered; no `401` from HMAC verify
4. **Security audit is current** — no open P0/H findings in the latest Security-Oracle report
5. **No unresolved regressions** — the hub has actually used the code for at least a few hours of real traffic, not just "I compiled it once"

If any check fails, **do not promote**. Fix on `main`, repeat the checks.

## How to promote

Run on vuttiserver (the hub) with a clean working tree:

```bash
cd ~/maw-js                    # pm2 serves from here
git checkout main && git pull
# Run the checks above. Only continue if all pass.

git checkout stable && git pull
git merge --no-ff main -m "promote: main → stable ($(git rev-parse --short main)) — <one-line summary>"
git push origin stable
```

### Why `--no-ff`

A fast-forward merge leaves no explicit promotion commit — `git log stable` would look identical to `git log main`, and `git log --first-parent stable` would be meaningless. With `--no-ff`, every promotion is a single merge commit whose message records *what was promoted and why*. That commit is the audit trail.

### Announce the promotion

```
/talk-to bob "cc: promoted stable → <short-hash> — <summary>. Spokes can pull."
```

Optionally drop a note into spoke channels (`echo@curfew`, `nobi@dreams`) so spokes run:

```bash
cd ~/repos/github.com/BankCurfew/maw-js
git pull origin stable
# restart if needed
pm2 restart maw   # or: bun run --bun src/cli.ts serve 3456
```

## Rollback

If a promotion turns out to be bad (e.g. a spoke reports a regression), roll `stable` back to the previous merge commit:

```bash
cd ~/maw-js
git checkout stable

# Identify the previous stable commit (the one before the bad promotion)
git log --first-parent --oneline stable

# Either: revert the promotion (safest — keeps history linear-forward)
git revert -m 1 <bad-merge-sha>
git push origin stable

# Or: hard-reset (only if stable has no intervening work)
git reset --hard <prev-good-sha>
git push --force-with-lease origin stable
```

Prefer `git revert`. `--force-with-lease` is only acceptable when all spokes are known-quiet and you've announced the rollback ahead of time — spokes that have already pulled the bad commit need to be told to re-pull.

Tell spokes:

```
/talk-to bob "cc: rolled back stable to <short-hash>. Spokes: git fetch && git reset --hard origin/stable"
```

## What does NOT belong in a promotion

- WIP branches not merged to `main` yet
- Fixes that only exist as uncommitted changes on the hub
- "I'll deploy and verify later" promotions — verify BEFORE promoting, not after

## Who can promote

Currently: **BoB-Oracle** (and Dev-Oracle when acting on BoB's direction). Both run on vuttiserver, both have push rights to `origin stable`. Any other oracle should send a PR or ping BoB rather than pushing `stable` directly.

## Related

- [federation-architecture.md §Branch Strategy](./federation-architecture.md#branch-strategy-strategy-c--stable-branch) — the "why" and the mesh diagram
- [new-node-setup.md §2](./new-node-setup.md#2-clone-the-correct-fork--and-track-stable-not-main) — how spokes clone and pull `stable`
