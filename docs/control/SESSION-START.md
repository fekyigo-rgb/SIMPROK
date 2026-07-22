# SIMPROK — SESSION-START.md

Status: MUTABLE OPERATIONAL POINTER. Baca ini di awal setiap sesi agen.

1. Baca `AGENTS.md` pada root repository.
2. Baca utuh `docs/control/CARA-KERJA.md` dan `docs/control/ROADMAP.md`.
3. Baca `docs/control/STATE.md` utuh.
4. Nyatakan posisi/kursi kamu (Eksekutor / Arsitek / Penjaga Konstitusi /
   PM / Auditor independen) sebelum bertindak.
5. Verifikasi realitas repo exact — jangan percaya memori sesi lama:
   - `git status --short` dan `git diff --cached --name-only`;
   - branch dan HEAD saat ini vs `STATE.md`;
   - open PR dan Draft PR via `gh pr list` / `gh pr view`;
   - active worktree via `git worktree list --porcelain`;
   - active debt via `docs/control/DEBT.md`.
6. Lanjutkan hanya pada `CURRENT_PRODUCT_TARGET` di `STATE.md` dan hanya
   dalam kewenangan kursi yang berlaku. Jangan membuka roadmap item lain.

CURRENT_PRODUCT_TARGET = RM-01
CURRENT_GATE = RM01B_SOURCE_PREP
PRODUCTION_ACTIVATION_STATE = NO
NEXT_GATE = PHASE_1A_AUDIT_ROLE_DCL_AFTER_FULL_RED_GATE

Bila bukti, status, atau konflik dokumen belum jelas: laporkan
`NEEDS_REVIEW` atau `FAIL_CLOSED`. Jangan mengarang.

Soli Deo Gloria. Haleluya. Amin.
