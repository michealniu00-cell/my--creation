import { describe, expect, it } from 'vitest';
import { readScriptSections } from './script-sections';

describe('script reading view', () => {
  it('exposes full narration and visual instructions in source order', () => {
    const sections = [
      {
        sectionTitle: '开场',
        narration: '完整口播',
        visuals: '画面',
        keyBeat: '节奏',
        transitionToNext: '转场',
      },
      { narration: '结尾' },
    ];
    expect(readScriptSections({ scriptSections: sections })).toEqual([
      sections[0],
      {
        sectionTitle: '段落 2',
        narration: '结尾',
        visuals: '',
        keyBeat: '',
        transitionToNext: '',
      },
    ]);
  });
  it('handles legacy and malformed output without inventing content', () => {
    expect(readScriptSections({})).toEqual([]);
    expect(
      readScriptSections({
        scriptSections: [null, [], 'text', { narration: {} }],
      }),
    ).toEqual([]);
  });
  it('keeps source text unchanged, including markup, for escaped React rendering', () => {
    const source = {
      scriptSections: [{ narration: '<script>alert(1)</script>\n原文' }],
    };
    expect(readScriptSections(source)[0].narration).toBe(
      source.scriptSections[0].narration,
    );
  });
});
