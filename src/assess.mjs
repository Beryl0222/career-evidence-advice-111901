// 资格判定引擎：把条件与证据事实做概念级匹配，产出符合 / 可能符合 / 无法凭现有来源判断。
// 关键规则：
//  - non_event（相关但未发生）永远不能支持任何条件；
//  - 选项组内满足其一即可（OR），独立必备条件全部要满足（AND）；优先条件不影响总体结论；
//  - 带前提的条件，前提不满足时整条替代路径不成立；
//  - 同一段经历不能在两个明确不可合用的条件里重复充当；前提与主选项共用同一段经历是允许的；
//  - 只能证明一部分的摘要不得判定为整条满足；
//  - 对外视角仅使用授权给 employer+application 且在 shareable 范围内的事实。
import { visibleFacts, permissionFor, factUsable } from './authz.mjs';
import { projectOfStatement } from './review.mjs';
import { summarizeConditionGroups } from './extract.mjs';

export const VERDICTS = {
  MET: '符合',
  POSSIBLE: '可能符合',
  UNKNOWN: '无法凭现有来源判断',
};

function projectKeyOf(state, fact) {
  const link = projectOfStatement(state, fact.statementId);
  return link ? link.id : fact.statementId;
}

function matchFacts(state, condition, facts) {
  return facts.filter((f) => {
    if (f.type === 'non_event' || f.type === 'project_identity') return false;
    const concepts = f.concepts?.length ? f.concepts : (f.concept ? [f.concept] : []);
    if (condition.concept !== 'other') return concepts.includes(condition.concept);
    // 无概念条件退化为关键词重合，且不采信非事件
    return condition.label.split(/[，,。；;的]+/).some((w) => w.length >= 2 && f.fragment.includes(w));
  });
}

function yearsEvidence(facts) {
  // 年限条件：需要期间类事实或明确年限表述；培训、验收等单点事件不折算为年限。
  const periodFacts = facts.filter((f) => f.type === 'period' || /[0-9一二两三四五六七八九十]年/.test(f.fragment));
  const totalYears = periodFacts.reduce((sum, f) => {
    const m = f.fragment.match(/([0-9]+)\s*年/);
    return sum + (m ? Number(m[1]) : 0);
  }, 0);
  return { periodFacts, totalYears };
}

// 评估单个条件，返回结论与证据链。
function evaluateCondition(state, condition, facts, audience) {
  const supporting = matchFacts(state, condition, facts);
  const evidence = supporting.map((f) => {
    const usable = factUsable(state, f, audience);
    return {
      factId: f.id,
      statementId: f.statementId,
      projectKey: projectKeyOf(state, f),
      role: f.role,
      attestation: f.attestation,
      usable: usable.usable,
      scopeReason: usable.reason,
      fragment: f.fragment,
    };
  });

  let verdict = VERDICTS.UNKNOWN;
  let note = '现有来源中没有可用证据';
  const blockers = [];

  if (condition.needsClarification) {
    blockers.push(`需企业先澄清认定口径：${condition.clarificationNote}`);
  }

  if (supporting.length === 0) {
    return { conditionId: condition.id, condition, verdict, note, evidence, blockers, requirements: [condition.label] };
  }

  // 年限条件特殊处理：不满足年数则不能判符合
  if (condition.concept === 'experience_years' && condition.yearsRequired) {
    const { periodFacts, totalYears } = yearsEvidence(supporting);
    if (periodFacts.length && totalYears >= condition.yearsRequired) {
      verdict = VERDICTS.MET;
      note = `有可核算期间证据，合计约 ${totalYears} 年`;
    } else if (periodFacts.length) {
      verdict = VERDICTS.POSSIBLE;
      note = `期间证据约 ${totalYears} 年，低于要求的 ${condition.yearsRequired} 年`;
      blockers.push(`年限差额：要求 ${condition.yearsRequired} 年，现可核算 ${totalYears} 年`);
    } else {
      verdict = VERDICTS.POSSIBLE;
      note = '只有相关事件，无年限核算依据，不能折算为年限';
      blockers.push('缺少可核算的期间材料（培训/单点项目不折算年限）');
    }
    return { conditionId: condition.id, condition, verdict, note, evidence, blockers, requirements: [condition.label] };
  }

  const hasAttestedSelf = evidence.some((e) => e.role === 'self' && e.attestation && e.usable);
  const hasSelf = evidence.some((e) => e.role === 'self' && e.usable);
  const onlyTeam = evidence.length > 0 && evidence.every((e) => e.role === 'team');
  // 培训/实训类单点事件不构成交付或年限证据，避免把“参加过培训”抬升为“可能符合交付”
  const onlyTraining = supporting.length > 0
    && supporting.every((f) => f.stage === 'training' || f.concepts?.includes('training'));

  if (hasAttestedSelf) {
    verdict = VERDICTS.MET;
    note = '有证明材料支持的本人完成事实';
  } else if (hasSelf) {
    verdict = VERDICTS.POSSIBLE;
    note = '本人完成来自自述/简历，尚缺证明材料';
    blockers.push('缺一份可对外的项目证明');
  } else if (onlyTeam && !onlyTraining) {
    verdict = VERDICTS.POSSIBLE;
    note = '仅有团队层面事实，本人独立部分未获证明';
    blockers.push('需补能证明本人独立贡献的材料');
  } else if (onlyTraining) {
    verdict = VERDICTS.UNKNOWN;
    note = '只有培训/实训记录，不构成交付或年限证据';
    blockers.push('培训不能替代完整交付或工作年限，需补实际交付/验收材料');
  }

  return { conditionId: condition.id, condition, verdict, note, evidence, blockers, requirements: [condition.label] };
}

// 找到约束某概念的前提条件。
function gatesFor(condition, allConditions) {
  return allConditions.filter(
    (c) => c.gate && c.gate.onConcepts && c.gate.onConcepts.includes(condition.concept),
  );
}

// 使用登记：前提与主选项共用经历合法；两个互斥条件（不同选项组/独立条件）重复使用则报警。
function registerClaims(claims, result, { alternativeGroup = null, isGate = false, ownerConditionId = null }) {
  for (const e of result.evidence.filter((x) => x.usable)) {
    claims.push({
      projectKey: e.projectKey,
      factId: e.factId,
      conditionId: result.conditionId,
      alternativeGroup,
      isGate,
      ownerConditionId,
    });
  }
}

function findDoubleUse(claims) {
  const violations = [];
  const byProject = new Map();
  for (const claim of claims) {
    if (!byProject.has(claim.projectKey)) byProject.set(claim.projectKey, []);
    byProject.get(claim.projectKey).push(claim);
  }
  for (const [projectKey, list] of byProject) {
    const owners = new Set();
    for (const c of list) {
      // 同一选项组内、或前提与其主选项之间共用，均为同一条资格路径，不算重复。
      // 前提归并到主选项所属的选项组键上。
      const key = c.isGate
        ? (c.alternativeGroup ?? `gate-of:${c.ownerConditionId}`)
        : (c.alternativeGroup ?? c.conditionId);
      owners.add(key);
    }
    if (owners.size > 1) {
      violations.push({
        projectKey,
        conditionIds: [...new Set(list.map((c) => c.conditionId))],
        reason: '同一段经历被重复用于两个明确不可合用的条件，必须另找证据或放弃其一',
      });
    }
  }
  return violations;
}

export function assess(state, { student, audience = 'counselling' }) {
  const conditions = state.conditions;
  const facts = visibleFacts(state, audience, student);
  // 前提条件只在其主选项下评估，不作为独立 AND 条件重复参与
  const { optionGroups, standalone } = summarizeConditionGroups(
    conditions.filter((c) => !c.gate),
  );
  const claims = [];
  const conditionResults = new Map();

  // 独立条件（AND），优先条件单独标注、不参与总体结论
  const standaloneMandatory = [];
  const preferredResults = [];
  for (const cond of standalone) {
    const result = evaluateCondition(state, cond, facts, audience);
    conditionResults.set(cond.id, result);
    registerClaims(claims, result, {});
    if (cond.kind === 'preferred') preferredResults.push(result);
    else standaloneMandatory.push(result);
  }

  // 选项组（OR），并附加各自前提
  const groupResults = optionGroups.map((group) => {
    const options = group.items.map((cond) => {
      const result = evaluateCondition(state, cond, facts, audience);
      conditionResults.set(cond.id, result);
      registerClaims(claims, result, { alternativeGroup: group.groupId });
      const gates = gatesFor(cond, conditions).map((gateCond) => {
        const gateResult = evaluateCondition(state, gateCond, facts, audience);
        conditionResults.set(gateCond.id, gateResult);
        registerClaims(claims, gateResult, { isGate: true, ownerConditionId: cond.id, alternativeGroup: group.groupId });
        return { gateConditionId: gateCond.id, ...gateResult };
      });
      return { option: cond, result, gates };
    });

    // 路径成立：选项有证据，且其全部前提不低于可能、无阻断
    const viable = options
      .filter((o) => o.result.verdict !== VERDICTS.UNKNOWN)
      .map((o) => {
        const gateVerdicts = o.gates.map((g) => g.verdict);
        const gateBlocks = o.gates.flatMap((g) => g.blockers);
        let pathVerdict = o.result.verdict;
        if (gateVerdicts.includes(VERDICTS.UNKNOWN)) {
          pathVerdict = VERDICTS.POSSIBLE;
        } else if (gateVerdicts.includes(VERDICTS.POSSIBLE) && pathVerdict === VERDICTS.MET) {
          pathVerdict = VERDICTS.POSSIBLE;
        }
        return {
          concept: o.option.concept,
          optionConditionId: o.option.id,
          verdict: pathVerdict,
          note: o.result.note,
          blockers: [...o.result.blockers, ...gateBlocks],
          gateDetails: o.gates,
        };
      });

    let groupVerdict = VERDICTS.UNKNOWN;
    if (viable.some((v) => v.verdict === VERDICTS.MET)) groupVerdict = VERDICTS.MET;
    else if (viable.length) groupVerdict = VERDICTS.POSSIBLE;

    return { groupId: group.groupId, verdict: groupVerdict, options: viable, allOptions: options };
  });

  // 总体结论只看必备：独立必备 AND 选项组；优先（证书等）缺失不影响
  const mandatoryVerdicts = [
    ...standaloneMandatory.map((r) => r.verdict),
    ...groupResults.map((g) => g.verdict),
  ];
  let overall = VERDICTS.MET;
  if (mandatoryVerdicts.includes(VERDICTS.UNKNOWN)) overall = VERDICTS.UNKNOWN;
  else if (mandatoryVerdicts.includes(VERDICTS.POSSIBLE)) overall = VERDICTS.POSSIBLE;

  const gaps = buildGaps({ standaloneResults: standaloneMandatory, groupResults });
  const doubleUseWarnings = findDoubleUse(claims);

  return {
    student,
    audience,
    overall,
    standalone: standaloneMandatory,
    preferred: preferredResults,
    optionGroups: groupResults,
    doubleUseWarnings,
    gaps,
    generatedAt: new Date().toISOString(),
  };
}

function buildGaps({ standaloneResults, groupResults }) {
  const missingMandatory = [];
  const canSupplement = [];
  for (const r of standaloneResults) {
    if (r.verdict === VERDICTS.UNKNOWN) {
      missingMandatory.push({ conditionId: r.conditionId, label: r.requirements[0], blockers: r.blockers });
    } else if (r.blockers.length) {
      canSupplement.push({ conditionId: r.conditionId, label: r.requirements[0], blockers: r.blockers });
    }
  }
  for (const g of groupResults) {
    for (const opt of g.options) {
      if (opt.blockers.length) {
        canSupplement.push({ conditionId: opt.optionConditionId, label: opt.concept, blockers: opt.blockers });
      }
      // 路径上的前提若无法判断，属于明确缺口，必须点名差哪项必备条件
      for (const gate of opt.gateDetails ?? []) {
        if (gate.verdict === VERDICTS.UNKNOWN) {
          missingMandatory.push({
            conditionId: gate.conditionId,
            label: `前提条件：${gate.condition.label}`,
            blockers: gate.blockers.length ? gate.blockers : ['现有来源没有任何可用证据'],
          });
        } else if (gate.blockers.length) {
          canSupplement.push({ conditionId: gate.conditionId, label: `前提：${gate.condition.label}`, blockers: gate.blockers });
        }
      }
    }
    // 即使整条路径都不可行（如只有培训记录），也要把前提缺口点出来
    for (const opt of g.allOptions) {
      for (const gate of opt.gates) {
        const already = missingMandatory.some((m) => m.conditionId === gate.conditionId)
          || canSupplement.some((m) => m.conditionId === gate.conditionId);
        if (already) continue;
        if (gate.verdict === VERDICTS.UNKNOWN) {
          missingMandatory.push({
            conditionId: gate.conditionId,
            label: `前提条件：${gate.condition.label}`,
            blockers: gate.blockers.length ? gate.blockers : ['现有来源没有任何可用证据'],
          });
        }
      }
    }
    if (g.verdict === VERDICTS.UNKNOWN) {
      missingMandatory.push({
        groupId: g.groupId,
        label: `选项组 ${g.groupId} 中没有任何现有证据支持的路径（培训/单点经历不折算年限或交付）`,
        blockers: [],
      });
    }
  }
  return { missingMandatory, canSupplement };
}
