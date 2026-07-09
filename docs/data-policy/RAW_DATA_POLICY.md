# SIMPROK Raw Data Policy

## Status

Raw Owner input files are local evidence/artifacts, not normal application source code.

## Current Local Artifacts

- data/first-real-input/
- first-real-input-files/
- first-real-input-files.zip

## Policy

- Do not commit raw Excel/zip files by default.
- Keep data/first-real-input/ locally as source-of-truth candidate until Owner/PM decides an approved sample strategy.
- Treat first-real-input-files/ as duplicate extracted files.
- Treat first-real-input-files.zip as a transport/archive artifact.
- If a raw file must become an official sample, it must be committed in a separate explicit Owner-approved slice.
- Do not delete raw files without Owner approval.

## Reason

This prevents:
- accidental sensitive data commits
- binary repository bloat
- duplicate source confusion
- repeated untracked git noise

## Faith Closing

Soli Deo Gloria. Haleluya. Amin.
