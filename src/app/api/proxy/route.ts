import { NextResponse } from 'next/server';
import { handleProxyRequest } from '@/lib/proxy-handlers';

export const runtime = 'nodejs';

/**
 * 查询串形式的通用代理：/api/proxy?url=<encodeURIComponent(target)>。
 * 查询串不参与网关路径归一化（EdgeOne 等会把路径里的 %2F 解码成 /），
 * 全平台行为一致；旧路径形式 /api/proxy/<encoded> 仍由 [url] 路由兼容。
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const targetUrl = params.get('url');
  if (!targetUrl) return new NextResponse('缺少 url 参数', { status: 400 });
  let upstreamHeaders: Record<string, string> = {};
  const encodedHeaders = params.get('headers');
  if (encodedHeaders) {
    try {
      const parsed = JSON.parse(Buffer.from(encodedHeaders, 'base64url').toString('utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        upstreamHeaders = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>)
            .filter((entry): entry is [string, string] =>
              typeof entry[1] === 'string' && entry[1].length <= 2048 && !/[\r\n]/.test(entry[1]) &&
              /^(user-agent|referer|origin|authorization|cookie|x-[a-z0-9-]+)$/i.test(entry[0])
            )
        );
      }
    } catch {
      return new NextResponse('无效的 headers 参数', { status: 400 });
    }
  }
  return handleProxyRequest(req, targetUrl, upstreamHeaders);
}
