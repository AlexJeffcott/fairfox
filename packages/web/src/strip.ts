export function strip(req: Request, prefix: `/${string}`): Request {
  const u = new URL(req.url);
  const p = u.pathname;
  if (p !== prefix && !p.startsWith(`${prefix}/`)) {
    return req;
  }
  u.pathname = p.slice(prefix.length) || '/';
  return new Request(u, req);
}
