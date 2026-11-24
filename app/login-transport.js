const transientStatus = status => [408, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(status);

async function exchange(url, options, timeout, fetcher) {
  let response;
  try {
    response = await fetcher(url, {...options, signal:AbortSignal.timeout(timeout)});
    if (response.ok) return await response.json();
  } catch {
    throw Object.assign(Error('登录服务连接中断或响应超时，请检查网络或代理连接后重试。'), {temporary:true});
  }
  const data = await response.json().catch(() => ({}));
  let message = '登录服务暂时不可用，请稍后重试。';
  if (response.status === 401) message = url.pathname === '/auth/login/v2' ? '密码验证未通过，请重新输入。' : '登录已过期，请重新登录。';
  if (response.status === 429) message = '密码尝试次数过多，请稍后重试。';
  throw Object.assign(Error(data?.detail || message), {
    status:response.status, retryAfter:response.status === 429 ? data?.retryAfter || Number(response.headers.get('Retry-After')) : undefined,
    temporary:transientStatus(response.status),
  });
}

// The versioned login endpoint deduplicates a repeated submission. Other POSTs
// (including password verification on an existing session) remain single-shot.
export function loginTransport(endpoint, fetcher = fetch) {
  const base = new URL('/auth/', endpoint);
  return async (action, {body, token, keepalive=false, onRetry} = {}) => {
    const url = new URL(action, base);
    const method = body ? 'POST' : 'GET';
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const isLogin = action === 'login/v2' && method === 'POST';
    const payload = isLogin ? {...body, attemptId:crypto.randomUUID()} : body;
    const options = {method, headers, body:payload && JSON.stringify(payload), keepalive,
      credentials:'omit', cache:'no-store', redirect:'error'};
    const canRetry = isLogin || method === 'GET';
    try {
      return await exchange(url, options, canRetry ? 12000 : 30000, fetcher);
    } catch (error) {
      if (!canRetry || !error.temporary) throw error;
      onRetry?.();
      return exchange(url, options, 30000, fetcher);
    }
  };
}
