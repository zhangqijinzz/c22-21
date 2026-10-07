import type { BusinessRule } from '../models/ruleModel';

/**
 * 命中结果是自由文本，同一含义常出现多种写法（如“免运费 · 9 折”与“免运费·9折”）。
 * 这里的规范化只产出“含义键”，用于冲突判定与同义分组展示；
 * 绝不回写到 rule.result —— 历史项目里已有的结果文案必须原样保留，
 * 只有用户在界面上显式执行“统一写法”时才允许改写（见 planResultUnify）。
 *
 * 规范化规则：
 * 1. NFKC 兼容分解：全角/半角字母数字（９折→9折）、兼容标点统一；
 * 2. 忽略所有空白与零宽字符（空格、制表符、全角空格、零宽空格等）；
 * 3. 常见枚举分隔符（中圆点、竖线、斜杠、逗号、顿号、分号、冒号等）统一为半角中圆点并折叠；
 * 4. 去掉首尾分隔符。
 */

// 空白（含全角空格 U+3000 等）与零宽字符（ZWSP/ZWNJ/ZWJ 位于 U+200B–U+200D，另有 WJ U+2060）
// 全部视为不可见并忽略。区间写法与逐一列举等价，也避开 lint 对零宽连接序列的告警。
const IGNORED_INVISIBLE = new RegExp(`[\\s\\u200B-\\u200D\\u2060]`, 'g');
// NFKC 之后仍保留、需要统一的枚举分隔符，一律用 Unicode 转义书写：
// 中圆点 U+00B7、项目符号 U+2022、连字点 U+2027、片假名中点 U+30FB、半形圆点 U+FF65、
// 全角竖线 U+FF5C、斜杠 U+002F、半角逗号 U+002C、全角逗号 U+FF0C、顿号 U+3001、
// 分号 U+003B、冒号 U+003A
const SEPARATOR_AFTER_NFKC = new RegExp(
  '[\\u00B7\\u2022\\u2027\\u30FB\\uFF65\\uFF5C/,\\uFF0C\\u3001;:]',
  'g',
);
const MIDDLE_DOT = '·';

export function normalizeResultText(text: string): string {
  const folded = text
    .normalize('NFKC')
    .replace(IGNORED_INVISIBLE, '')
    .replace(SEPARATOR_AFTER_NFKC, MIDDLE_DOT);
  return folded.replace(new RegExp(`\\${MIDDLE_DOT}+`, 'g'), MIDDLE_DOT).replace(new RegExp(`^\\${MIDDLE_DOT}+|\\${MIDDLE_DOT}+$`, 'g'), '');
}

/** 两个结果文案在规范化之后是否表达同一含义。冲突判定按此比较。 */
export function sameResultMeaning(a: string, b: string): boolean {
  return normalizeResultText(a) === normalizeResultText(b);
}

export interface ResultVariant {
  /** 原始写法，直接来自 rule.result，展示与改写都以它为准。 */
  text: string;
  ruleIds: string[];
}

export interface ResultSynonymGroup {
  /** 规范化含义键。 */
  key: string;
  /** 建议统一到的写法：组内使用最多的原始写法，并列时取最先出现的。 */
  canonical: string;
  /** 同一含义下的不同原始写法，按首次出现顺序排列。 */
  variants: ResultVariant[];
  /** 组内全部规则 ID。 */
  ruleIds: string[];
}

/**
 * 按规范化含义把规则结果分组，仅返回“存在多种写法”的组，
 * 让用户一眼看出哪些结果其实是同一含义。空结果不参与分组。
 */
export function buildResultSynonyms(rules: BusinessRule[]): ResultSynonymGroup[] {
  const groups = new Map<string, Map<string, Set<string>>>();
  const order: string[] = [];
  for (const rule of rules) {
    if (!rule.result.trim()) continue;
    const key = normalizeResultText(rule.result);
    let variants = groups.get(key);
    if (!variants) {
      variants = new Map();
      groups.set(key, variants);
      order.push(key);
    }
    const existing = variants.get(rule.result);
    if (existing) existing.add(rule.id);
    else variants.set(rule.result, new Set([rule.id]));
  }

  const result: ResultSynonymGroup[] = [];
  for (const key of order) {
    const variantsMap = groups.get(key)!;
    if (variantsMap.size < 2) continue;
    const entries = [...variantsMap.entries()];
    const canonical = entries.reduce(
      (best, entry) => entry[1].size > best[1].size ? entry : best,
      entries[0],
    )[0];
    const variants: ResultVariant[] = entries.map(([text, ids]) => ({ text, ruleIds: [...ids] }));
    result.push({ key, canonical, variants, ruleIds: variants.flatMap((variant) => variant.ruleIds) });
  }
  return result;
}

export interface ResultUnifyChange {
  ruleId: string;
  from: string;
  to: string;
}

export interface ResultUnifyPlan {
  key: string;
  target: string;
  changed: ResultUnifyChange[];
}

/**
 * 生成“统一写法”计划：把同义组内所有非目标写法改到 target。
 * target 必须是组内真实存在的原始写法，默认采用 canonical。
 */
export function planResultUnify(group: ResultSynonymGroup, target: string = group.canonical): ResultUnifyPlan {
  const allowed = group.variants.map((variant) => variant.text);
  if (!allowed.includes(target)) throw new Error(`目标写法“${target}”不在同义结果组中`);
  const changed: ResultUnifyChange[] = group.variants
    .filter((variant) => variant.text !== target)
    .flatMap((variant) => variant.ruleIds.map((ruleId) => ({ ruleId, from: variant.text, to: target })));
  return { key: group.key, target, changed };
}

/** 按计划批量改写规则结果；不在计划中的规则（及其历史文案）保持不动。 */
export function applyResultUnify(rules: BusinessRule[], plans: ResultUnifyPlan[]): BusinessRule[] {
  const targetByRule = new Map<string, string>();
  for (const plan of plans) {
    for (const change of plan.changed) targetByRule.set(change.ruleId, plan.target);
  }
  return rules.map((rule) => {
    const target = targetByRule.get(rule.id);
    return target && target !== rule.result ? { ...rule, result: target } : rule;
  });
}
