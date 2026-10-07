import { analyzeRules } from '../../domain/ruleAnalysis';
import { groupResultsByMeaning } from '../../domain/resultNormalization';
import type { BusinessRule, ConditionGroup, PredicateCondition, ResultUnifyReport, RuleAnalysis, RuleField, RuleProject } from '../../models/ruleModel';
import type { WorkspacePort } from '../../viewmodels/workspacePort';

export class RulesViewModel {
  constructor(private readonly workspace: WorkspacePort) {}

  selectRule(ruleId: string): void {
    this.workspace.selectRule(ruleId);
  }

  addRule(): void {
    const project = this.currentProject();
    if (!project) return;
    const ordinal = project.rules.length + 1;
    const field = project.fields.find((candidate) => candidate.type === 'number' || candidate.type === 'enum' || candidate.type === 'boolean');
    const conditions: ConditionGroup = { kind: 'group', operator: 'and', conditions: field ? [defaultCondition(field)] : [] };
    const rule: BusinessRule = { id: makeId('rule'), name: `新规则 ${ordinal}`, conditions, priority: ordinal * 10, result: '' };
    this.workspace.commitProject({ ...project, rules: [...project.rules, rule] }, `已创建“${rule.name}”`);
    this.workspace.selectRule(rule.id);
  }

  updateRule(ruleId: string, updates: Partial<Pick<BusinessRule, 'name' | 'priority' | 'result'>>): void {
    this.updateRules((rule) => rule.id === ruleId ? { ...rule, ...updates } : rule, `${this.findName(ruleId)}已更新`);
  }

  removeRule(ruleId: string): void {
    const project = this.currentProject();
    if (!project) return;
    const name = this.findName(ruleId);
    this.workspace.commitProject({ ...project, rules: project.rules.filter((rule) => rule.id !== ruleId) }, `已删除${name}`);
    if (this.workspace.getSnapshot().selectedRuleId === ruleId) this.workspace.selectRule(project.rules.find((rule) => rule.id !== ruleId)?.id);
  }

  setGroupOperator(ruleId: string, operator: ConditionGroup['operator']): void {
    this.updateRules((rule) => rule.id === ruleId ? { ...rule, conditions: { ...rule.conditions, operator } } : rule, '条件组合已更新');
  }

  addCondition(ruleId: string): void {
    const project = this.currentProject();
    const field = project?.fields[0];
    if (!project || !field) {
      this.workspace.updateView({ notice: '请先定义至少一个字段，再添加规则条件。' });
      return;
    }
    this.updateRules((rule) => rule.id === ruleId
      ? { ...rule, conditions: { ...rule.conditions, conditions: [...rule.conditions.conditions, defaultCondition(field)] } }
      : rule, '已添加一个条件');
  }

  updateCondition(ruleId: string, index: number, condition: PredicateCondition): void {
    this.updateRules((rule) => {
      if (rule.id !== ruleId) return rule;
      const conditions = [...rule.conditions.conditions];
      conditions[index] = condition;
      return { ...rule, conditions: { ...rule.conditions, conditions } };
    }, '规则条件已更新');
  }

  changeConditionField(ruleId: string, index: number, fieldId: string): void {
    const field = this.currentProject()?.fields.find((candidate) => candidate.id === fieldId);
    if (field) this.updateCondition(ruleId, index, defaultCondition(field));
  }

  removeCondition(ruleId: string, index: number): void {
    this.updateRules((rule) => rule.id === ruleId
      ? { ...rule, conditions: { ...rule.conditions, conditions: rule.conditions.conditions.filter((_, itemIndex) => itemIndex !== index) } }
      : rule, '已移除一个条件');
  }

  unifyResultGroup(groupKey: string, canonical: string): void {
    const project = this.currentProject();
    if (!project) return;
    const group = groupResultsByMeaning(project.rules).find((candidate) => candidate.key === groupKey);
    if (!group || group.variants.length < 2) return;
    const target = canonical.trim();
    if (!target) {
      this.workspace.updateView({ notice: '统一后的结果文案不能为空。' });
      return;
    }
    const variantTexts = new Set(group.variants.map((variant) => variant.text));
    const before = analyzeRules(project);
    const rules = project.rules.map((rule) => variantTexts.has(rule.result) && rule.result !== target ? { ...rule, result: target } : rule);
    const affectedRuleIds = rules.filter((rule, index) => rule !== project.rules[index]).map((rule) => rule.id);
    if (!affectedRuleIds.length) {
      this.workspace.updateView({ notice: '该含义下的结果写法已经一致，无需统一。' });
      return;
    }
    const next = { ...project, rules };
    const after = analyzeRules(next);
    const report: ResultUnifyReport = {
      canonical: target,
      unifiedTexts: group.variants.map((variant) => variant.text),
      affectedRuleIds,
      rawConflictsBefore: countRawConflicts(before),
      rawConflictsAfter: countRawConflicts(after),
      normalizedConflictsBefore: countNormalizedConflicts(before),
      normalizedConflictsAfter: countNormalizedConflicts(after),
    };
    const eliminated = report.rawConflictsBefore - report.rawConflictsAfter;
    const committed = this.workspace.commitProject(next, `已将 ${group.variants.length} 种写法统一为「${target}」，消除 ${eliminated} 个写法差异冲突`);
    if (committed) this.workspace.updateView({ resultUnifyReport: report });
  }

  dismissUnifyReport(): void {
    this.workspace.updateView({ resultUnifyReport: null });
  }

  private currentProject(): RuleProject | null {
    return this.workspace.getSnapshot().project;
  }

  private findName(ruleId: string): string {
    return this.currentProject()?.rules.find((rule) => rule.id === ruleId)?.name ?? '规则';
  }

  private updateRules(update: (rule: BusinessRule) => BusinessRule, notice: string): void {
    const project = this.currentProject();
    if (project) this.workspace.commitProject({ ...project, rules: project.rules.map(update) }, notice);
  }
}

function defaultCondition(field: RuleField): PredicateCondition {
  if (field.type === 'number') return { kind: 'predicate', fieldId: field.id, operator: 'gte', value: field.min ?? 0 };
  if (field.type === 'enum') return { kind: 'predicate', fieldId: field.id, operator: 'eq', value: field.enumValues?.[0] ?? '' };
  return { kind: 'predicate', fieldId: field.id, operator: 'isTrue', value: true };
}

function countRawConflicts(analysis: RuleAnalysis): number {
  return analysis.overlaps.filter((overlap) => overlap.rawConflict).length;
}

function countNormalizedConflicts(analysis: RuleAnalysis): number {
  return analysis.overlaps.filter((overlap) => overlap.conflict).length;
}

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}
