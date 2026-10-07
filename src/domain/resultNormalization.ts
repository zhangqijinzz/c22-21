import type { BusinessRule } from '../models/ruleModel';

// 结果规范化只用于比较与归组，永远不会改写项目中存储的原始文案。
// 规则：Unicode 兼容分解（全角→半角）→ 忽略大小写 → 去除全部空白 → 统一常见分隔符。
// 分段的先后顺序保持敏感（“免运费·9折”与“9折·免运费”视为不同含义），避免过度合并掩盖真实冲突。
export function normalizeResultText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·•∙⋅‧,，、;；/|]+/g, '·')
    .replace(/^·+|·+$/g, '');
}

export interface ResultVariant {
  /** 规则的原始结果文案（未做任何规范化处理） */
  text: string;
  /** 使用该写法的规则 id，按规则顺序排列 */
  ruleIds: string[];
}

export interface ResultMeaningGroup {
  /** 规范化含义键 */
  key: string;
  /** 建议的统一写法：使用次数最多的原始写法（去掉首尾空白） */
  display: string;
  /** 同一含义下出现过的不同原始写法 */
  variants: ResultVariant[];
  /** 该含义下的规则总数 */
  ruleCount: number;
}

export function groupResultsByMeaning(rules: BusinessRule[]): ResultMeaningGroup[] {
  const groups = new Map<string, Map<string, string[]>>();
  for (const rule of rules) {
    if (!rule.result.trim()) continue;
    const key = normalizeResultText(rule.result);
    let variants = groups.get(key);
    if (!variants) {
      variants = new Map<string, string[]>();
      groups.set(key, variants);
    }
    const ruleIds = variants.get(rule.result);
    if (ruleIds) ruleIds.push(rule.id);
    else variants.set(rule.result, [rule.id]);
  }
  return [...groups.entries()].map(([key, variants]) => {
    const ordered = [...variants.entries()]
      .map(([text, ruleIds]) => ({ text, ruleIds }))
      .sort((a, b) => b.ruleIds.length - a.ruleIds.length);
    return {
      key,
      display: ordered[0].text.trim(),
      variants: ordered,
      ruleCount: ordered.reduce((sum, variant) => sum + variant.ruleIds.length, 0),
    };
  });
}
