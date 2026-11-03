import type { SourceConfig } from './types';

/**
 * 部署者通过 DEFAULT_SOURCES 环境变量预置的采集站。
 * 格式为 JSON 数组：[{"name":"源名","url":"https://.../api.php/provide/vod","detail":"https://...","isAdult":false}]
 * 解析失败时告警并整体忽略，不影响站点运行。
 */
export function getEnvSources(): SourceConfig[] {
  const raw = process.env.DEFAULT_SOURCES;
  if (!raw || !raw.trim()) return [
    { key: 'spider_gulu', name: '咕噜', url: 'https://adapter.invalid/gulu', adapter: 'gulu' },
    {
      key: 'spider_orange', name: '橘汁', url: 'https://adapter.invalid/appdrama', adapter: 'appdrama',
      ext: {
        appName: '橘汁',
        publicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCr8SzZhjYy+rsya1K09t8d2K50pWFoBkgUqMpKOiW+3IEVKd4eTdvg9RSOjQ82kypL6R9BnsmrS1V8s4PVDwjQbUtYhTPPC9Hz16qY7rpD6m0d2vr09/UpWQ5uOy9PR0QTrsioveZ+DIe9jc3C+zBCu/kZSY/R8stwJoiitki3gwIDAQAB',
        dataKey: 'ZU1DSFFWNENKMDYXVUQRN0ZJDUC4PQ==',
        dataIv: 'OC1A06E197EF10CF3F6058CA7A803B5E',
        pkg: 'com.asjdhjhd.mgd.p3',
        host: '',
        site: 'https://123-1349250429.cos.ap-shanghai.myqcloud.com/app.txt',
        version: '3.0.7.0',
        decrypt: '1',
      },
    },
  ];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    const list: SourceConfig[] = parsed.map((item, i) => {
      if (typeof item !== 'object' || item === null) {
        throw new Error(`第 ${i + 1} 项不是对象`);
      }
      const { name, url, detail, isAdult, adapter, ext } = item as Record<string, unknown>;
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error(`第 ${i + 1} 项缺少 name`);
      }
      if (typeof url !== 'string' || !/^https?:\/\//.test(url.trim())) {
        throw new Error(`第 ${i + 1} 项的 url 必须以 http:// 或 https:// 开头`);
      }
      return {
        key: `env_${i}`,
        name: name.trim(),
        url: url.trim().replace(/\/+$/, ''),
        detail: typeof detail === 'string' && detail.trim() ? detail.trim() : undefined,
        isAdult: isAdult === true,
        ...(adapter === 'gulu' || adapter === 'appdrama' ? { adapter } : {}),
        ...(adapter === 'appdrama' && ext && typeof ext === 'object' ? { ext: ext as Record<string, string> } : {}),
      };
    });
    return list;
  } catch (err) {
    console.warn('[LibreTV] DEFAULT_SOURCES 解析失败，已忽略：', err instanceof Error ? err.message : err);
    return [];
  }
}
