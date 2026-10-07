import { describe, expect, it } from 'vitest';
import { evaluateSample } from '../domain/conditionEvaluator';
import { validateField, validateProject } from '../domain/fieldValidation';
import { analyzeRules } from '../domain/ruleAnalysis';
import { groupResultsByMeaning, normalizeResultText } from '../domain/resultNormalization';
import type { BusinessRule, RuleField, RuleOverlap, RuleProject } from '../models/ruleModel';

const amount: RuleField = { id: 'amount', name: '金额', type: 'number', min: 0, max: 1000 };
const tier: RuleField = { id: 'tier', name: '等级', type: 'enum', enumValues: ['basic', 'gold'] };
const active: RuleField = { id: 'active', name: '启用', type: 'boolean' };

function makeRule(id: string, conditions: BusinessRule['conditions'], priority = 10, result = id): BusinessRule {
  return { id, name: id, conditions, priority, result };
}

function project(rules: BusinessRule[], fields: RuleField[] = [amount, tier, active]): RuleProject {
  return { id: 'p', title: '测试项目', fields, rules, sampleInputs: {}, versions: [], updatedAt: 1 };
}

const amountAtLeast = (value: number): BusinessRule['conditions'] => ({ kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'gte', value }] });

describe('field and project validation', () => {
  it('accepts inclusive boundary ranges and rejects reversed or empty definitions', () => {
    expect(validateField({ ...amount, min: 5, max: 5 })).toEqual([]);
    expect(validateField({ ...amount, min: 11, max: 10 }).map((issue) => issue.code)).toContain('number-range-order');
    expect(validateField({ id: 'tier', name: '等级', type: 'enum', enumValues: [] }).map((issue) => issue.code)).toContain('enum-values-required');
  });

  it('checks enum and boolean predicate types without depending on React', () => {
    const rules = [
      makeRule('gold', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' }] }),
      makeRule('active', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'active', operator: 'isTrue', value: true }] }),
    ];
    expect(validateProject(project(rules))).toEqual([]);
    expect(evaluateSample(project(rules), { amount: 12, tier: 'gold', active: true }).matchedRules.map((rule) => rule.id)).toEqual(['gold', 'active']);
  });
});

describe('rule consistency analysis', () => {
  it('finds partial overlap, same-priority conflicts, lower-priority shadowing, unreachable rules, and gaps', () => {
    const rules = [
      makeRule('base', amountAtLeast(500), 10, 'standard'),
      makeRule('partial', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'between', value: { min: 300, max: 800 } }] }, 20, 'special'),
      makeRule('conflict', amountAtLeast(700), 20, 'different'),
      makeRule('hidden', amountAtLeast(750), 5, 'hidden'),
      makeRule('impossible', amountAtLeast(1001), 50, 'out of range'),
      makeRule('no-overlap', { kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'amount', operator: 'lt', value: 250 }] }, 1, 'separate'),
    ];
    const analysis = analyzeRules(project(rules));
    expect(analysis.overlaps.some((overlap) => overlap.ruleAId === 'partial' && overlap.ruleBId === 'conflict' && overlap.conflict)).toBe(true);
    expect(analysis.overlaps.some((overlap) => overlap.ruleAId === 'base' && overlap.ruleBId === 'no-overlap')).toBe(false);
    expect(analysis.unreachableRuleIds).toContain('impossible');
    expect(analysis.shadowedRuleIds).toContain('hidden');
    expect(analysis.uncoveredExamples.length).toBeGreaterThan(0);
    expect(analysis.checkedCases).toBeGreaterThan(0);
  });

  it('evaluates OR groups and validates missing sample inputs precisely', () => {
    const rule = makeRule('either', { kind: 'group', operator: 'or', conditions: [
      { kind: 'predicate', fieldId: 'tier', operator: 'eq', value: 'gold' },
      { kind: 'predicate', fieldId: 'active', operator: 'isTrue', value: true },
    ] });
    const result = evaluateSample(project([rule]), { amount: 10, tier: 'basic', active: true });
    expect(result.valid).toBe(true);
    expect(result.winner?.id).toBe('either');
    const missing = evaluateSample(project([rule]), { amount: 10, tier: 'gold' });
    expect(missing.errors).toEqual(['请填写“启用”']);
  });
});

describe('result normalization', () => {
  it('treats whitespace, separator, case and full-width variants as the same meaning', () => {
    expect(normalizeResultText('免运费 · 9 折')).toBe(normalizeResultText('免运费·9折'));
    expect(normalizeResultText('免运费、９折')).toBe(normalizeResultText('免运费·9折'));
    expect(normalizeResultText('免运费， 9折')).toBe(normalizeResultText('免运费·9折'));
    expect(normalizeResultText('VIP 通道')).toBe(normalizeResultText('vip通道'));
    expect(normalizeResultText('自动通过 / 应用 9 折')).toBe(normalizeResultText('自动通过·应用9折'));
  });

  it('stays order-sensitive and keeps distinct meanings apart', () => {
    expect(normalizeResultText('9折·免运费')).not.toBe(normalizeResultText('免运费·9折'));
    expect(normalizeResultText('立减 80 元')).not.toBe(normalizeResultText('免运费·9折'));
  });

  it('judges conflicts by normalized meaning while keeping the raw comparison for reconciliation', () => {
    const rules = [
      makeRule('a', amountAtLeast(500), 10, '免运费 · 9 折'),
      makeRule('b', amountAtLeast(400), 10, '免运费·9折'),
      makeRule('c', amountAtLeast(600), 10, '立减 80 元'),
    ];
    const analysis = analyzeRules(project(rules, [amount]));
    const pair = (x: string, y: string): RuleOverlap | undefined => analysis.overlaps.find((overlap) => [overlap.ruleAId, overlap.ruleBId].sort().join('|') === [x, y].sort().join('|'));
    expect(pair('a', 'b')?.conflict).toBe(false);
    expect(pair('a', 'b')?.rawConflict).toBe(true);
    expect(pair('a', 'c')?.conflict).toBe(true);
    expect(pair('a', 'c')?.rawConflict).toBe(true);
    expect(analysis.overlaps.filter((overlap) => overlap.rawConflict)).toHaveLength(3);
    expect(analysis.overlaps.filter((overlap) => overlap.conflict)).toHaveLength(2);
  });

  it('groups result variants by meaning without rewriting stored text', () => {
    const rules = [
      makeRule('a', amountAtLeast(500), 10, '免运费 · 9 折'),
      makeRule('b', amountAtLeast(400), 10, '免运费·9折'),
      makeRule('c', amountAtLeast(300), 10, '免运费·9折'),
      makeRule('d', amountAtLeast(200), 10, '立减 80 元'),
      makeRule('empty', amountAtLeast(100), 10, '  '),
    ];
    const groups = groupResultsByMeaning(rules);
    expect(groups).toHaveLength(2);
    const merged = groups.find((group) => group.variants.length > 1);
    expect(merged?.display).toBe('免运费·9折');
    expect(merged?.ruleCount).toBe(3);
    expect(merged?.variants.map((variant) => variant.text).sort()).toEqual(['免运费 · 9 折', '免运费·9折']);
    expect(rules.map((rule) => rule.result)).toEqual(['免运费 · 9 折', '免运费·9折', '免运费·9折', '立减 80 元', '  ']);
  });
});
