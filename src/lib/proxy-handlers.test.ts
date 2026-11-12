import { describe, expect, it, vi } from 'vitest';
import { handleProxyRequest } from './proxy-handlers';

const mocks = vi.hoisted(() => ({ fetchWithSafeRedirects: vi.fn() }));
vi.mock('./api-guard', () => ({
  guardRequest: () => null,
  jsonError: (message: string, status: number) => new Response(JSON.stringify({ error: message }), { status }),
}));
vi.mock('./ssrf', () => ({
  checkLiveUrlAllowed: () => Promise.resolve({ ok: true }),
  isBlockedByDNS: () => Promise.resolve(false),
  isValidProxyUrl: () => true,
}));
vi.mock('./fetch-utils', () => ({ fetchWithSafeRedirects: mocks.fetchWithSafeRedirects }));

function mockUpstream(body: string, status = 200, contentType = 'application/vnd.apple.mpegurl') {
  mocks.fetchWithSafeRedirects.mockResolvedValue({
    res: new Response(body, { status, headers: { 'Content-Type': contentType } }),
    finalUrl: 'https://cdn.test/x/index.m3u8',
  });
}

const M3U8_URL = 'https://cdn.test/x/index.m3u8';
const TS_URL = 'https://cdn.test/x/seg0.ts';

function reqFor(target: string): Request {
  return new Request(`https://libretv888.netlify.app/api/proxy?url=${encodeURIComponent(target)}`);
}

describe('handleProxyRequest m3u8 守卫', () => {
  it('上游 403 返回 HTML 报错页：不重写成垃圾清单，直接透传状态码给 JSON 错误', async () => {
    mockUpstream('<!doctype html><html lang="zh-CN"><head><title>403</title>', 403, 'text/html');
    const res = await handleProxyRequest(reqFor(M3U8_URL), M3U8_URL);
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.text();
    expect(body).toContain('403');
    expect(body).not.toContain('/api/proxy?url=');
  });

  it('上游 200 但内容不是清单：返回 502 JSON，不发 mpegurl', async () => {
    mockUpstream('Payment required\n\nDEPLOYMENT_DISABLED\n', 200, 'text/plain');
    const res = await handleProxyRequest(reqFor(M3U8_URL), M3U8_URL);
    expect(res.status).toBe(502);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('正常清单：重写分片为代理地址，且 no-store', async () => {
    mockUpstream('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nseg0.ts\n');
    const res = await handleProxyRequest(reqFor(M3U8_URL), M3U8_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.text();
    expect(body.startsWith('#EXTM3U')).toBe(true);
    expect(body).toContain('/api/proxy?url=');
  });
});

describe('handleProxyRequest 不再 public 缓存', () => {
  it('分片透传：Cache-Control 是 no-store，不是 public,max-age=3600', async () => {
    mocks.fetchWithSafeRedirects.mockResolvedValue({
      res: new Response('fake-ts-bytes', { status: 200, headers: { 'Content-Type': 'video/MP2T' } }),
      finalUrl: TS_URL,
    });
    const res = await handleProxyRequest(reqFor(TS_URL), TS_URL);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/MP2T');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Netlify-Vary')).toBe('query');
  });
});
