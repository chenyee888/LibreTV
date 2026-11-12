import { describe, expect, it } from 'vitest';
import { getGuluParserDiagnostics, selectGuluParseTemplates } from './spider-adapters';

describe('Gulu parser diagnostics', () => {
  it('maps a recognized token prefix to its parser label and runtime template', () => {
    expect(getGuluParserDiagnostics('xfy-opaque-token', { '新咕噜4K': 'https://parser.invalid/?key=secret&url=' })).toEqual({
      tokenPrefix: 'xfy-',
      parserLabel: '新咕噜4K',
      templateNames: ['新咕噜4K'],
      templateAvailable: true,
    });
  });

  it('does not guess a parser from the upstream line name for unknown prefixes', () => {
    expect(getGuluParserDiagnostics('opaque-token', { NB4K: 'https://parser.invalid/?key=secret&url=' })).toEqual({
      tokenPrefix: '未知',
      parserLabel: null,
      templateNames: ['NB4K'],
      templateAvailable: false,
    });
  });

  it('reports missing known templates without exposing template URLs', () => {
    const result = getGuluParserDiagnostics('NBY-opaque-token', {});
    expect(result).toEqual({
      tokenPrefix: 'NBY-',
      parserLabel: '蚂蚁',
      templateNames: [],
      templateAvailable: true,
    });
    expect(JSON.stringify(result)).not.toContain('http');
  });

  it('sorts runtime template names for stable diagnostics', () => {
    expect(getGuluParserDiagnostics('unknown', { Zebra: 'x', Alpha: 'y' }).templateNames)
      .toEqual(['Alpha', 'Zebra']);
  });
});

describe('selectGuluParseTemplates', () => {
  it('prefers the runtime template and appends the builtin fallback when they differ', () => {
    // 咖啡4K 的内置备用模板是 co4k.1ljx.com；运行时模板挂掉时要能兜底重试。
    expect(selectGuluParseTemplates('咖啡4K', { '咖啡4K': 'https://runtime.invalid/parse?url=' }))
      .toEqual(['https://runtime.invalid/parse?url=', 'https://co4k.1ljx.com:32010/api/?key=6db7285d-c228-4cee-918e-67a01ef7c3f8&url=']);
  });

  it('does not request the same template twice when runtime equals the fallback', () => {
    expect(selectGuluParseTemplates('咖啡4K', { '咖啡4K': 'https://co4k.1ljx.com:32010/api/?key=6db7285d-c228-4cee-918e-67a01ef7c3f8&url=' }))
      .toEqual(['https://co4k.1ljx.com:32010/api/?key=6db7285d-c228-4cee-918e-67a01ef7c3f8&url=']);
  });

  it('falls back to the builtin template when no runtime template exists', () => {
    expect(selectGuluParseTemplates('咖啡4K', {})).toEqual([
      'https://co4k.1ljx.com:32010/api/?key=6db7285d-c228-4cee-918e-67a01ef7c3f8&url=',
    ]);
  });

  it('returns no candidates without a parser label or any template', () => {
    expect(selectGuluParseTemplates(null, { '咖啡4K': 'https://runtime.invalid/parse?url=' })).toEqual([]);
    expect(selectGuluParseTemplates('未知解析器', {})).toEqual([]);
  });
});
