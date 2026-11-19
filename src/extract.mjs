// 从招聘说明与企业补充答复中抽取结构化条件。
// 每条条件保留对原句的定位（postingId + 起止偏移 + 原句摘录）。
import {
  PRIORITY_MARKERS, CONDITION_CONCEPTS, ALTERNATIVE_MARKERS,
  GATE_MARKERS, CLARIFICATION_MARKERS, findConcept, includesAny,
} from './keywords.mjs';
import { locate, splitClauses, unique } from './util.mjs';

const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function parseYears(text) {
  const m = text.match(/([0-9一二两三四五六七八九十]+)年/);
  if (!m) return null;
  const token = m[1];
  if (/^\d+$/.test(token)) return Number(token);
  if (token.length === 1) return CN_NUM[token] ?? null;
  if (token === '十') return 10;
  return null;
}

// 在一句中按“或/或者/可替代/替代”切出选项，返回片段数组（保留原文用于定位）。
// 注意“项目可以替代年限”必须切成“项目可以/年限”两段，不能把“项目可以”当成独立选项。
function splitOptions(clause) {
  const markerRegex = /或者|或|可替代|替代|也可|即可/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = markerRegex.exec(clause)) !== null) {
    parts.push(clause.slice(last, m.index));
    last = markerRegex.lastIndex;
  }
  parts.push(clause.slice(last));
  return parts
    .map((s) => s.replace(/[，,。；;：:]$/, '').trim())
    .filter((s) => s.length >= 2 && !/^(项目)?可以$/.test(s));
}

// 切出“须有/还要/另需/必须/另须”之后的前提片段，同时返回前提在句中的起点，便于剥离。
// 仅当句中存在替代关系（或/替代）时才作为“前提”处理；
// “另须/另需”开头的独立句是单独的必备条件，不是前提。
function splitGate(clause) {
  const m = clause.match(/(?:须有|必须|还要|另需|另须|须)([^，,。；;]*)/);
  if (!m) return null;
  return { text: m[1].trim(), index: m.index, markerLength: m[0].length - m[1].length };
}

export function extractConditions(state) {
  const roots = state.postings.filter((p) => !p.responseTo);
  const conditions = [];
  let seq = 0;
  const nextId = () => `C${++seq}`;
  const conceptConditions = new Map(); // concept -> condition
  const groupOfConcept = new Map();    // concept -> alternativeGroup
  let groupSeq = 0;

  const remember = (cond) => {
    if (!cond) return null;
    conditions.push(cond);
    if (!conceptConditions.has(cond.concept)) conceptConditions.set(cond.concept, cond);
    return cond;
  };

  const build = (posting, text, overrides = {}) => {
    const label = text.trim();
    if (label.length < 2) return null;
    const concept = findConcept(label) ?? 'other';
    const loc = locate(posting.text, label);
    const needs = includesAny(label, CLARIFICATION_MARKERS);
    const cond = {
      id: nextId(),
      jobId: roots.find((r) => r.id === posting.id || posting.responseTo === r.id)?.id ?? posting.id,
      sourcePostingId: posting.id,
      kind: includesAny(label, PRIORITY_MARKERS.preferred) ? 'preferred' : 'mandatory',
      concept,
      label,
      yearsRequired: parseYears(label),
      locator: loc,
      alternativeGroup: null,
      gate: null,
      needsClarification: needs,
      clarificationNote: needs ? '原文含“相关/等/相当”等开放表述，认定口径需企业澄清' : null,
      ...overrides,
    };
    return remember(cond);
  };

  const ordered = [
    ...roots,
    ...state.postings.filter((p) => p.responseTo),
  ];

  for (const posting of ordered) {
    for (const rawClause of splitClauses(posting.text)) {
      const gateMatch = splitGate(rawClause);
      const isStandaloneGateSentence = /^(另须|另需)/.test(rawClause) && !ALTERNATIVE_MARKERS.some((m) => rawClause.includes(m));
      // 独立的“另须/另需…”是一条独立必备条件，不做前提剥离
      const clause = (gateMatch && !isStandaloneGateSentence)
        ? rawClause.slice(0, gateMatch.index).replace(/[，,。；;：:]$/, '').trim()
        : rawClause;
      const gateText = isStandaloneGateSentence ? null : gateMatch?.text ?? null;
      const isPreferred = includesAny(clause, PRIORITY_MARKERS.preferred);
      const hasAlternative = ALTERNATIVE_MARKERS.some((m) => clause.includes(m));
      // 去掉优先语气词后的条件主体
      const bodyText = clause.replace(/非必需[：:]?/g, '').replace(/[。；;]$/, '').trim();

      // 1) 替代/选项句：例如“两年经历，或独立完成一个完整交付项目”
      if (hasAlternative) {
        const options = splitOptions(bodyText);
        const concepts = unique(options.map((t) => findConcept(t)).filter(Boolean));
        let group = concepts.map((c) => groupOfConcept.get(c)).find(Boolean);
        if (!group) group = `AG${++groupSeq}`;
        for (const opt of options) {
          const concept = findConcept(opt) ?? 'other';
          const existing = conceptConditions.get(concept);
          const cond = build(posting, opt, {
            kind: isPreferred ? 'preferred' : 'mandatory',
            alternativeGroup: group,
          });
          if (!cond) continue;
          // 企业答复中的替代说法，挂到被替代概念所在的同一选项组
          if (existing?.alternativeGroup) {
            cond.alternativeGroup = existing.alternativeGroup;
            groupOfConcept.set(concept, existing.alternativeGroup);
          } else {
            groupOfConcept.set(concept, group);
          }
        }
      } else if (!gateText || isStandaloneGateSentence) {
        build(posting, bodyText, { kind: isPreferred ? 'preferred' : 'mandatory' });
      }

      // 2) 带前提：例如“须有独立验收记录”“还要独立验收记录”。
      // 仅在句中存在替代关系、或上文已有选项组时才当前提；独立的“另须…”句子是独立必备条件。
      if (gateText && !isStandaloneGateSentence && (hasAlternative || groupSeq > 0)) {
        const clauseConcepts = unique(
          Object.entries(CONDITION_CONCEPTS)
            .filter(([, words]) => words.some((w) => clause.includes(w)))
            .map(([concept]) => concept),
        );
        let onConcepts = clauseConcepts.filter((c) => conceptConditions.has(c));
        if (!onConcepts.length && groupSeq > 0) {
          const latestGroup = `AG${groupSeq}`;
          onConcepts = [...groupOfConcept.entries()]
            .filter(([, group]) => group === latestGroup)
            .map(([concept]) => concept);
        } else if (groupSeq > 0) {
          // 企业补充答复中的前提（如“项目可替年限，但还要独立验收记录”）
          // 约束整组替代路径：把同组其余概念一并纳入
          const involvedGroups = unique(onConcepts.map((c) => groupOfConcept.get(c)).filter(Boolean));
          for (const [concept, group] of groupOfConcept.entries()) {
            if (involvedGroups.includes(group) && !onConcepts.includes(concept)) onConcepts.push(concept);
          }
        }
        const gateCond = build(posting, gateText, {
          kind: 'mandatory',
          gate: { onConcepts: onConcepts.length ? unique(onConcepts) : null },
          locator: locate(posting.text, gateText),
        });
        // 前提是独立 AND 条件，不参与选项互斥
        gateCond.alternativeGroup = null;
      }
    }
  }

  return conditions;
}

// 条件分组视图：选项组（OR）与独立条件（AND）。
export function summarizeConditionGroups(conditions) {
  const groups = new Map();
  const standalone = [];
  for (const cond of conditions) {
    if (cond.alternativeGroup) {
      if (!groups.has(cond.alternativeGroup)) groups.set(cond.alternativeGroup, []);
      groups.get(cond.alternativeGroup).push(cond);
    } else {
      standalone.push(cond);
    }
  }
  return { optionGroups: [...groups.entries()].map(([groupId, items]) => ({ groupId, items })), standalone };
}
