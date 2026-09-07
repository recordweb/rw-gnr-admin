// api.js - thin fetch wrapper for the backend REST API.
// Every namespace-related call takes an explicit `network` ('test' | 'prod')
// and appends it as a query parameter - network selection is stateless on
// the wire; the caller (dashboard.js) is responsible for remembering the
// user's current choice (sessionStorage) and passing it in each time.
// Translates HTTP errors into an Error carrying `.status`, `.errorCode`, and
// `.message`, so callers can build precise, code-driven UI messages instead
// of guessing from the HTTP status alone.

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Server unreachable. Is the backend running?');
  }

  const text = await response.text();
  const data = text ? safeJson(text) : null;

  if (!response.ok) {
    const err = new Error(
      (data && data.message) || `Request failed (HTTP ${response.status})`,
    );
    err.status = response.status;
    err.errorCode = data?.errorCode ?? 'UNKNOWN_ERROR';
    throw err;
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function withNetwork(path, network) {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}network=${encodeURIComponent(network)}`;
}

export const api = {
  getConfig: () => request('GET', 'api/config'),
  getHealth: () => request('GET', 'api/health'),

  listNamespaces: (network) => request('GET', withNetwork('api/namespaces', network)),
  getNamespace: (network, namespace) =>
    request('GET', withNetwork(`api/namespaces/${encodeURIComponent(namespace)}`, network)),
  getHistory: (network, namespace) =>
    request('GET', withNetwork(`api/namespaces/${encodeURIComponent(namespace)}/history`, network)),
  registerNamespace: (network, resolverEndpoint) =>
    request('POST', withNetwork('api/namespaces', network), { resolverEndpoint }),
  updateResolverEndpoint: (network, namespace, resolverEndpoint) =>
    request('PUT', withNetwork(`api/namespaces/${encodeURIComponent(namespace)}`, network), {
      resolverEndpoint,
    }),
};
