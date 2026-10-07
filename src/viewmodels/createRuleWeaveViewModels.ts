import { FieldsViewModel } from '../features/fields/fieldsViewModel';
import { RulesViewModel } from '../features/rules/rulesViewModel';
import { RuleWorkspaceViewModel } from './workspaceViewModel';
import { SamplesViewModel } from '../features/samples/samplesViewModel';
import { InspectionViewModel } from '../features/inspection/inspectionViewModel';

export function createRuleWeaveViewModels() {
  const workspace = new RuleWorkspaceViewModel();
  const fields = new FieldsViewModel(workspace);
  const rules = new RulesViewModel(workspace);
  const samples = new SamplesViewModel(workspace);
  const inspection = new InspectionViewModel(workspace, rules);
  return { workspace, fields, rules, samples, inspection };
}
