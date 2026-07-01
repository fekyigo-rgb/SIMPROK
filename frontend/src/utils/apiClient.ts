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

  const response = await fetch(input, finalInit);
  
  if (response.status === 401 && typeof window !== 'undefined') {
    // Only signals stale session; callers still receive Response and handle page-level errors.
    window.dispatchEvent(new Event('simprok:unauthorized'));
  }

  return response;
}
