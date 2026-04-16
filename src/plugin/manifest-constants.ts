/**
 * Plugin manifest — shared constants and regex patterns.
 */

/** Capability namespaces seeded in Phase A. Unknown namespaces emit a
 * validation warning (not a hard fail). New namespaces need an ADR. */
export const KNOWN_CAPABILITY_NAMESPACES = new Set([
  "net",    // network (fetch, sockets)
  "fs",     // filesystem
  "peer",   // federation peers (hey, send)
  "sdk",    // maw SDK calls (identity, federation, …)
  "proc",   // child processes
  "ffi",    // native FFI (bun:ffi)
]);

export const NAME_RE = /^[a-z0-9-]+$/;

// Semver: N.N.N with optional pre-release (-alpha.1) and build metadata (+001)
export const SEMVER_CORE = /\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?/;
export const SEMVER_RE = new RegExp(`^${SEMVER_CORE.source}$`);

// Semver range: *, bare semver, or operator-prefixed semver (^, ~, >=, <=, >, <)
export const SEMVER_RANGE_RE = new RegExp(
  `^(\\^|~|>=?|<=?)?${SEMVER_CORE.source}$|^\\*$`,
);
