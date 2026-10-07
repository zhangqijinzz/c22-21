import type { ResultSynonymGroup } from '../../domain/resultNormalization';
import type { RulesViewModel } from '../rules/rulesViewModel';
import type { RuleWorkspaceViewModel } from '../../viewmodels/workspaceViewModel';

export class InspectionViewModel {
  constructor(
    private readonly workspace: RuleWorkspaceViewModel,
    private readonly rules?: RulesViewModel,
  ) {}

  check(): Promise<void> {
    return this.workspace.runCheck();
  }

  cancel(): void {
    this.workspace.cancelCheck();
  }

  saveVersion(): void {
    this.workspace.saveVersion();
  }

  freeze(): void {
    this.workspace.freezeCurrent();
  }

  continueFrom(versionId: string): void {
    this.workspace.restoreVersion(versionId);
  }

  copyToProject(versionId: string): void {
    this.workspace.copyVersionToProject(versionId);
  }

  /** 在检查页直接统一同义结果写法；提交后由工作区自动重检，冲突数变化可立即核对。 */
  unifyResults(groups: ResultSynonymGroup[]): number {
    if (!this.rules) return 0;
    const changed = this.rules.unifyResults(groups);
    if (changed > 0) this.workspace.selectRule(undefined);
    return changed;
  }
}
