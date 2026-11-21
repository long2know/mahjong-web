# Mahjong web protocol v1

Hosted at origin root. Wire names below are exact: camelCase JSON, UTF-8 text WebSocket messages, UTC RFC 3339 timestamps (`Z`), and nonnegative JS-safe integer revisions. No state/delta inference from a command ack; only snapshots replace rendered state.

## HTTP

| Route | Contract |
|---|---|
| `GET /` | Built client. WebSocket URLs use this origin (`ws:` or `wss:`); no base path. |
| `POST /api/guest` | Same-origin JSON `{displayName?: string}`. Create a guest if no valid cookie, otherwise return the existing guest unchanged. `200` with the guest DTO below. Default name `"Guest"`. |
| `PATCH /api/profile` | Same-origin, signed guest required. JSON `{displayName?,preferences?:{sound,music,volume,reducedMotion}}`; omitted fields stay unchanged. `200` with the updated guest DTO. |
| `GET /api/rooms` | Guest required. `200 {rooms:[{roomId,occupiedSeats,matchHands}]}` for public `waiting` rooms with an open seat only; at most 64. No guest names, invite rooms or invite codes. |
| `GET /health/live` | `200 {"status":"live"}` once HTTP can serve. |
| `GET /health/ready` | `200 {"status":"ready"}` after migrations and checkpoint recovery and while SQLite is usable; otherwise `503 {"status":"notReady"}`. |
| `GET /api/version` | `200 {appVersion,protocolVersion:1,commitSha}`. Build supplies a version string and full Git SHA, or `"unknown"` for a local build without SHA metadata. |
| `GET /ws` | Same-origin WebSocket upgrade. Reject invalid guest with HTTP `401`, mismatched/missing `Origin` with `403`; check against the configured serving origin. |

Guest DTO: `{displayName,preferences:{sound,music,volume,reducedMotion},resumeRoomId}`. `sound`, `music` and `reducedMotion` are booleans; `volume` is a finite number in `[0,1]`. Defaults are `true`, `false`, `0.7`, `false`, respectively. A submitted `preferences` object includes all four fields. Store preferences with the guest and return them only to that guest. Trim names and require 1–24 characters without controls; publish a changed seat name via the room executor when seated. `resumeRoomId` is a string or `null` and identifies only the caller's membership, including an invite membership.

API responses are `Cache-Control: no-store`; HTTP errors use `{error:{code}}` (`400 invalid_request`, `401 not_authenticated`, `403 forbidden`, `429 busy`). Cookie `mahjong_guest` is a signed/Data Protection-protected guest reference: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` under HTTPS (HTTP only for local development), 30-day lifetime. A valid cookie and the persisted membership authorize a seat, never a seat number supplied by a client. No access tokens or invite codes in URLs; no guest IDs, credentials, chat text, private payloads or names in logs.

## Realtime envelope

Each message is one JSON object. Client sends:

```text
{v:1,type:"renewLease"}
{v:1,type:"sync",requestId,roomId}
{v:1,type:"command",requestId,lease,op,payload}
```

Server sends:

```text
{v:1,type:"lease",lease,expiresAtUtc,serverTimeUtc}
{v:1,type:"ack",requestId,status,error,roomId,roomRevision,gameRevision}
{v:1,type:"snapshot",roomId,roomRevision,gameRevision,serverTimeUtc,room,game,self}
{v:1,type:"error",error}
```

`requestId` is a client-generated UUID. Server sends a lease on connect and on `renewLease`. `status` is `ok` or `error`; `error` is `null` on success or `{code}` on failure. Ack room ID/revisions are `null` when not applicable or not authorized, otherwise the tuple at the original decision. `sync` authenticates membership, attaches the socket and sends ack then the current snapshot; it does not change revisions and needs no lease. A bad envelope that cannot be correlated gets a message of type `error`; an unsupported `v` gets `error` with code `unsupported_version` and WebSocket close `1002`. Bound inbound messages to 16 KiB, use one writer per socket, and close slow connections with `1013` rather than accumulating snapshots.

### Commands

| `op` | `payload` | Policy |
|---|---|---|
| `createRoom` | `{visibility,matchHands,fillBots?}` | `visibility` is `public` or `invite`, `matchHands` is `1` or `4`. Creator takes seat 0 and is host. Optional boolean `fillBots` defaults to `false`; `true` atomically seats three bots in seats 1–3. |
| `joinRoom` | Exactly one of `{roomId}` or `{inviteCode}` | Public waiting room via ID; invite waiting room via code. Lowest open seat, never a bot's seat. Existing membership reconnects via `sync`. |
| `setReady` | `{roomId,expectedRoomRevision,ready}` | Waiting human marks their own seat. |
| `setBot` | `{roomId,expectedRoomRevision,seat,enabled}` | Waiting host adds a bot in an open seat or removes the bot there. |
| `start` | `{roomId,expectedRoomRevision}` | Waiting host; four occupied seats, every human ready. |
| `setPaused` | `{roomId,expectedRoomRevision,paused}` | Playing host; freezes game clock. Automatically resumes after at most 60 seconds. |
| `choose` | `{roomId,windowId,anchorGameRevision,optionId}` | Current unpaused decision; validate a legal option for the guest's seat. Never post a tile face or a seat. |
| `nextHand` | `{roomId,expectedRoomRevision}` | Any seated human in `betweenHands`; starts next hand with engine's `nextDealerSeat`. |
| `chat` | `{roomId,text}` | Attached human with a persisted seat. Trim to 1–300 characters without controls. At most five accepted messages per guest per room per rolling 10 seconds; ack replays do not count. |
| `rematch` | `{roomId,expectedRoomRevision}` | Complete-room host returns the same seats to `waiting`, clears game and scores, and resets human readiness. |
| `leaveRoom` | `{roomId,expectedRoomRevision}` | Remove the human seat in `waiting` or `complete`. In `playing` or `betweenHands`, detach but reserve the seat for resumption. A network disconnect always reserves the seat. |

Successful create/join binds this socket and yields a snapshot. The newest authenticated socket attached by the room executor wins for that seat. Mark the old socket superseded under the executor before closing it with `4001` (`superseded`); it cannot sync or mutate afterwards, including queued commands not yet applied. Check the active socket under that same executor before each seated mutation. The closed tab must not retry automatically.

Mutations with `expectedRoomRevision` require exact equality; booleans already at the requested value are no-ops when valid. Lobby roster changes reset human readiness; bots are always ready. The host transfers on leave to the lowest occupied human seat, or the room closes if none remain. Rooms admit one membership per guest and at most four seats, all human or one or more humans with bots; no spectators. Cap the server at 64 live rooms. Expire rooms after 24 hours without a successful human subscription or room command. WebSocket/room IDs are not credentials; generate 128-bit random room IDs and separate 96-bit random invite codes, base64url without padding. Unseated callers cannot discover invite rooms by ID, even if they guess it: an unknown ID/code or unentitled lookup returns the same `room_not_found` with no room metadata.

Room status is `waiting → playing → betweenHands → playing … → complete`. `betweenHands` is skipped for the final hand; a draw still counts. `rematch` preserves the room, host, seats, invite and chat, clears pause and the previous hand/settlement, and starts the next match at hand 1 with fresh server-generated seeds. The room's `rulesVersion` is frozen to `"changsha-v1"` for its entire life. If the current room expires, drop the attachment and send `error` with `room_not_found`. A successful leave returns an ack but no snapshot to the leaver; the UI returns to lobby and can offer resumption if the seat was reserved.

Chat is plain text, never markup: take `seat` and `displayName` from the sender at commit time, set `messageId` (opaque string) and `sentAtUtc` at the server, and render as text, not HTML. Keep only the last 30 messages in the room checkpoint, oldest first; no public listing or global history.

Ack error codes: `invalid_request` (including unknown op), `forbidden` (member lacks required role), `room_not_found`, `room_full`, `already_seated`, `invalid_state`, `not_ready`, `stale_room`, `stale_window`, `illegal_option`, `paused`, `rate_limited` (chat quota), `request_conflict`, `request_expired`, `busy` (transient; not recorded).

## Snapshots and windows

Every snapshot is a full projection built from committed state for **one** authorized guest seat. All fields are present unless marked optional; `null` means absent, collections use `[]`.

```text
room = {visibility,status,hostSeat,matchHands,rulesVersion,paused,autoResumeAtUtc,seats,chat}
  seats: four {seat,kind,displayName,ready,connected} in absolute seat order
  kind: "open" | "human" | "bot"; displayName: string | null; ready: boolean
  connected: boolean, true only for a human with an active attached socket
  chat: [{messageId,seat,displayName,text,sentAtUtc}]
self = {seat,inviteCode,hand,drawnTileId,legalOptions}
  inviteCode: string only for the host of an invite room, otherwise null
  hand: [{tileId,face}]; drawnTileId: string | null
  legalOptions: [{optionId,kind,tileIds,faces}]
game = null before first hand of each match, otherwise
  {handNumber,dealerSeat,phase,turnSeat,wallCount,kongRoll,seats,window,settlement}
  phase: "turn" | "claim" | "settled"; turnSeat: seat | null
  kongRoll: null or {seat,dice,lowerDie}, with dice: [integer,integer] in roll order, faces 1–6
  seats: four {seat,concealedCount,discards,melds,revealedTiles,total}
  melds: [{kind,method,fromSeat,tiles}] where kind is "chi" | "peng" | "gang" | "bu",
    method: "open" | "concealed" | "added" | null (not applicable),
    fromSeat: seat | null, tiles: (face | null)[] (four nulls for a concealed kong)
  window: null or {windowId,anchorGameRevision,reason,deadlineUtc,trigger}
    reason: "turn" | "opening" | "discard" | "kong" | "lastTile"
    trigger: null or {seat,faces}, where faces is face[] of public faces (up to two for a kong)
  settlement: null or {reason,nextDealerSeat,sourceSeat,winners,birds,seatResults,transfers?}
    reason: "win" | "draw"; sourceSeat: seat | null
    winners: [{seat,winBy,winningTiles,patterns,winningHand}] where winningTiles is face[]
    winBy: "selfDraw" | "discard" | "robKong"; patterns: [{code,label,points}]
    winningHand: {concealedTiles: face[], melds: [{kind,method,fromSeat,tiles: face[]}]}
    birds: face[]; seatResults: four {seat,delta,total}
    optional transfers: [{fromSeat,toSeat,points,reason}] where reason is "win" | "opening"
```

Faces are suited codes `b1`–`b9` (bamboo), `c1`–`c9` (characters), `d1`–`d9` (dots). `discards` and `revealedTiles` are public face arrays; discards are chronological unclaimed tiles. Legal option `kind` is `discard`, `draw`, `chi`, `peng`, `gang`, `bu`, `hu`, `pass` or `reveal`; `tileIds` references only own hand tiles, `faces` previews involved faces, both arrays possibly empty. Only the server interprets `optionId`; the list is empty when the seat has no pending decision and disabled in the UI while paused. Opponents' hidden faces remain private except for opening evidence, public triggers and terminal winning hands. Nothing exposes the wall order, seed, opponents' tile IDs, unrevealed option choices, guest identifiers or another room.

Seat IDs are absolute (`0`–`3`). Turn order is `(seat + 1) % 4`, displayed counterclockwise: from the viewer's seat at the bottom, offsets `0`, `1`, `2`, `3` are near, right, far, left. Only the discarder’s immediate successor may Chow (`chi`), so the meld’s `fromSeat` is the claimant’s left neighbor. Seat references on the wire remain absolute.

`kongRoll` is non-null only during the replacement turn after a committed Gang. `seat` identifies the player who made the Gang, and `lowerDie` is the smaller face used to pick the replacement stack. Choosing the legal `gang` option requests the roll, with no separate command. A pending rob, Bu, ordinary draws, and any subsequent discard claim do not show a roll.

Settlement points/deltas/totals are signed integers; totals accumulate across hands, and per-hand deltas sum to zero. `sourceSeat` is null for self-draw or draw. `nextDealerSeat` is a seat (even at match end); a draw has no winners. The current engine emits `transfers` from scoring; pass through the actual breakdown, never synthesize it from net scores. Each transfer moves positive integer `points` from payer to recipient, and per-seat net transfers must match the deltas.

Only a committed win projects a `winningHand` for each winner. Display `winningTiles` (the event tile) separately: `concealedTiles` excludes only the actual self-drawn tile, or is the winner's unchanged concealed hand for discard or rob wins. Multiple winners each display their own hand and the same public event tile. The winner's melds use the seat meld metadata but show all faces, including all four in a concealed kong. `game.seats[].melds` stays redacted for concealed kongs, even after settlement.

- New room starts at `(roomRevision,gameRevision)=(1,0)`. Advance `roomRevision` once for changed roster/readiness/pause/status, seat name or committed chat. Advance `gameRevision` once per committed engine transition including starting a hand, and once on rematch to clear the game; neither resets. `rematch` advances both. No changes for a retry, ordinary reconnect, transient `connected` change or ticking clock. Publish latest presence on equal-revision snapshots; accept those in socket delivery order.
- Anchor a window to the `gameRevision` that first exposed its `windowId`; wire window IDs are unique for the room lifetime, including rematches. Intermediate claim responses may advance `gameRevision` without changing that window's anchor or another seat's options. Each seat responds at most once per window. `choose` checks the **window ID and anchor**, not the latest room/game revision. A replaced, resolved or elapsed window rejects as `stale_window`, even if the same face has since appeared.
- Default limits: 30 seconds for a turn, 8 seconds for a claim; shorter limits only in test hosts. Use UTC minus accumulated paused time for the engine clock, frozen while paused. `deadlineUtc` is null while paused, otherwise the projected UTC deadline; `autoResumeAtUtc` is null when not paused. Pause/resume changes neither the engine revision nor the window anchor. Resolve due timers before commands; deadline is exclusive for choices and inclusive for expiration. On restart use persisted time/anchors (auto-resume at the scheduled time if overdue). Bots and timeouts never bypass the rules reducer.

## Commit, idempotency and recovery

Each signed lease binds a random lease ID and 10-minute expiry to the guest. Renew before expiry; old leases remain valid until their own expiry, including on a new socket. For a live lease, persist the command's semantic fingerprint and final ack under `(guest,leaseId,requestId)` in the same transaction as any mutation. Check it **before** re-validating window or room revision: identical retry replays the original ack, differing payload/op yields `request_conflict`. A replay never re-applies, re-attaches an obsolete socket or re-attaches a member who left; a `leaveRoom` retry never sends a snapshot. Keep receipts through expiry, even if their rooms are deleted. Reject an expired lease before receipt lookup as `request_expired`; atomically persist a monotonic prune cutoff when deleting expired receipts and use `max(server UTC, cutoff)` for expiry, so clock rollback cannot revalidate a deleted request.

If the sender is still entitled to a snapshot, its ack precedes that snapshot; other entitled sockets receive a fresh snapshot after commit. The client's latest authoritative tuple only moves componentwise forward within the same room. After reconnect, invoke `POST /api/guest` if needed to discover `resumeRoomId`, `sync` to it, and retry a pending command only with its **original** lease, request ID and payload. If the old lease is expired, use the synced state; never silently reissue the old intent under a new ID/lease. In case of an ack newer than the last snapshot or a stale error, use `sync` if the fresh snapshot does not arrive. Do not advance the rendered state on an ack alone.
