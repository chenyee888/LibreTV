import { describe, expect, it } from 'vitest';
import { getEnvSources } from './env-sources';
import { spiderDetail, spiderResolvePlay, spiderSearch } from './spider-adapters';

const enabled = process.env.RUN_SPIDER_INTEGRATION === '1';
const sources = getEnvSources().filter(source => source.adapter === 'gulu' || source.adapter === 'appdrama');

describe.skipIf(!enabled)('live TVBox Spider integration', () => {
  it.each(sources.map(source => [source.name, source] as const))('%s can search and resolve a playable detail', async (_name, source) => {
    const results = await spiderSearch(source, '三体', 1);
    expect(results.length, 'search should return at least one title').toBeGreaterThan(0);
    const detail = await spiderDetail(source, results[0].vodId);
    expect(detail.episodes.length, 'detail should contain at least one direct playable URL').toBeGreaterThan(0);
    const pending = detail.episodes.find(url => url.startsWith('/api/spider-play?'));
    if (pending) {
      const params = new URL(pending, 'https://libretv.test').searchParams;
      const token = params.get('payload') || params.get('token') || '';
      const resolved = await spiderResolvePlay(source, token);
      expect(resolved.startsWith('/api/proxy?')).toBe(true);
    } else {
      expect(detail.episodes.every(url => /^https?:\/\//i.test(url) || url.startsWith('/api/proxy?'))).toBe(true);
    }
  }, 60000);
});
