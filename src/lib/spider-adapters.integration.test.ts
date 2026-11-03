import { describe, expect, it } from 'vitest';
import { getEnvSources } from './env-sources';
import { is4kGuluToken, is4kLineLabel, isAllowedOrangeLine, spiderDetail, spiderResolvePlay, spiderSearch } from './spider-adapters';

async function probeMediaUrl(proxyOrDirectUrl: string) {
  const parsed = new URL(proxyOrDirectUrl, 'https://libretv.test');
  let target = proxyOrDirectUrl;
  let headers: Record<string, string> = {};
  if (parsed.pathname === '/api/proxy') {
    target = parsed.searchParams.get('url') || '';
    const token = parsed.searchParams.get('headers');
    if (token) headers = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  }
  expect(target, 'resolved media URL').toMatch(/^https?:\/\//i);
  const response = await fetch(target, {
    headers: { ...headers, Range: 'bytes=0-2047' },
    signal: AbortSignal.timeout(10000),
  });
  expect(response.ok || response.status === 206, 'upstream media request should succeed').toBe(true);
  const reader = response.body?.getReader();
  const first = await reader?.read();
  await reader?.cancel();
  expect(first?.value?.length || 0, 'upstream should return media bytes').toBeGreaterThan(0);
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const prefix = new TextDecoder().decode(first!.value!.subarray(0, 64)).trimStart();
  const mediaLike =
    /mpegurl|video|mp2t|octet-stream|application\/mp4|application\/dash\+xml/.test(contentType) ||
    prefix.startsWith('#EXTM3U') || prefix.slice(4, 8) === 'ftyp';
  expect(mediaLike, `expected a media response, got ${contentType || prefix.slice(0, 32)}`).toBe(true);
}

const enabled = process.env.RUN_SPIDER_INTEGRATION === '1';
const sources = getEnvSources().filter(source => source.adapter === 'gulu' || source.adapter === 'appdrama');

describe.skipIf(!enabled)('live TVBox Spider integration', () => {
  it.each(sources.map(source => [source.name, source] as const))('%s can search and resolve a playable detail', async (_name, source) => {
    const results = await spiderSearch(source, '嫁金钗', 1);
    expect(results.length, 'search should return at least one title').toBeGreaterThan(0);
    const match = results.find(item => item.name.includes('嫁金钗')) || results[0];
    let detail;
    try {
      detail = await spiderDetail(source, match.vodId);
    } catch (err) {
      // 用户要求严格 4K only：当前标题没有 4K 线路时，正确行为是拒绝回退到普通线路。
      expect(err instanceof Error ? err.message : String(err)).toContain('4K');
      console.info(`${source.name}: ${match.name} 当前没有 4K 线路，已正确拒绝普通线路回退`);
      return;
    }
    expect(detail.episodes.length, 'detail should contain at least one 4K playable URL').toBeGreaterThan(0);
    if (source.adapter === 'appdrama') {
      for (const episode of detail.episodes) {
        const params = new URL(episode, 'https://libretv.test').searchParams;
        const token = params.get('payload') || '';
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as { vodPlayFrom?: string; playUrl?: string };
        expect(isAllowedOrangeLine(decoded.vodPlayFrom || ''), 'Orange Juice episode must belong to 自建4K-3 or VIP4K').toBe(true);
      }
    } else {
      for (const episode of detail.episodes) {
        if (!episode.startsWith('/api/spider-play?')) continue;
        const params = new URL(episode, 'https://libretv.test').searchParams;
        expect(is4kGuluToken(params.get('token') || ''), 'Gulu episode must use a 4K token').toBe(true);
      }
    }
    const pending = detail.episodes.find(url => url.startsWith('/api/spider-play?'));
    if (pending) {
      const params = new URL(pending, 'https://libretv.test').searchParams;
      const token = params.get('payload') || params.get('token') || '';
      const resolved = await spiderResolvePlay(source, token);
      expect(resolved.startsWith('/api/proxy?')).toBe(true);
      await probeMediaUrl(resolved);
    } else {
      expect(detail.episodes.every(url => /^https?:\/\//i.test(url) || url.startsWith('/api/proxy?'))).toBe(true);
      await probeMediaUrl(detail.episodes[0]);
    }
  }, 60000);
});
