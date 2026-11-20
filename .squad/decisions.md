# Squad Decisions

## Active Decisions

### 2026-11-19T22-38-44: Approve the initial Changsha architecture and protocol v1 for implementation
**By:** lead
**What:** Approve the initial Changsha architecture and protocol v1 for implementation
**References:** docs/architecture.md, docs/protocol.md, Rules, Backend, Frontend, Infra
**Why:** Use one ASP.NET Core/.NET 10 process, native WebSocket, durable signed guest cookie, and an EF Core SQLite room executor/checkpoint. Publish recipient-specific committed snapshots; use independent room/game revisions, stable decision-window anchors, and expiring durable command receipts. Rules owns deterministic Changsha behavior and source reconciliation; Frontend owns the provisional DOM/CSS 3D spike and Chromium/WebKit touch validation; Infra owns the root deployment and servicing pins. The implementation interfaces and acceptance gates are in docs/architecture.md and docs/protocol.md; rule and visual fidelity remain unverified.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
