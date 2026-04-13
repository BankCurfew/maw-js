/**
 * memory.ts — helpers for the maw WASM memory protocol.
 *
 * Protocol summary:
 *  - Strings sent TO host:   (ptr: i32, len: i32) raw UTF-8, no prefix
 *  - Strings received FROM host: ptr → [u32 LE length][utf-8 bytes]
 *
 * All allocations use heap.alloc (works with both stub and full runtimes).
 * Callers that care about memory pressure may call heap.free(ptr as usize).
 */

/**
 * Encode an AS string as UTF-8, copy to a heap allocation, return the ptr.
 * The allocated region is exactly utf8ByteLength(s) bytes.
 * Returns 0 for empty strings (no allocation).
 */
export function encodeUTF8(s: string): usize {
  const len = String.UTF8.byteLength(s);
  if (len === 0) return 0;
  const buf = String.UTF8.encode(s);
  const ptr = heap.alloc(len);
  memory.copy(ptr, changetype<usize>(buf), len);
  return ptr;
}

/**
 * Return the UTF-8 byte length (not char length) of a string.
 * Matches the `len` argument the host expects alongside the ptr.
 */
export function utf8ByteLength(s: string): i32 {
  return String.UTF8.byteLength(s);
}

/**
 * Decode a host-side length-prefixed UTF-8 string.
 * Layout at ptr: [u32 LE length (4 bytes)][utf-8 payload]
 * Returns "" if ptr is 0.
 */
export function decodeHostString(ptr: i32): string {
  if (ptr === 0) return "";
  const len = load<u32>(ptr as usize);
  if (len === 0) return "";
  return String.UTF8.decodeUnsafe((ptr as usize) + 4, len as usize);
}

// ---------------------------------------------------------------------------
// Minimal JSON field extractors (for structured host return values)
// No external dependencies — the host returns simple, flat-ish JSON.
// ---------------------------------------------------------------------------

/** Extract a JSON string field: `"key":"value"` → "value". */
export function jsonStr(json: string, key: string): string {
  const needle = '"' + key + '":"';
  const idx = json.indexOf(needle);
  if (idx === -1) return "";
  const start = idx + needle.length;
  const end = json.indexOf('"', start);
  if (end === -1) return "";
  return json.slice(start, end);
}

/** Extract a JSON number field: `"key":123.45` → 123.45. */
export function jsonNum(json: string, key: string): f64 {
  const needle = '"' + key + '":';
  const idx = json.indexOf(needle);
  if (idx === -1) return 0.0;
  let start = idx + needle.length;
  let end = start;
  while (end < json.length) {
    const c = json.charCodeAt(end);
    // stop at , } ]
    if (c === 44 || c === 125 || c === 93) break;
    end++;
  }
  return F64.parseFloat(json.slice(start, end));
}

/** Extract a JSON boolean field: `"key":true` → true. */
export function jsonBool(json: string, key: string): bool {
  const needle = '"' + key + '":';
  const idx = json.indexOf(needle);
  if (idx === -1) return false;
  const start = idx + needle.length;
  // true starts with 't' (charCode 116)
  return json.charCodeAt(start) === 116;
}

/** Extract a JSON string array field: `"key":["a","b"]` → ["a","b"]. */
export function jsonStrArray(json: string, key: string): string[] {
  const needle = '"' + key + '":[';
  const idx = json.indexOf(needle);
  if (idx === -1) return [];
  const start = idx + needle.length;
  const end = json.indexOf(']', start);
  if (end === -1) return [];
  const segment = json.slice(start, end).trim();
  if (segment.length === 0) return [];
  const result: string[] = [];
  let pos = 0;
  while (pos < segment.length) {
    if (segment.charCodeAt(pos) === 34) { // '"'
      pos++;
      const e = segment.indexOf('"', pos);
      if (e === -1) break;
      result.push(segment.slice(pos, e));
      pos = e + 1;
    } else {
      pos++;
    }
  }
  return result;
}

/**
 * Extract an array of JSON objects as raw JSON strings.
 * e.g. `"peers":[{...},{...}]` → ["{...}", "{...}"]
 */
export function jsonObjArray(json: string, key: string): string[] {
  const needle = '"' + key + '":[';
  const idx = json.indexOf(needle);
  if (idx === -1) return [];
  let pos = idx + needle.length;
  const result: string[] = [];
  while (pos < json.length) {
    const objStart = json.indexOf('{', pos);
    if (objStart === -1) break;
    let depth = 0;
    let objEnd = objStart;
    for (let i = objStart; i < json.length; i++) {
      const c = json.charCodeAt(i);
      if (c === 123) depth++;       // '{'
      else if (c === 125) {          // '}'
        depth--;
        if (depth === 0) { objEnd = i; break; }
      }
    }
    result.push(json.slice(objStart, objEnd + 1));
    pos = objEnd + 1;
    // stop at ']'
    const next = json.charCodeAt(pos);
    if (next === 93) break; // ']'
  }
  return result;
}
