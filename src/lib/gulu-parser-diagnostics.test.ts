import { describe, expect, it } from 'vitest';
import { getGuluParserDiagnostics } from './spider-adapters';

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
