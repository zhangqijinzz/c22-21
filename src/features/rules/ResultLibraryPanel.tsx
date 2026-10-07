import { useState } from 'react';
import type { ResultMeaningGroup } from '../../domain/resultNormalization';
import type { ResultUnifyReport } from '../../models/ruleModel';

interface ResultLibraryPanelProps {
  groups: ResultMeaningGroup[];
  report: ResultUnifyReport | null;
  onUnify: (groupKey: string, canonical: string) => void;
  onDismissReport: () => void;
}

export function ResultLibraryPanel({ groups, report, onUnify, onDismissReport }: ResultLibraryPanelProps) {
  if (!groups.length) return null;
  const variantGroups = groups.filter((group) => group.variants.length > 1);
  const writingCount = groups.reduce((sum, group) => sum + group.variants.length, 0);
  return (
    <section className="result-library card-surface">
      <header className="panel-heading">
        <div><span className="eyebrow">RESULT LIBRARY</span><h2>结果库与写法统一</h2></div>
        <span className="count-chip">{writingCount} 种写法 · {groups.length} 种含义</span>
      </header>
      <p className="result-library-tip">冲突检查按规范化含义比较结果（忽略空白、全半角与常见分隔符差异），下方列出含义相同但写法不同的结果。历史文案不会被自动改写，统一需手动确认。</p>
      {report && <UnifyReportCard report={report} onDismiss={onDismissReport} />}
      {variantGroups.length
        ? variantGroups.map((group) => <VariantGroupRow key={group.key} group={group} onUnify={onUnify} />)
        : <div className="success-empty"><span>✓</span>同义结果的写法已全部统一</div>}
    </section>
  );
}

function VariantGroupRow({ group, onUnify }: { group: ResultMeaningGroup; onUnify: (groupKey: string, canonical: string) => void }) {
  const [choice, setChoice] = useState(group.variants[0].text);
  const selected = group.variants.some((variant) => variant.text === choice) ? choice : group.variants[0].text;
  return (
    <div className="variant-group">
      <div className="variant-group-variants">
        {group.variants.map((variant) => <span className="variant-chip" key={variant.text}>「{variant.text}」<b>×{variant.ruleIds.length}</b></span>)}
        <span className="variant-same">≡ 同一含义 · {group.ruleCount} 条规则</span>
      </div>
      <div className="variant-group-actions">
        <select aria-label="选择统一后的写法" value={selected} onChange={(event) => setChoice(event.target.value)}>
          {group.variants.map((variant) => <option key={variant.text} value={variant.text}>{variant.text}</option>)}
        </select>
        <button className="button button-subtle" onClick={() => onUnify(group.key, selected)}>统一为所选写法</button>
      </div>
    </div>
  );
}

function UnifyReportCard({ report, onDismiss }: { report: ResultUnifyReport; onDismiss: () => void }) {
  const eliminated = report.rawConflictsBefore - report.rawConflictsAfter;
  const normalizedNote = report.normalizedConflictsBefore === report.normalizedConflictsAfter
    ? '不变'
    : `变化 ${report.normalizedConflictsAfter - report.normalizedConflictsBefore}`;
  return (
    <div className="unify-report">
      <button className="icon-button unify-report-close" aria-label="关闭统一报告" onClick={onDismiss}>×</button>
      <strong>已统一为「{report.canonical}」</strong>
      <span>{report.unifiedTexts.length} 种写法 → 1 种 · 影响 {report.affectedRuleIds.length} 条规则</span>
      <span className="unify-report-counts">冲突核对 · 按原文 {report.rawConflictsBefore} → {report.rawConflictsAfter}（消除 {eliminated} 个写法差异冲突） · 按含义 {report.normalizedConflictsBefore} → {report.normalizedConflictsAfter}（{normalizedNote}）</span>
    </div>
  );
}
