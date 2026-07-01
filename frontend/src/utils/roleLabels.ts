export function formatRoleLabel(roleCode: string): string {
  switch (roleCode) {
    case 'DIRECTOR':
      return 'Direktur';
    case 'FOREMAN':
      return 'Mandor';
    case 'ACCEPTANCE_MEMBER':
      return 'Anggota Acceptance';
    default:
      return roleCode;
  }
}
