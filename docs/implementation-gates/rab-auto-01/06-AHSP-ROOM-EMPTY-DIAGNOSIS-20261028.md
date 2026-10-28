# RAB-AUTO-01 — Root AHSP Room Empty-State Observation (2026-10-28)

## Owner screenshot
The authenticated-looking `localhost:5173/ahsp` page shows source 'Semua', all category filters 'Semua', empty search, and 'Belum ada AHSP yang tersedia dalam workspace ini.'

## Source audit against main-derived isolated baseline
- `frontend/src/pages/AhspRoomPage.tsx` uses `apiFetch('/ahsp')`.
- If HTTP is not successful, it enters FAILED and shows a network/auth error. In READY state, any non-array successful JSON payload is silently converted to `[]` (`Array.isArray(data) ? data : []`).
- The screenshot empty-state condition is `allRows.length === 0`, BEFORE classification, owner source, pagination, and free-text filters. Thus visible filters are not the reason the empty notice appears.
- `backend/src/ahsp/ahsp.controller.ts` `@Get()` `@Permissions('AHSP_VIEW')` obtains trusted workspaceContext.workspaceId.
- `backend/src/ahsp/services/ahsp.service.ts` `list(workspaceId)` selects nondeleted AHSP parent rows with `OR: [{ workspaceId }, { workspaceId: null }]`, so it includes current-workspace private and shared catalog AHSP, not just local/private rows. It does NOT apply the strict RAB eligible-version prerequisites.
- In contrast the RAB eligible list requires complete version/resources, dates and catalog/publication vs own-private lifecycle; its emptiness is a distinct question.

## Narrow root cause decision tree
1. Browser GET /ahsp 200 + []: correct *visible* list absence for that trusted workspace+global scope at that moment. Still not proof that import journals, source documents, historical deleted data, or other workspaces are absent.
2. Browser GET /ahsp 200 + object/other nonarray: UI defect, 'ready empty' is untruthful; reconcile backend response shape, DO NOT import to mask.
3. GET /ahsp non-2xx: normally source UI shows FAILED; screenshot not enough to read status.
4. Nonempty GET /ahsp response but empty screen: investigate differing runtime bundle, route stale state, or frontend issue; don't assert no records.

## Next evidence and protection
- Single authenticated Chrome Network request: F12 > Network > Fetch/XHR > refresh /ahsp > choose GET /ahsp; inspect **Status** and response **shape/count**. Avoid sharing JWT, cookies, or Authorization headers.
- No new AHSP import, no arbitrary manual AHSP linking, no Basic Price rework, no schema write, no main merge.
- Maintain AHSP track ownership for any fix to root AHSP list; RAB-AUTO-01 owns only visibility of honest RAB exceptions.

VERDICT: screenshot empty state confirmed. Backend row absence or malformed response NOT YET PROVED; HTTP/JSON authenticated evidence pending.
