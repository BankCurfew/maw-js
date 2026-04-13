/**
 * host.ts — raw @external declarations for all 9 maw host functions.
 *
 * These are imported from the "env" namespace that the maw runtime injects
 * via buildImportObject() in wasm-bridge.ts.
 *
 * Memory protocol (strings passed TO the host):
 *   (ptr: i32, len: i32) — raw UTF-8 bytes, no length prefix
 *
 * Memory protocol (strings returned FROM the host):
 *   Returns a ptr to: [u32 LE length][utf-8 bytes]
 *   Use decodeHostString(ptr) from memory.ts to read these.
 */

// --- Output ------------------------------------------------------------------

/** Print UTF-8 string to stdout. */
@external("env", "maw_print")
export declare function maw_print(ptr: i32, len: i32): void;

/** Print UTF-8 string to stderr. */
@external("env", "maw_print_err")
export declare function maw_print_err(ptr: i32, len: i32): void;

/** Structured log. level: 0=debug, 1=info, 2=warn, 3=error. */
@external("env", "maw_log")
export declare function maw_log(level: i32, ptr: i32, len: i32): void;

// --- SDK queries (sync façade) -----------------------------------------------

/** Returns ptr to a length-prefixed JSON Identity object. */
@external("env", "maw_identity")
export declare function maw_identity(): i32;

/** Returns ptr to a length-prefixed JSON FederationStatus object. */
@external("env", "maw_federation")
export declare function maw_federation(): i32;

// --- Messaging ---------------------------------------------------------------

/** Send a message to a named agent. Returns 1 on success, 0 on failure. */
@external("env", "maw_send")
export declare function maw_send(tPtr: i32, tLen: i32, mPtr: i32, mLen: i32): i32;

// --- HTTP fetch (async) ------------------------------------------------------

/** Start an async HTTP GET. Returns an async-result ID (poll with maw_async_result). */
@external("env", "maw_fetch")
export declare function maw_fetch(urlPtr: i32, urlLen: i32): i32;

/** Poll for an async result by ID. Returns ptr (ready) or 0 (pending). */
@external("env", "maw_async_result")
export declare function maw_async_result(id: i32): i32;
