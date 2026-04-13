# maw-plugin-sdk (AssemblyScript)

AssemblyScript SDK for maw WASM command plugins. Mirrors the Rust SDK
(`maw-plugin-sdk`) but uses AssemblyScript idioms.

## Install

```bash
npm install --save-dev assemblyscript maw-plugin-sdk
# or from source:
npm install --save-dev assemblyscript "maw-plugin-sdk@file:../maw-plugin-sdk-assemblyscript"
```

## Build

```bash
npm run asc               # → build/release.wasm
```

## Write a plugin

```typescript
// assembly/index.ts
import { maw, readArgs } from "maw-plugin-sdk/assembly";

export function handle(ptr: i32, len: i32): i32 {
  const args = readArgs(ptr, len);
  const id = maw.identity();
  maw.print("Hello from " + id.node + "!\n");
  maw.print("version: " + id.version + "\n");
  maw.print("agents: " + id.agents.join(", ") + "\n");
  if (args.length > 0) maw.print("args: " + args.join(" ") + "\n");
  const fed = maw.federation();
  maw.print("peers: " + fed.reachablePeers.toString() + "/" + fed.totalPeers.toString() + "\n");
  return 0;
}

// Re-export the allocator — the host needs this to write return data.
export { maw_alloc } from "maw-plugin-sdk/assembly";
```

## API reference

### Output

| Function | Description |
|---|---|
| `maw.print(s)` | stdout (no auto-newline) |
| `maw.printErr(s)` | stderr (no auto-newline) |
| `maw.log(level, s)` | structured log (0=debug … 3=error) |
| `maw.debug/info/warn/error(s)` | convenience log wrappers |

### SDK queries

| Function | Returns | Description |
|---|---|---|
| `maw.identity()` | `Identity` | node name, version, agents, uptime |
| `maw.federation()` | `FederationStatus` | peer list, reachable count |

### Messaging

| Function | Returns | Description |
|---|---|---|
| `maw.send(target, msg)` | `bool` | fire-and-forget send to a named agent |

### HTTP fetch (async)

Fetch is inherently async (JS Promise). The plugin receives an ID and polls.

| Function | Returns | Description |
|---|---|---|
| `maw.fetch(url)` | `i32` | start GET, returns async-result ID |
| `maw.asyncResult(id)` | `string` | poll result; `""` if still pending |

### Memory / utilities

| Function | Description |
|---|---|
| `readArgs(ptr, len)` | parse CLI args JSON from handle() |
| `writeResult(s)` | write null-terminated result for host |
| `maw.alloc(size)` | raw heap allocation |
| `maw_alloc(size): i32` | **must re-export** from every plugin |

## Differences from the Rust SDK

| Rust | AssemblyScript | Notes |
|---|---|---|
| `maw::eprint(s)` | `maw.printErr(s)` | name follows JS convention |
| `maw::fetch(url) → i32` | `maw.fetch(url): i32` | same: returns async ID |
| `maw::async_result(id)` | `maw.asyncResult(id)` | camelCase |
| `maw::read_args` | `readArgs(ptr, len)` | top-level export |
| `maw::write_result` | `writeResult(s)` | top-level export |
| `#[no_mangle] maw_alloc` | `export { maw_alloc }` | re-export from assembly/index |
| Identity/FederationStatus via serde | hand-rolled JSON extractor | no external deps |
