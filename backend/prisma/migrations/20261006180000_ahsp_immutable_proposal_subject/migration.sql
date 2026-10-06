-- Additive proposal subject. Existing snapshots stay valid: new columns are nullable.
-- No drop, truncate, or destructive delete.

ALTER TABLE "ahsp_snapshots" ADD COLUMN "code" TEXT;
ALTER TABLE "ahsp_snapshots" ADD COLUMN "keterangan" TEXT;
ALTER TABLE "ahsp_snapshots" ADD COLUMN "regulationReference" TEXT;
ALTER TABLE "ahsp_snapshots" ADD COLUMN "issuerInstitution" TEXT;
ALTER TABLE "ahsp_snapshots" ADD COLUMN "ownershipType" "OwnershipType";

CREATE TABLE "ahsp_snapshot_classification_assignments" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "leafNodeId" UUID NOT NULL,
    "provenance" "AhspClassificationAssignmentProvenance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ahsp_snapshot_classification_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ahsp_snapshot_classification_assignments_snapshotId_assignmentId_key"
  ON "ahsp_snapshot_classification_assignments"("snapshotId", "assignmentId");
CREATE INDEX "ahsp_snapshot_classification_assignments_snapshotId_idx"
  ON "ahsp_snapshot_classification_assignments"("snapshotId");
CREATE INDEX "ahsp_snapshot_classification_assignments_leafNodeId_idx"
  ON "ahsp_snapshot_classification_assignments"("leafNodeId");

ALTER TABLE "ahsp_snapshot_classification_assignments"
  ADD CONSTRAINT "ahsp_snapshot_classification_assignments_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "ahsp_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ahsp_snapshot_classification_assignments"
  ADD CONSTRAINT "ahsp_snapshot_classification_assignments_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "ahsp_classification_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ahsp_snapshot_classification_assignments"
  ADD CONSTRAINT "ahsp_snapshot_classification_assignments_leafNodeId_fkey"
  FOREIGN KEY ("leafNodeId") REFERENCES "construction_classification_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ahsps" ADD COLUMN "proposalSnapshotId" UUID;
CREATE UNIQUE INDEX "ahsps_proposalSnapshotId_key" ON "ahsps"("proposalSnapshotId");
ALTER TABLE "ahsps"
  ADD CONSTRAINT "ahsps_proposalSnapshotId_fkey"
  FOREIGN KEY ("proposalSnapshotId") REFERENCES "ahsp_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
