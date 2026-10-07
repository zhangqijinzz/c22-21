import { describe, expect, it } from 'vitest';
import { analyzeRules } from '../domain/ruleAnalysis';
import { groupResultsByMeaning } from '../domain/resultNormalization';
import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import type { BusinessRule, RuleProject } from '../models/ruleModel';
import { RuleWorkspaceViewModel } from '../viewmodels/workspaceViewModel';

class MemoryRepository {
  async load() { return null; }
  async save() { return undefined; }
}

class FakeChecker {
  run(project: RuleProject) { return { promise: Promise.resolve(analyzeRules(project)), cancel() {} }; }
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

  it('unifies result spellings with a reconcilable conflict-count report', async () => {
    const workspace = new RuleWorkspaceViewModel(new MemoryRepository(), new FakeChecker());
    await workspace.start();
    const rulesViewModel = new RulesViewModel(workspace);
    const project = workspace.getSnapshot().project as RuleProject;
    const amountGte = (value: number): BusinessRule['conditions'] => ({ kind: 'group', operator: 'and', conditions: [{ kind: 'predicate', fieldId: 'cart-total', operator: 'gte', value }] });
    const customRules: BusinessRule[] = [
      { id: 'r1', name: '规则一', conditions: amountGte(500), priority: 10, result: '免运费 · 9 折' },
      { id: 'r2', name: '规则二', conditions: amountGte(400), priority: 10, result: '免运费·9折' },
      { id: 'r3', name: '规则三', conditions: amountGte(600), priority: 10, result: '立减 80 元' },
    ];
    workspace.commitProject({ ...project, rules: customRules }, '准备写法分歧的规则');

    // 规范化只影响比较，不改写已存储的结果文案；运行检查也不会改写
    await workspace.runCheck();
    expect(workspace.getSnapshot().project?.rules.map((rule) => rule.result)).toEqual(['免运费 · 9 折', '免运费·9折', '立减 80 元']);
    expect(workspace.getSnapshot().analysis?.overlaps.filter((overlap) => overlap.conflict)).toHaveLength(2);

    const group = groupResultsByMeaning(customRules).find((candidate) => candidate.variants.length > 1);
    expect(group?.variants.map((variant) => variant.text)).toEqual(['免运费 · 9 折', '免运费·9折']);
    rulesViewModel.unifyResultGroup(group?.key ?? '', '免运费·9折');

    const after = workspace.getSnapshot().project as RuleProject;
    expect(after.rules.map((rule) => rule.result)).toEqual(['免运费·9折', '免运费·9折', '立减 80 元']);
    const report = workspace.getSnapshot().resultUnifyReport;
    expect(report?.canonical).toBe('免运费·9折');
    expect(report?.affectedRuleIds).toEqual(['r1']);
    expect(report?.rawConflictsBefore).toBe(3);
    expect(report?.rawConflictsAfter).toBe(2);
    expect(report?.normalizedConflictsBefore).toBe(2);
    expect(report?.normalizedConflictsAfter).toBe(2);

    // 报告中的“统一后”数字与对当前项目重新分析的结果一致，可核对
    const fresh = analyzeRules(after);
    expect(fresh.overlaps.filter((overlap) => overlap.rawConflict)).toHaveLength(report?.rawConflictsAfter ?? -1);
    expect(fresh.overlaps.filter((overlap) => overlap.conflict)).toHaveLength(report?.normalizedConflictsAfter ?? -1);

    rulesViewModel.dismissUnifyReport();
    expect(workspace.getSnapshot().resultUnifyReport).toBeNull();
    workspace.dispose();
  });
});
