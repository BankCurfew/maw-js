# Repo Consolidation Plan — maw-js vs Curfew-Maw-js

> Status: PROPOSED — needs แบงค์ approval before executing

## The Problem

Two repos exist with diverged git histories:

| Repo | Origin | Current Use |
|------|--------|-------------|
| `BankCurfew/maw-js` | Forked from Soul-Brews-Studio/maw-js | BoB develops here (vuttiserver) |
| `BankCurfew/Curfew-Maw-js` | Created independently for curfew | Echo + Nobi track this (curfew, dreams) |

### Why This Is a Problem
- Pushing to the wrong repo happened **3 times** on 2026-04-16
- Cherry-picking between repos is manual and error-prone
- New spoke nodes don't know which to clone
- Bug fixes on one repo don't automatically reach the other

## Options

### Option A: Make Curfew-Maw-js the Single Source of Truth
- All nodes (including vuttiserver) track Curfew-Maw-js
- maw-js becomes read-only archive
- **Pro**: One repo, simple
- **Con**: Need to port vuttiserver-only features to Curfew-Maw-js

### Option B: Make maw-js the Single Source of Truth
- All nodes (including curfew/dreams) switch to tracking maw-js
- Curfew-Maw-js becomes archive
- **Pro**: maw-js has the most complete feature set
- **Con**: Echo/Nobi need to change remotes, potential config conflicts

### Option C: Keep Both, Document the Relationship
- maw-js = development/hub repo
- Curfew-Maw-js = spoke deployment repo
- Establish a one-way cherry-pick workflow: maw-js → Curfew-Maw-js
- **Pro**: No migration needed
- **Con**: Ongoing maintenance burden, still error-prone

## Recommendation

**Option B** — Make `BankCurfew/maw-js` the single source of truth.

### Migration Steps (if approved)
1. Port any Curfew-Maw-js-only commits to maw-js
2. On curfew: `git remote set-url origin https://github.com/BankCurfew/maw-js.git`
3. On dreams: same remote switch
4. Archive Curfew-Maw-js (rename to `Curfew-Maw-js-archived`)
5. Update all documentation to reference maw-js only
6. Add node-specific config examples in docs (not in code)

### Timeline
- Requires แบงค์ approval
- Migration: ~30 minutes per node
- Testing: verify `maw hey` cross-node after remote switch
