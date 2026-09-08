import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAhspProposalStatus,
  canProposeAhsp,
  formatIndoDate,
} from "./ahspProposalStatus.ts";

test("status reads in plain Indonesian, never an enum", () => {
  assert.equal(describeAhspProposalStatus({ proposedAt: null, reviewStatus: 'PENDING' }), 'Belum diusulkan');
  assert.equal(describeAhspProposalStatus({ proposedAt: '2026-08-25T00:00:00Z', reviewStatus: 'PENDING' }), 'Sedang ditinjau');
  assert.equal(describeAhspProposalStatus({ proposedAt: '2026-08-25', reviewStatus: 'APPROVED' }), 'Diterima');
  assert.equal(describeAhspProposalStatus({ proposedAt: '2026-08-25', reviewStatus: 'REJECTED' }), 'Ditolak');
});

test("only a workspace-owned, un-proposed, un-accepted AHSP may be proposed", () => {
  assert.equal(canProposeAhsp({ ownershipType: 'USER_ASSET', proposedAt: null, reviewStatus: 'PENDING' }), true);
  assert.equal(canProposeAhsp({ ownershipType: 'USER_ASSET', proposedAt: '2026-08-25', reviewStatus: 'PENDING' }), false);
  assert.equal(canProposeAhsp({ ownershipType: 'USER_ASSET', proposedAt: null, reviewStatus: 'APPROVED' }), false);
  assert.equal(canProposeAhsp({ ownershipType: 'SIMPROK_ASSET', proposedAt: null, reviewStatus: 'PENDING' }), false);
});

test("dates render as Indonesian long form", () => {
  assert.equal(formatIndoDate('2026-08-12T00:00:00.000Z'), '12 Agustus 2026');
  assert.equal(formatIndoDate('2026-08-25'), '25 Agustus 2026');
  assert.equal(formatIndoDate(null), '—');
  assert.equal(formatIndoDate(undefined), '—');
});
