import { describe, expect, it } from 'vitest';
import { getPublicOrigin } from './request-origin';

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('getPublicOrigin', () => {
  it('优先用 x-forwarded-host / x-forwarded-proto（Netlify 转发后的公开域名）', () => {
    const origin = getPublicOrigin(
      req('https://main--libretv888.netlify.app/api/spider-play', {
        'x-forwarded-host': 'libretv888.netlify.app',
        'x-forwarded-proto': 'https',
      })
    );
    expect(origin).toBe('https://libretv888.netlify.app');
  });

  it('没有转发头时用 host 头', () => {
    const origin = getPublicOrigin(
      req('https://main--libretv888.netlify.app/api/spider-play', {
        host: 'libretv888.netlify.app',
      })
    );
    expect(origin).toBe('https://libretv888.netlify.app');
  });

  it('两个头都没有时退回 req.url 自身 origin', () => {
    const origin = getPublicOrigin(req('https://main--libretv888.netlify.app/api/spider-play'));
    expect(origin).toBe('https://main--libretv888.netlify.app');
  });

  it('多值转发头只取第一个', () => {
    const origin = getPublicOrigin(
      req('http://internal/api/spider-play', {
        'x-forwarded-host': 'libretv888.netlify.app, main--libretv888.netlify.app',
        'x-forwarded-proto': 'https, http',
      })
    );
    expect(origin).toBe('https://libretv888.netlify.app');
  });
});
