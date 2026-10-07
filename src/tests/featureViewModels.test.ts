import { describe, expect, it } from 'vitest';
import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import { RuleWorkspaceViewModel } from '../viewmodels/workspaceViewModel';

class MemoryRepository {
  async load() { return null; }
  async save() { return undefined; }
}

class FakeChecker {
  run() { return { promise: Promise.resolve({ checkedCases: 1, coveredCases: 1, coveragePercent: 100, overlaps: [], unreachableRuleIds: [], shadowedRuleIds: [], uncoveredExamples: [], truncated: false, conflictCount: 0, literalConflictCount: 0, spellingOnlyConflictCount: 0 }), cancel() {} }; }
}

describe('feature ViewModels', () => {
  it('adds typed fields, builds a rule, protects referenced fields, and evaluates a sample', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const fields = new FieldsViewModel(workspace);
    const rules = new RulesViewModel(workspace);
    const samples = new SamplesViewModel(workspace);
    fields.addField('boolean');
    rules.addRule();
    const addedField = workspace.getSnapshot().project?.fields.at(-1);
    expect(addedField?.type).toBe('boolean');
    expect(fields.removeField('member-level')).toBe(false);
    expect(workspace.getSnapshot().notice).toContain('仍被');
    const project = workspace.getSnapshot().project;
    expect(project).toBeDefined();
    const boolField = project?.fields.at(-1);
    if (boolField) samples.setValue(boolField.id, true);
    samples.evaluate();
    expect(workspace.getSnapshot().sampleEvaluation?.valid).toBe(true);
    workspace.dispose();
  });

  it('groups synonymous results and unifies only the chosen spelling without touching other text', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const rules = new RulesViewModel(workspace);
    const groups = rules.resultSynonyms();
    expect(groups).toHaveLength(1);
    expect(groups[0].variants.map((variant) => variant.text)).toEqual(['免运费 · 9 折', '免运费·9折']);
    expect(groups[0].canonical).toBe('免运费 · 9 折');

    const changed = rules.unifyResults(groups);
    expect(changed).toBe(1);
    const updated = workspace.getSnapshot().project?.rules ?? [];
    expect(updated.find((rule) => rule.id === 'rule-gold-quick-deal')?.result).toBe('免运费 · 9 折');
    // 组外的历史文案必须原样保留。
    expect(updated.find((rule) => rule.id === 'rule-coupon-discount')?.result).toBe('立减 80 元');
    expect(updated.find((rule) => rule.id === 'rule-out-of-range')?.result).toBe('转人工审核');
    // 统一之后不再有同义写法组。
    expect(rules.resultSynonyms()).toHaveLength(0);
    // 建议列表复用已有写法。
    expect(rules.resultSuggestions()).toContain('立减 80 元');
    workspace.dispose();
  });
});
