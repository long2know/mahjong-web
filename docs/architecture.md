# Architecture decision: one authoritative Changsha table service

Initial implementation contract, 2026-11-19. See [protocol v1](protocol.md) for wire types and room policy and the [reference ledger](references.md) for observation coverage. The rules profile and visual presentation are **provisional** until supported by source-section and lawful viewing evidence, respectively. Neither public page access nor a playable prototype establishes fidelity.

## Runtime and project boundaries

| Owner | Path | Responsibility |
|---|---|---|
| Rules | `src/Mahjong.Rules/Mahjong.Rules.csproj`, `tests/Mahjong.Rules.Tests/` | Pure `net10.0` Changsha hand engine, scoring, projections and limited-view bot policy. |
| Backend | `src/Mahjong.Server/Mahjong.Server.csproj`, `tests/Mahjong.Server.Tests/` | ASP.NET Core, EF Core SQLite, guest identity, admission, four seats, match sequencing, clocks and checkpoint recovery. References Rules. |
| Frontend | `web/`, `web/e2e/` | Vite/TypeScript using DOM and CSS; only talks to the wire protocol. |
| Infra | Repository root | Reproducible client and .NET builds, single-container runtime, local commands and CI. |

Use native WebSocket at `/ws` plus small HTTP endpoints. Two owned clients (browser and integration tests), full snapshots and one server don't warrant SignalR's extra client/protocol layer; we explicitly own reconnect, backpressure and versioning. The WebSocket is same-origin and authenticated with the HTTP guest cookie. No network services, accounts, telemetry, service worker, subpath deployment or runtime Node. A single replica and persistent disk are architectural constraints, not scaling promises.

Use one bounded, serialized executor per room (including admissions, reads for subscription, bots, timers and human commands). Reduce against the latest checkpoint, persist the next checkpoint and command receipt in one SQLite transaction, then publish only committed recipient projections. A rolled-back transition never changes the in-memory authoritative state or produces a success ack. Keep room checkpoints, guest/membership and invite indexes, and command receipts in the same DB; enforce a unique active membership per guest in SQLite. Creation is committed before the room is visible. Restore checkpoints, revisions, deadlines and pending windows before readiness; a restart never reshuffles or gives an expired window more time. Persist the ASP.NET Data Protection key ring alongside the DB, but not inside the published app.

## Rules ↔ host boundary

Use namespace `Mahjong.Rules`. The initial entry points and inputs are:

```csharp
// API signatures, not an implementation.
public readonly record struct RoundSeed(ulong Low, ulong High);
public sealed record HandStart(int HandNumber, int DealerSeat, RoundSeed Seed,
    string Profile, TimeSpan TurnLimit, TimeSpan ClaimLimit);
public abstract record GameAction;
public sealed record Choose(int Seat, string WindowId, string OptionId) : GameAction;
public sealed record Expire(string WindowId) : GameAction;

// On static ChangshaEngine:
public static GameState StartHand(HandStart input, DateTimeOffset gameNow);
public static MoveResult Apply(GameState state, GameAction action, DateTimeOffset gameNow);
public static PublicView ViewPublic(GameState state);
public static SeatView ViewSeat(GameState state, int seat);
// On static BotPolicy:
public static string? Pick(PublicView table, SeatView seat);
```

- Seat IDs are absolute `0..3`; turn order advances by `+1 mod 4`. Hands are 1-based. The host chooses dealer `0` initially and generates a new 128-bit seed per hand from a cryptographic RNG. The engine is deterministic given input, seed and clock. The initial named profile is `changsha-v1`; Rules records decisions and source sections for disputed switches, without silently substituting another regional ruleset.
- `MoveResult` has `Status` (`Accepted`, `StaleWindow`, `IllegalChoice`, `WindowElapsed`, `NotDue`) and `State`. Rejection returns the unchanged state. `GameState` is versioned, checkpoint-serializable and immutable to callers: reducers do not mutate a supplied state, including nested collections. Checkpoint includes pending responses, complete wall/hands, and any PRNG state required for repeatability. Rules owns its schema; Server owns the room checkpoint and does not infer rules from it.
- `PublicView` covers the protocol's public game data and rule decision window (`WindowId`, reason, trigger and `ClosesAtGameTime`). Its `PublicSettlement` projects terminal results from the checkpoint; only terminal winners get a `WinningHand`, with the event tile in `WinningTiles` and concealed table melds still redacted. A Gang replacement turn derives `KongRoll` from the preceding window sequence without adding checkpoint fields. `SeatView` has only the requested seat's hand and current legal options. The host adds room/match details, cumulative totals, revision anchors and the display deadline. Engine window IDs are unique for the match and stable until that decision closes; namespace them for uniqueness across room rematches on the wire. Option IDs are stable and scoped to the seat/window. Private tile IDs are stable for that seat/hand, opaque and unrelated to face or wall order; use domain-separated IDs or a host mapping with a persisted key. Never serialize engine/checkpoint objects to clients.
- `gameNow` is supplied by the host, never read by Rules; `Expire` is valid only at or after the named window's deadline. Rules chooses deterministic timeout outcomes (pass optional responses, legal discard for a timed-out turn) and resolves claim priority independent of arrival order. Bots see only `ViewPublic` and their own `ViewSeat` and submit a legal option through the same executor/`Apply` path; no wall, seed or opponent tiles.

## Preliminary table presentation and gate

Use CSS 3D for the board, not WebGL: accessible HTML controls, a small asset footprint and one input model are more useful than camera fidelity. Use a square board plane at a centered `perspective(900px) rotateX(28deg)`, constrained by viewport and safe-area insets. Keep all four corners of the plane `(0,0)`, `(100%,0)`, `(100%,100%)`, `(0,100%)` visible, with a discard well at `25%–75%` on each axis and four edge lanes inset `8%`. Rotate seat-local lanes in 90° steps in protocol turn order: counterclockwise from the viewer's seat, bottom → right → far → left. Tile thickness can be CSS shadow/offset. Action controls, own hand and settlement overlay are untransformed DOM. Give touch controls a 44 CSS px target and use responsive multirow racks or a compact side rack in short landscape, with a separate discard confirmation. Every local tile's four corners must be visible simultaneously within safe areas, without horizontal scroll or clipping. Use original artwork only.

Frontend's first spike: position independent zero-size markers at the four board corners and at test targets near each lane; measure their **projected** viewport coordinates to assert ordering, no clipping and sensible near/far width. In Playwright Chromium **and** WebKit touch contexts, use `touchscreen.tap` near those targets and at overlapping boundaries, checking the hit target and action. Verify a full local rack, visible corner coordinates, no horizontal overflow, tap-select, explicit discard, resize/orientation and safe-area behavior at `390×844`, `393×852`, `430×932` and short landscape `844×390`. Emulated touch is browser evidence, not physical-device evidence. If perspective fails these gates, flatten or reduce the board tilt and retest; no WebGL fallback claim.

## Local handoff and validation

- Microsoft [.NET 10 release metadata](https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json) verified 2026-11-19: active LTS through 2028-11-14, SDK `10.0.404` and runtime `10.0.15` released together. Infra owns SDK/runtime and lockfile pins.
- Default local sequence from the repo root: `npm --prefix web ci`, `npm --prefix web run build`, then `dotnet run --project src/Mahjong.Server --no-launch-profile -- --urls http://localhost:8080`. Infra wires `web/dist` into generated server `wwwroot` for local run and published `wwwroot` for deployment, without a frontend toolchain at runtime. Container port `8080`, persistent `/data/mahjong.db` and `/data/keys/`. Build smoke checks use `/`, `/health/live`, `/health/ready`, `/api/version`. Docker CLI availability alone is not image/runtime verification.
- **Rules:** publish the evidence matrix early; test golden seeds, competing claims and reloaded checkpoints. **Backend:** verify lost ack and expiry, restart while paused/in a claim, private/public isolation and concurrent admissions. **Frontend:** run the touch spike and a browser match with reconnect and settlement. **Infra:** exercise the local sequence and clean publish, run both .NET test projects and Playwright engines in CI, and verify persistent container restart on a host with a daemon.
