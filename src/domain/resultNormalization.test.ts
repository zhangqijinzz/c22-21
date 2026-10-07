import { describe, expect, it } from 'vitest';
import { analyzeRules } from './ruleAnalysis';
import {
  applyResultUnify,
  buildResultSynonyms,
  normalizeResultText,
  planResultUnify,
  sameResultMeaning,
} from './resultNormalization';
import type { BusinessRule, RuleField, RuleProject } from '../models/ruleModel';

describe('normalizeResultText', () => {
  it('treats spacing, separators and full/half-width differences as the same meaning', () => {
    expect(sameResultMeaning('免运费 · 9 折', '免运费·9折')).toBe(true);
    expect(sameResultMeaning('免运费 · 9 折', '免运费·９折')).toBe(true);
    expect(sameResultMeaning('自动通过', '自动 通过')).toBe(true);
    expect(sameResultMeaning('A，B', 'A·B')).toBe(true);
    expect(normalizeResultText('免运费 · 9 折')).toBe('免运费·9折');
    expect(normalizeResultText('  转人工审核 ')).toBe('转人工审核');
  });

  it('keeps genuinely different results apart', () => {
    expect(sameResultMeaning('免运费 · 9 折', '立减 80 元')).toBe(false);
    expect(sameResultMeaning('9折', '8折')).toBe(false);
    expect(sameResultMeaning('转人工审核', '自动通过')).toBe(false);
  });
});

const field: RuleField = { id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 };
const always: BusinessRule['conditions'] = { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'gte', value: 0 }] };

function makeRule(id: string, priority: number, result: string): BusinessRule {
  return { id, name: id, conditions: { ...always }, priority, result };
}

function project(rules: BusinessRule[]): RuleProject {
  return { id: 'p', title: '测试', fields: [field], rules, sampleInputs: {}, versions: [], updatedAt: 1 };
}

describe('conflict analysis on normalized results', () => {
  it('does not flag spelling-only pairs as conflicts but keeps them in the literal (legacy) count', () => {
    const rules = [
      makeRule('a', 10, '免运费 · 9 折'),
      makeRule('b', 10, '免运费·9折'),
      makeRule('c', 10, '立减 80 元'),
    ];
    const analysis = analyzeRules(project(rules));
    const ab = analysis.overlaps.find((overlap) => overlap.ruleAId === 'a' && overlap.ruleBId === 'b');
    const ac = analysis.overlaps.find((overlap) => overlap.ruleAId === 'a' && overlap.ruleBId === 'c');
    expect(ab?.conflict).toBe(false);
    expect(ab?.spellingOnly).toBe(true);
    expect(ac?.conflict).toBe(true);
    expect(ac?.spellingOnly).toBe(false);
    expect(analysis.conflictCount).toBe(2); // a-c、b-c 含义不同
    expect(analysis.literalConflictCount).toBe(3); // 加上 a-b 这对仅写法差异
    expect(analysis.spellingOnlyConflictCount).toBe(1);
    // 可核对恒等式：旧口径 = 新口径 + 写法差异
    expect(analysis.literalConflictCount).toBe(analysis.conflictCount + analysis.spellingOnlyConflictCount);
  });

  it('treats identical raw results and different-priority overlaps as non-conflicts', () => {
    const rules = [
      makeRule('a', 10, '自动通过'),
      makeRule('b', 20, '自动通过'),
      makeRule('c', 30, '自动 通过'),
    ];
    const analysis = analyzeRules(project(rules));
    expect(analysis.conflictCount).toBe(0);
    expect(analysis.literalConflictCount).toBe(0);
    expect(analysis.spellingOnlyConflictCount).toBe(0);
    expect(analysis.overlaps.length).toBeGreaterThan(0);
  });
});

describe('result synonym grouping and explicit unification', () => {
  it('groups spelling variants, suggests the most-used raw text, and never rewrites implicitly', () => {
    const rules = [
      makeRule('a', 10, '免运费 · 9 折'),
      makeRule('b', 10, '免运费·9折'),
      makeRule('c', 10, '免运费·９折'),
      makeRule('d', 10, '立减 80 元'),
    ];
    const groups = buildResultSynonyms(rules);
    expect(groups).toHaveLength(1);
    const group = groups[0];
    expect(group.canonical).toBe('免运费 · 9 折');
    expect(group.variants.map((variant) => variant.text)).toEqual(['免运费 · 9 折', '免运费·9折', '免运费·９折']);
    expect(group.ruleIds).toEqual(['a', 'b', 'c']);
  });

  it('only rewrites the targeted rules when a group is unified; other historical text is untouched', () => {
    const rules = [
      makeRule('a', 10, '免运费 · 9 折'),
      makeRule('b', 10, '免运费·9折'),
      makeRule('c', 10, '其他·保持'),
    ];
    const [group] = buildResultSynonyms(rules);
    const plan = planResultUnify(group);
    expect(plan.changed.map((change) => change.ruleId)).toEqual(['b']);
    const next = applyResultUnify(rules, [plan]);
    expect(next.find((rule) => rule.id === 'a')?.result).toBe('免运费 · 9 折');
    expect(next.find((rule) => rule.id === 'b')?.result).toBe('免运费 · 9 折');
    expect(next.find((rule) => rule.id === 'c')?.result).toBe('其他·保持');

    // 统一后重新分析：新口径含义冲突不变，旧口径的写法差异冲突随文案统一而消失。
    const before = analyzeRules(project(rules));
    const after = analyzeRules(project(next));
    expect(before.conflictCount).toBe(2); // a-c、b-c 含义不同
    expect(before.literalConflictCount).toBe(3); // 再加上 a-b 这对写法差异
    expect(after.conflictCount).toBe(2);
    expect(after.literalConflictCount).toBe(2);
    expect(after.spellingOnlyConflictCount).toBe(0);
  });
});
