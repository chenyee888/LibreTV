import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { getEnvSources } from '@/lib/env-sources';
import { spiderResolvePlay } from '@/lib/spider-adapters';

export const runtime = 'nodejs';

/**
 * Resolve one selected TVBox Spider episode on demand.
 * The returned URL is a same-origin authenticated proxy URL so upstream
 * headers can be applied server-side and HLS child segments inherit them.
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const sourceKey = params.get('source') || '';
  const token = params.get('payload') || params.get('token') || '';
  if (!token || token.length > 20_000) {
    return NextResponse.json({ error: '无效的 Spider 播放参数' }, { status: 400 });
  }

  const source = getEnvSources().find(item => item.key === sourceKey &&
    (item.adapter === 'gulu' || item.adapter === 'appdrama'));
  if (!source) {
    return NextResponse.json({ error: 'Spider 源未在服务器端启用' }, { status: 400 });
  }

  try {
    const proxyUrl = await spiderResolvePlay(source, token);
    return NextResponse.redirect(new URL(proxyUrl, req.url), {
      status: 307,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Spider 播放地址解析失败' },
      { status: 502 }
    );
  }
}
