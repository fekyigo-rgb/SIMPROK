import { ConstructionClassificationLevel } from '@prisma/client';

/**
 * Normalize a classification display name for identity / search.
 * Pattern reference: UnitKernel `normalizeUnitAlias` (NFKC + lower + collapse).
 */
export function normalizeClassificationName(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ');
}

export const CLASSIFICATION_PARENT_LEVEL: Record<
  ConstructionClassificationLevel,
  ConstructionClassificationLevel | null
> = {
  [ConstructionClassificationLevel.JENIS_PENGADAAN]: null,
  [ConstructionClassificationLevel.KATEGORI]:
    ConstructionClassificationLevel.JENIS_PENGADAAN,
  [ConstructionClassificationLevel.SUBKATEGORI]:
    ConstructionClassificationLevel.KATEGORI,
  [ConstructionClassificationLevel.JENIS_PEKERJAAN]:
    ConstructionClassificationLevel.SUBKATEGORI,
};

export type ClassificationLineageViolation =
  | 'ROOT_MUST_HAVE_NULL_PARENT'
  | 'NON_ROOT_REQUIRES_PARENT'
  | 'PARENT_LEVEL_MISMATCH'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_INACTIVE'
  | 'PARENT_NOT_VISIBLE_IN_SCOPE'
  | 'GLOBAL_CHILD_REQUIRES_GLOBAL_PARENT'
  | 'WORKSPACE_CHILD_PARENT_SCOPE_FORBIDDEN'
  | 'EMPTY_NAME'
  | 'UNKNOWN_LEVEL';

export function requiredParentLevel(
  level: ConstructionClassificationLevel,
): ConstructionClassificationLevel | null {
  return CLASSIFICATION_PARENT_LEVEL[level];
}

export function assertLawfulParentRelation(input: {
  level: ConstructionClassificationLevel;
  parent: {
    id: string;
    level: ConstructionClassificationLevel;
    isActive: boolean;
    workspaceId: string | null;
  } | null;
  /** Scope of the node being created: null = GLOBAL. */
  workspaceId: string | null;
}): ClassificationLineageViolation | null {
  const expectedParent = requiredParentLevel(input.level);

  if (expectedParent === null) {
    if (input.parent !== null) {
      return 'ROOT_MUST_HAVE_NULL_PARENT';
    }
    return null;
  }

  if (input.parent === null) {
    return 'NON_ROOT_REQUIRES_PARENT';
  }

  if (!input.parent.isActive) {
    return 'PARENT_INACTIVE';
  }

  if (input.parent.level !== expectedParent) {
    return 'PARENT_LEVEL_MISMATCH';
  }

  // Visibility: parent must be GLOBAL or same workspace.
  if (
    input.parent.workspaceId !== null &&
    input.parent.workspaceId !== input.workspaceId
  ) {
    return 'PARENT_NOT_VISIBLE_IN_SCOPE';
  }

  // GLOBAL child may only hang under GLOBAL parent (no workspace→global promotion
  // by attaching a global child under a workspace parent — also blocked above).
  if (input.workspaceId === null && input.parent.workspaceId !== null) {
    return 'GLOBAL_CHILD_REQUIRES_GLOBAL_PARENT';
  }

  // Workspace custom under a parent from another workspace is already covered;
  // workspace custom under GLOBAL parent is lawful.
  if (
    input.workspaceId !== null &&
    input.parent.workspaceId !== null &&
    input.parent.workspaceId !== input.workspaceId
  ) {
    return 'WORKSPACE_CHILD_PARENT_SCOPE_FORBIDDEN';
  }

  return null;
}

export function visibilityWhere(workspaceId: string) {
  return {
    isActive: true as const,
    OR: [{ workspaceId: null }, { workspaceId }],
  };
}
