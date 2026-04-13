/**
 * api.ts — high-level maw plugin API.
 *
 * Usage in your plugin's assembly/index.ts:
 *
 *   import { maw, Identity, FederationStatus } from "maw-plugin-sdk/assembly/api";
 *
 *   export function handle(ptr: i32, len: i32): i32 {
 *     const id = maw.identity();
 *     maw.print("Hello from " + id.node + "!\n");
 *     return 0;
 *   }
 *   export { maw_alloc } from "maw-plugin-sdk/assembly";
 */

import {
  maw_print,
  maw_print_err,
  maw_log,
  maw_identity,
  maw_federation,
  maw_send,
  maw_fetch,
  maw_async_result,
} from "./host";

import {
  encodeUTF8,
  utf8ByteLength,
  decodeHostString,
  jsonStr,
  jsonNum,
  jsonBool,
  jsonStrArray,
  jsonObjArray,
} from "./memory";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Node identity returned by maw_identity(). */
export class Identity {
  node: string = "";
  version: string = "";
  agents: string[] = [];
  clockUtc: string = "";
  uptime: u64 = 0;
}

/** A federation peer. */
export class Peer {
  url: string = "";
  node: string = "";
  latencyMs: f64 = 0.0;
  alive: bool = false;
}

/** Federation status returned by maw_federation(). */
export class FederationStatus {
  localUrl: string = "";
  peers: Peer[] = [];
  totalPeers: u32 = 0;
  reachablePeers: u32 = 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Call a host function with (ptr, len), freeing the UTF-8 buffer after. */
function withStr<T>(s: string, fn: (ptr: i32, len: i32) => T): T {
  const ptr = encodeUTF8(s);
  const len = utf8ByteLength(s);
  const r = fn(ptr as i32, len);
  if (ptr !== 0) heap.free(ptr);
  return r;
}

function parseIdentity(json: string): Identity {
  const id = new Identity();
  id.node = jsonStr(json, "node");
  id.version = jsonStr(json, "version");
  id.clockUtc = jsonStr(json, "clockUtc");
  id.uptime = u64(jsonNum(json, "uptime"));
  id.agents = jsonStrArray(json, "agents");
  return id;
}

function parseFederation(json: string): FederationStatus {
  const fed = new FederationStatus();
  fed.localUrl = jsonStr(json, "localUrl");
  fed.totalPeers = u32(jsonNum(json, "totalPeers"));
  fed.reachablePeers = u32(jsonNum(json, "reachablePeers"));
  const rawPeers = jsonObjArray(json, "peers");
  const peers: Peer[] = [];
  for (let i = 0; i < rawPeers.length; i++) {
    const p = new Peer();
    p.url = jsonStr(rawPeers[i], "url");
    p.node = jsonStr(rawPeers[i], "node");
    p.latencyMs = jsonNum(rawPeers[i], "latencyMs");
    p.alive = jsonBool(rawPeers[i], "alive");
    peers.push(p);
  }
  fed.peers = peers;
  return fed;
}

// ---------------------------------------------------------------------------
// maw namespace — public API
// ---------------------------------------------------------------------------

export namespace maw {

  // --- Output ---------------------------------------------------------------

  /** Print a string to stdout (no automatic newline). */
  export function print(s: string): void {
    const ptr = encodeUTF8(s);
    const len = utf8ByteLength(s);
    maw_print(ptr as i32, len);
    if (ptr !== 0) heap.free(ptr);
  }

  /** Print a string to stderr (no automatic newline). */
  export function printErr(s: string): void {
    const ptr = encodeUTF8(s);
    const len = utf8ByteLength(s);
    maw_print_err(ptr as i32, len);
    if (ptr !== 0) heap.free(ptr);
  }

  /** Structured log at the given level (0=debug, 1=info, 2=warn, 3=error). */
  export function log(level: i32, s: string): void {
    const ptr = encodeUTF8(s);
    const len = utf8ByteLength(s);
    maw_log(level, ptr as i32, len);
    if (ptr !== 0) heap.free(ptr);
  }

  /** Log at debug level. */
  export function debug(s: string): void { log(0, s); }
  /** Log at info level. */
  export function info(s: string): void { log(1, s); }
  /** Log at warn level. */
  export function warn(s: string): void { log(2, s); }
  /** Log at error level. */
  export function error(s: string): void { log(3, s); }

  // --- SDK queries ----------------------------------------------------------

  /** Query node identity from the host. */
  export function identity(): Identity {
    const ptr = maw_identity();
    return parseIdentity(decodeHostString(ptr));
  }

  /** Query federation status from the host. */
  export function federation(): FederationStatus {
    const ptr = maw_federation();
    return parseFederation(decodeHostString(ptr));
  }

  // --- Messaging ------------------------------------------------------------

  /**
   * Send a message to a named agent. Returns true on success.
   * Delivery is fire-and-forget from the plugin's perspective.
   */
  export function send(target: string, msg: string): bool {
    const tPtr = encodeUTF8(target);
    const tLen = utf8ByteLength(target);
    const mPtr = encodeUTF8(msg);
    const mLen = utf8ByteLength(msg);
    const r = maw_send(tPtr as i32, tLen, mPtr as i32, mLen);
    if (tPtr !== 0) heap.free(tPtr);
    if (mPtr !== 0) heap.free(mPtr);
    return r === 1;
  }

  // --- HTTP fetch -----------------------------------------------------------

  /**
   * Start an async HTTP GET. Returns an async-result ID.
   *
   * Note: maw plugins run synchronously — the host resolves the fetch via a
   * JS Promise after handle() returns. Use this ID with asyncResult() if your
   * plugin architecture supports deferred polling (e.g., called multiple times).
   * For a fire-and-forget GET, just call fetch() and ignore the result ID.
   */
  export function fetch(url: string): i32 {
    const ptr = encodeUTF8(url);
    const len = utf8ByteLength(url);
    const id = maw_fetch(ptr as i32, len);
    if (ptr !== 0) heap.free(ptr);
    return id;
  }

  /**
   * Poll for an async fetch result. Returns the response body if ready,
   * or "" if still pending.
   */
  export function asyncResult(id: i32): string {
    const ptr = maw_async_result(id);
    if (ptr === 0) return "";
    return decodeHostString(ptr);
  }

  // --- Memory management ----------------------------------------------------

  /**
   * Allocate `size` bytes in linear memory. Returns a raw pointer.
   * This is primarily used by the host to write return data; plugins rarely
   * need to call this directly.
   */
  export function alloc(size: usize): usize {
    return heap.alloc(size);
  }
}

// ---------------------------------------------------------------------------
// Utility: parse CLI args passed to handle(ptr, len) by the host.
// The host encodes args as a JSON string array: ["arg1","arg2"].
// ---------------------------------------------------------------------------

/** Parse the CLI arguments JSON written by the host into handle(ptr, len). */
export function readArgs(ptr: i32, len: i32): string[] {
  if (ptr === 0 || len === 0) return [];
  const json = String.UTF8.decodeUnsafe(ptr as usize, len as usize);
  return jsonStrArray('{"a":' + json + '}', "a");
}

/**
 * Write a result string to linear memory for the host to read back.
 * Returns a pointer to a null-terminated UTF-8 string.
 */
export function writeResult(s: string): i32 {
  const buf = String.UTF8.encode(s);
  const len = buf.byteLength;
  const ptr = heap.alloc(len + 1);
  memory.copy(ptr, changetype<usize>(buf), len);
  store<u8>(ptr + len, 0); // null terminator
  return ptr as i32;
}
