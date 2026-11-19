// 证据解析：把每份 statement 拆成结构化事实。
// 四类核心区分：
//   self                  本人完成
//   team                  团队完成（本人参与度未证明为独立）
//   related_not_occurred  相关但未发生（“未参与/没有”）
//   period / capability   能证明的期间与能力
// 不做相似词推断：被否定的阶段（如“未参与上线”）永远不会被算成交付/上线经验。
import {
  SELF_MARKERS, TEAM_MARKERS, NEGATION_MARKERS, ATTESTATION_MARKERS,
  PERIOD_MARKERS, CAPABILITY_MARKERS, LIFECYCLE_STAGES, FACT_CONCEPTS,
  findConcept, includesAny,
} from './keywords.mjs';
import { locate, newId } from './util.mjs';

function splitSubClauses(text) {
  return text
    .split(/[。；;！？!?，,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function detectStage(text) {
  for (const [stage, words] of LIFECYCLE_STAGES) {
    if (words.some((w) => text.includes(w))) return stage;
  }
  return null;
}

function detectNegation(text) {
  const hit = NEGATION_MARKERS.find((m) => text.includes(m));
  return hit ? { marker: hit, index: text.indexOf(hit) } : null;
}

function detectRole(text) {
  if (includesAny(text, SELF_MARKERS)) return 'self';
  if (includesAny(text, TEAM_MARKERS)) return 'team';
  return null;
}

function detectPeriod(text) {
  // 含“期间/暑期/寒假/学期”等时间表述即视为可证明期间，不要求出现具体年份
  const hasPeriodWord = PERIOD_MARKERS.some((m) => m !== '年' && m !== '月' && text.includes(m));
  if (!hasPeriodWord && !/[0-9一二两三四五六七八九十]+年/.test(text)) return null;
  const m = text.match(/(?:期间为|期间|时间为)?([^，,。；;]*(?:暑期|寒假|学期|[0-9一二两三四五六七八九十]+年(?:[0-9一二两三四五六七八九十]+月)?|[0-9]+个?月)[^，,。；;]*)/);
  return { raw: m ? m[1].trim() : text.trim() };
}

function detectCapabilities(text) {
  const caps = [];
  for (const marker of CAPABILITY_MARKERS) {
    let idx = text.indexOf(marker);
    while (idx >= 0) {
      const fragment = text.slice(Math.max(0, idx - 6), idx + marker.length + 4);
      if (!caps.includes(fragment)) caps.push(fragment);
      idx = text.indexOf(marker, idx + marker.length);
    }
  }
  return caps;
}

function allConcepts(text) {
  const found = [];
  for (const [concept, words] of Object.entries(FACT_CONCEPTS)) {
    if (words.some((w) => text.includes(w))) found.push(concept);
  }
  return found;
}

function makeFact(statement, fragment, extra) {
  const concepts = allConcepts(fragment);
  return {
    id: newId('F'),
    statementId: statement.id,
    student: statement.student,
    source: statement.source,
    fragment,
    locator: locate(statement.text, fragment),
    role: null,
    type: 'event',
    stage: null,
    concept: concepts[0] ?? null,
    concepts,
    attestation: includesAny(statement.source, ATTESTATION_MARKERS) || includesAny(fragment, ATTESTATION_MARKERS),
    period: null,
    capabilities: [],
    negated: false,
    ...extra,
  };
}

export function parseStatement(statement) {
  const facts = [];
  for (const clause of splitSubClauses(statement.text)) {
    const neg = detectNegation(clause);
    const stage = detectStage(clause);
    const role = detectRole(clause);
    const period = detectPeriod(clause);
    const capabilities = detectCapabilities(clause);

    // 0) 项目同一性陈述（“……是同一项目”）：只用于同一项目关联，不参与条件匹配
    if (/同一项目|同一件事|同一回事/.test(clause)) {
      facts.push(makeFact(statement, clause, {
        type: 'project_identity',
        role: null,
        stage: null,
        concept: null,
        concepts: [],
      }));
      continue;
    }

    // 1) 相关但未发生：整段被否定（如“我未参与上线”）
    if (neg && (stage || allConcepts(clause).length)) {
      const concepts = allConcepts(clause);
      facts.push(makeFact(statement, clause, {
        type: 'non_event',
        role: 'none',
        stage,
        concept: concepts[0] ?? null,
        concepts,
        negated: true,
      }));
      continue;
    }

    // 2) 纯期间事实（如“执行期间为暑期”）：只生成期间事实，不再重复生成事件事实。
    //    仅含“执行/实施”这类泛化阶段词、没有验收/评审/上线/培训等具体事件时，按期间处理。
    const hasConcreteStage = ['验收', '评审', '上线', '投产', '发布', '培训', '实训'].some((w) => clause.includes(w));
    if (period && (!hasConcreteStage)) {
      facts.push(makeFact(statement, clause, {
        type: 'period',
        period,
        role: role ?? 'self',
        stage: null,
        concept: null,
        concepts: [],
      }));
      continue;
    }

    // 3) 能力/职责事实
    if (capabilities.length && !stage) {
      facts.push(makeFact(statement, clause, {
        type: 'capability',
        role: role ?? 'self',
        capabilities,
        period,
      }));
      continue;
    }

    // 4) 事件事实：本人完成 / 团队完成
    if (stage || findConcept(clause, FACT_CONCEPTS) || role) {
      facts.push(makeFact(statement, clause, {
        type: 'event',
        role: role ?? 'team', // 无独立/本人线索时，保守归为团队层面，不抬升为本人独立
        stage,
        period,
        capabilities,
      }));
    }
  }
  return facts;
}

export function parseAllStatements(state) {
  return state.statements.flatMap(parseStatement);
}

export const FACT_TYPE_LABEL = {
  event: '事件经历',
  non_event: '相关但未发生',
  period: '可证明期间',
  capability: '能力/职责',
  project_identity: '同一项目说明',
};

export const ROLE_LABEL = {
  self: '本人完成',
  team: '团队完成',
  none: '未发生/未参与',
};
