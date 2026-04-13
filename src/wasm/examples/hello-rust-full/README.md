# hello-rust-full

Full Rust WASM reference implementation of the `hello` command plugin.
This is the annotated port of `~/.oracle/commands/hello.ts` — use it as a
template when converting TypeScript plugins to Rust.

## TypeScript → Rust mapping

| TypeScript | Rust |
|---|---|
| `export const command = { name, description }` | `const COMMAND: CommandMeta` struct |
| `console.log("text")` | `maw::print("text\n")` |
| `maw.fetch<Identity>('/api/identity')` | `maw::identity()` — SDK wraps the fetch |
| `async/await` | synchronous — the host resolves async internally via `maw_async_result` |
| TypeScript `interface Identity { node: string }` | Rust `struct Identity` with `#[derive(Deserialize)]` |
| `JSON.parse(response)` | `serde_json::from_str(&json)` — done inside SDK |
| ANSI codes (`\x1b[36m`) | identical — Rust string literals support the same escapes |

## Build

```bash
cd src/wasm/examples/hello-rust-full
cargo build --release --target wasm32-unknown-unknown
```

Output: `target/wasm32-unknown-unknown/release/hello_rust_full.wasm`

Expected size: < 100 KB (release + LTO + strip).

## Differences from hello-rust (minimal)

`hello-rust/` is the bare-minimum demo. This crate adds:

- Plugin metadata struct (`CommandMeta`) mirroring the TS `command` export
- Identity display with clock and agent list
- Federation peer count
- Inline `//` comments mapping each line back to its TS equivalent
- `serde::Serialize` on `CommandMeta` as an example of outbound serialization

## SDK host-function reference

| SDK call | Host function | Description |
|---|---|---|
| `maw::print(msg)` | `maw_print` | Write to stdout |
| `maw::eprint(msg)` | `maw_print_err` | Write to stderr |
| `maw::identity()` | `maw_identity` | Node name, version, agents, clock |
| `maw::federation()` | `maw_federation` | Peer list, reachability counts |
| `maw::send(target, msg)` | `maw_send` | Send message to an agent |
| `maw::fetch(url)` | `maw_fetch` | Start async HTTP GET, returns ID |
| `maw::async_result(id)` | `maw_async_result` | Poll async result by ID |
| `maw::read_args(ptr, len)` | *(host writes before call)* | Decode CLI args from shared memory |
