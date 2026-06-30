export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { includeWorkspace?: boolean; includeAuth?: boolean }
): Promise<Response> {
  const { includeWorkspace = true, includeAuth = true } = options || {};

  const headers = new Headers(init?.headers);

  if (includeAuth) {
    const token = localStorage.getItem('simprok_token');
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  if (includeWorkspace) {
    const workspaceId = localStorage.getItem('simprok_workspace');
    if (workspaceId && workspaceId.trim() !== '' && !headers.has('x-workspace-id')) {
      headers.set('x-workspace-id', workspaceId);
    }
  }

  const finalInit: RequestInit = {
    ...init,
    headers,
  };

  return fetch(input, finalInit);
}
