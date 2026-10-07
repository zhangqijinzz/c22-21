export type FieldType = 'number' | 'enum' | 'boolean';
export type ScalarValue = string | number | boolean;
export type ModuleId = 'fields' | 'rules' | 'samples' | 'inspection';

export interface RuleField {
  id: string;
  name: string;
  type: FieldType;
  enumValues?: string[];
  min?: number;
  max?: number;
}

export interface NumberRange {
  min: number;
  max: number;
}

export type PredicateCondition =
  | { kind: 'predicate'; fieldId: string; operator: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; value: number }
  | { kind: 'predicate'; fieldId: string; operator: 'between'; value: NumberRange }
  | { kind: 'predicate'; fieldId: string; operator: 'eq' | 'notEq'; value: string }
  | { kind: 'predicate'; fieldId: string; operator: 'isTrue' | 'isFalse'; value: boolean };

export interface ConditionGroup {
  kind: 'group';
  operator: 'and' | 'or';
  conditions: RuleCondition[];
}

export type RuleCondition = PredicateCondition | ConditionGroup;

export interface BusinessRule {
  id: string;
  name: string;
  conditions: ConditionGroup;
  priority: number;
  result: string;
}

export type SampleInput = Record<string, ScalarValue | ''>;

export interface RuleVersion {
  id: string;
  name: string;
  savedAt: number;
  frozen: boolean;
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
}

export interface RuleProject {
  id: string;
  title: string;
  fields: RuleField[];
  rules: BusinessRule[];
  sampleInputs: SampleInput;
  versions: RuleVersion[];
  frozenVersionId?: string;
  updatedAt: number;
}

export interface WorkspaceDocument {
  schemaVersion: 1;
  projects: RuleProject[];
  activeProjectId: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  fieldId?: string;
  ruleId?: string;
}

export interface MatchWitness {
  values: SampleInput;
  ruleIds: string[];
}

export interface RuleOverlap {
  ruleAId: string;
  ruleBId: string;
  /** 同优先级且规范化之后的含义不同才算冲突。 */
  conflict: boolean;
  /**
   * 仅写法差异：同优先级、原文案不同（旧口径会报冲突），
   * 但规范化之后含义一致，因此不再计入 conflict。
   */
  spellingOnly: boolean;
  witness: SampleInput;
}

export interface RuleAnalysis {
  checkedCases: number;
  coveredCases: number;
  coveragePercent: number;
  overlaps: RuleOverlap[];
  unreachableRuleIds: string[];
  shadowedRuleIds: string[];
  uncoveredExamples: SampleInput[];
  truncated: boolean;
  /** 按规范化含义判定的冲突数（当前口径）。 */
  conflictCount: number;
  /** 按原始文案逐字比较的冲突数（规范化之前的旧口径，用于核对减少量）。 */
  literalConflictCount: number;
  /** 旧口径误报、规范化后消解的冲突数：literalConflictCount - conflictCount。 */
  spellingOnlyConflictCount: number;
}

export interface SampleEvaluation {
  valid: boolean;
  errors: string[];
  matchedRules: BusinessRule[];
  winner?: BusinessRule;
}

export interface DomainChecker {
  analyze(project: RuleProject): RuleAnalysis;
  validateProject(project: RuleProject): ValidationIssue[];
}

export const fieldLabel = (field: RuleField): string => field.name || '未命名字段';
