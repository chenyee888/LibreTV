/**
 * 面向客户端的公开源地址。
 *
 * Next.js Route Handler 里的 `req.url` 在 Netlify 这类平台上是函数内部的
 * 转发地址（例如 `https://main--libretv888.netlify.app/...`），不是用户在
 * 浏览器里访问的公开域名。用它拼 307 重定向会把浏览器带到另一个 origin：
 * 会话 cookie 是 host-only，不会跟过去，代理路由直接 401，播放器拿到
 * 的就是一张黑屏（hls.js 清单加载失败后还要经过多轮重试才露出错）。
 *
 * 因此拼给客户端的地址必须用反向代理转发的公开 host：
 * `x-forwarded-host` → `host` → `req.url` 自身 host，协议同理。
 * 注意这里只决定“去哪个 host 找本站自己的相对路径”，不接受任意跳转目标。
 */
export function getPublicOrigin(req: Request): string {
  const firstHeader = (name: string): string => {
    const raw = req.headers.get(name);
    if (!raw) return '';
    return raw.split(',')[0]?.trim() || '';
  };
  const host =
    firstHeader('x-forwarded-host') ||
    firstHeader('host') ||
    new URL(req.url).host;
  const proto =
    firstHeader('x-forwarded-proto') ||
    new URL(req.url).protocol.replace(':', '') ||
    'https';
  return `${proto}://${host}`;
}
