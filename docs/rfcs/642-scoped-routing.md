---
issue: Soul-Brews-Studio/maw-js#642
title: Scoped routing + trust — gate cross-scope agent messages on human approval
status: draft (design packet)
author: rfc-routing (team rfc-and-proto)
related: #627 (oracle-team), #629 (peer identity), #644 (consent gate phase 1), #565 (federation pairing)
---

# Scoped routing + trust — design packet for #642

## 1. Problem statement

`maw hey <target>` routes unconditionally. Any agent — local, fleet-mate, or
remote peer — can be named and messaged. As fleets grow past 10 oracles and
oracle-teams (#627) become the default collaboration unit, three failure modes
emerge: accidental cross-project chatter, no blast-radius limit if one oracle
is compromised, and no way for Nat to observe first contact between unrelated
agents. #644 already gates cross-node sends on a per-pair basis; #642 adds a
**scope** primitive on top so we can gate by *workstream*, not just by node,
and so "these three agents are collaborating on X" is a first-class fact the
router can see.

## 2. Current routing model (as of alpha.23)

### 2.1 Resolver — `src/core/routing.ts:30-106`

`resolveTarget(query, config, sessions)` returns one of:

- `local` — tmux window on this host (via `findWindow` or fleet session map)
- `self-node` — `node:agent` where `node === config.node`
- `peer` — remote node, resolved via `namedPeers` / `peers` in `maw.config.json`
- `error` — not found / ambiguous / unknown node

Addressing grammar today:

| Form | Example | Resolution |
|---|---|---|
| bare name | `mawjs` | local session → fleet map → agents map (remote) |
| `node:agent` | `white:mawjs` | named peer lookup → peer URL, or self-node |
| `wire://` | `wire://debug` | debug-only transport |

Canonical reference: memory "maw hey convention" + `src/core/matcher/resolve-target.ts`.

### 2.2 Consent gate — `src/core/consent/` (#644)

Already shipped in alpha.23:

- `trust.json` keyed by `${fromNode}→${toNode}:${action}` where action ∈ `{hey, team-invite, plugin-install}`
- `consent-pending/<id>.json` queue with PIN-based out-of-band approval
- Gate runs **only** on cross-node peer sends (`gate.ts:44-47` — local + self-node bypass)
- Opt-in via `MAW_CONSENT=1`

#642 is therefore **not a greenfield** — it generalizes trust from per-node-pair
to per-scope, and raises the gate above the node boundary to work on any
inter-scope edge, including purely local ones.

## 3. Scope primitives

Four scope types, each a file in `~/.maw/scopes/<name>.json`:

| Scope | Membership | Intent |
|---|---|---|
| `personal` | one oracle only | private workspace; nothing routes in without approval |
| `team` | enumerated agents (local + federated addresses) | collaboration bubble tied to an oracle-team (#627) |
| `public` | `members: "*"` on this node | everyone-on-this-box; default for legacy `maw hey` backwards-compat |
| `federated` | enumerated `node:agent` across ≥2 nodes | cross-node teams; requires peer pairing (#565) |

Why these four and not more:

- `personal` gives an oracle a write-protected boundary it owns.
- `team` is the unit #627 already ships; the scope record is just an ACL view of the team roster.
- `public` preserves the pre-#642 "route freely" behavior behind an explicit flag, so rollback is a config change, not a code revert.
- `federated` exists because a node boundary is not the same as a scope boundary — a `marketplace-work` team of {mawjs@white, security@clinic-nat} needs one scope record, not two.

Scope record shape:

```jsonc
{
  "name": "marketplace-work",
  "type": "team",                              // personal | team | public | federated
  "members": ["mawjs", "security", "white:marketplace"],
  "lead": "mawjs",                             // authorizes add/remove (see §4)
  "created": "2026-04-19T10:00:00Z",
  "ttl": null,                                 // or ISO date
  "signedBy": "mawjs@white#ed25519:abc…"       // §4 — optional, required for federated
}
```

## 4. Trust anchoring per scope

Scope membership is a **claim**. Trust decides who can make that claim believable.

| Scope type | Anchor | Who can add members | Proof on the wire |
|---|---|---|---|
| `personal` | local file owner (unix uid) | oracle itself | none — local-only routing |
| `team` | the `lead` field | lead, or any member with `delegate: true` | HMAC with shared team key (already in federation-auth.ts) |
| `public` | node operator (human) | human only via `maw scope public --add` | none — intra-node only |
| `federated` | `lead`'s signing key | lead signs scope record; members sign join | ed25519 signature (needs rfc-identity primitive) |

Concretely: when an agent says *"route this to `@marketplace-work:security`"*,
the receiver validates that (a) it is itself listed as a member of
`marketplace-work`, and (b) the sender is listed too. For federated scopes, (a)
and (b) additionally require a valid signature on the scope record, produced by
an identity primitive owned by the `lead`.

> **Awaiting rfc-identity reply**: whether the identity primitive signs scope
> assertions, or whether scope records are validated by out-of-band key
> distribution. Will fold in their answer before the packet merges; federated
> scope is the only scope type that depends on this — personal/team/public can
> ship first.

**STUCK / ABORT / safety signals bypass all gates.** `maw hey --system` flag
marks a delivery as a safety signal; the gate always routes, but the fact is
logged in the audit record. This matches the existing no-queue behavior of
lifecycle events.

## 5. Addressing syntax

Proposed grammar (EBNF-ish):

```
target    = scoped | node-addr | bare
scoped    = "@" scope ":" agent                      # @marketplace-work:security
node-addr = node ":" agent                            # white:mawjs   (existing)
bare      = agent                                     # mawjs         (existing)
agent     = IDENT
scope     = IDENT
node      = IDENT
```

Why `@scope:agent` over `scope://addr`:

- Keeps the one-colon shape already used by `node:agent`; tab-completion stays consistent.
- `@` prefix is unambiguous — today `@` has no routing meaning, so there's no grammar collision.
- URL-style `scope://` implies a URI hierarchy that doesn't match the flat (scope, agent) pair we actually have. We'd be inviting confusion (paths? query strings?) for no benefit.
- Pairs cleanly with `@scope:*` for "broadcast to scope" in a future iteration; that rules out `scope://`-style because `scope://*` looks like a globbed host.

Resolution rules for `@scope:agent`:

1. Load `~/.maw/scopes/<scope>.json`. If missing → error `unknown_scope`.
2. Assert sender ∈ `members`. If not → error `not_in_scope` (caller may escalate to `maw scope join`).
3. Resolve `agent` inside the scope's member list. If member is a bare name, treat as local; if `node:agent`, route via peer URL. In either case, **skip the #644 per-pair consent check** — scope membership is the authorization, trust.json isn't consulted twice.
4. If `agent` not a member → error `target_out_of_scope` (caller may request approval via `maw hey --approve` per §6).

### 5.1 Container-oracle addressing

> **Awaiting container-proto reply.** Working assumption until they respond:
> a container-oracle is addressed as `<container-host-node>:<agent>` and
> belongs by default to a freshly-minted `personal` scope at boot. The
> container host can optionally `maw scope join` it into a team scope after
> attestation. This keeps `@scope:agent` grammar stable — containers do not
> need a new scheme like `container://`.

## 6. First-PR cut (≤300 LOC)

Scope this tight — everything else is Phase 2+.

**In:**

1. New file `src/core/scopes/store.ts` — `loadScope(name)`, `writeScope(rec)`, `listScopes()`, `inScope(sender, target, scope)`. Mirrors the shape of `consent/store.ts`. Atomic write via temp+rename. ~120 LOC.
2. New file `src/core/scopes/gate.ts` — `maybeGateScope(ctx)`. Runs BEFORE the existing `maybeGateConsent`. Returns allow if (sender, target, scope) all valid; otherwise enqueues a pending approval and denies. ~80 LOC.
3. Wire into `comm-send.ts` — parse `@scope:agent` form, populate `GateContext.scope`, call `maybeGateScope` first, `maybeGateConsent` second. ~40 LOC.
4. Minimal CLI: `maw scope list`, `maw scope show <name>` only. ~40 LOC.

**Out (Phase 2+):** scope create/edit, federated signing, `--approve` UX, audit log, wildcard trust, cross-node scope sync, batched approval.

Default behavior: unscoped `maw hey` continues to work unchanged. `@scope:agent`
is the only new code path. Rollback = don't type `@`.

Env flag: `MAW_SCOPED_ROUTING=1` — when off, `@scope:agent` errors with
"scoped routing not enabled". Ship-default off until Phase 2.

## 7. Open questions

1. **Scope on receive side.** When a remote peer delivers `@marketplace-work:security`, does the receiver trust the scope assertion from the wire, or re-verify against its own `~/.maw/scopes/`? (Proposal: re-verify. Wire assertion is a hint, not authority.)
2. **Scope record distribution.** How does `marketplace-work.json` land on each member's filesystem? Sync via `ψ/`? Pull via `maw scope fetch <lead>`? Handshake during `maw scope join`? (Leaning toward `maw scope fetch` — explicit over magic.)
3. **Agent renaming.** If `mawjs` is renamed, does the scope record update? (Memory says oracles have stable identity via `node` field; scope members should probably reference the identity primitive from #629 rather than the display name. Blocked on rfc-identity.)
4. **Overlap + precedence.** An agent can be in multiple scopes. If target is reachable via scope A (allowed) and scope B (denied), which wins? (Proposal: any allowed scope permits the send — ACL-union, not ACL-intersection. This matches intuition: being in the team-scope shouldn't be weakened by *also* being on the personal-scope exclusion list of someone you're not messaging.)
5. **Audit log location.** `ψ/` (shared, auditable across federation) vs `~/.maw/audit/` (local, private). Memory "Vault sync scope" warns ψ/ is not fully cross-node synced, so leaning local with opt-in ψ/ mirror for team scopes.
6. **Phase 3 deprecation.** Spec says "require every `maw hey` to cite scope." That's a breaking change; needs its own issue. Out of scope here — this RFC only earns us the *ability* to require it later.
7. **Interaction with #644 trust.json.** Is per-pair trust still useful once scopes exist? Argument for keep: legacy unscoped routing still needs it. Argument against: two overlapping ACL systems. (Proposal: keep; #644 is the fallback for public-scope and legacy callers.)

---

*Deliverable for task #3. Cross-consult replies pending from rfc-identity (§4,
§7.3) and container-proto (§5.1) will be folded in before merge.*
