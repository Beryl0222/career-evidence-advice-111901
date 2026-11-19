// 辅导员复核：同一项目关联、归属疑问与冲突、以及“同段经历不得重复充当”的使用登记。
import { newId } from './util.mjs';

// 学生确认：两份（或多份）材料讲的是同一个项目。
export function linkProject(state, { student, statementIds, projectName, note = '' }) {
  const known = state.projectLinks.find(
    (l) => l.student === student && l.projectName === projectName,
  );
  if (known) {
    for (const id of statementIds) if (!known.statementIds.includes(id)) known.statementIds.push(id);
    known.note = note || known.note;
    return known;
  }
  const link = {
    id: newId('PL'),
    student,
    projectName,
    statementIds: [...statementIds],
    note,
    confirmedAt: new Date().toISOString(),
  };
  state.projectLinks.push(link);
  return link;
}

export function projectOfStatement(state, statementId) {
  return state.projectLinks.find((l) => l.statementIds.includes(statementId)) ?? null;
}

// 冲突/归属疑问检测：
// 1) 同一项目同一阶段，出现“本人完成”与“未参与/未发生”两种互斥说法；
// 2) 同一项目同一阶段，独立完成（self）与团队完成（team）并存，归属仍有疑问。
export function detectReviewFlags(state) {
  const flags = [];
  const factsByProject = new Map(); // projectKey -> facts
  for (const fact of state.facts) {
    const link = projectOfStatement(state, fact.statementId);
    const projectKey = link ? link.id : fact.statementId; // 未关联时每份材料各自独立
    if (!factsByProject.has(projectKey)) factsByProject.set(projectKey, []);
    factsByProject.get(projectKey).push(fact);
  }

  for (const [projectKey, facts] of factsByProject) {
    const byStage = new Map();
    for (const fact of facts) {
      const key = fact.stage ?? fact.concept ?? 'general';
      if (!byStage.has(key)) byStage.set(key, []);
      byStage.get(key).push(fact);
    }
    for (const [stage, group] of byStage) {
      const hasNonEvent = group.some((f) => f.type === 'non_event');
      const hasSelf = group.some((f) => f.role === 'self' && f.type !== 'non_event');
      const hasTeam = group.some((f) => f.role === 'team');
      const reasons = [];
      if (hasNonEvent && hasSelf) reasons.push('同一阶段同时存在“本人完成”与“未参与/未发生”的互斥说法');
      if (hasSelf && hasTeam) reasons.push('同一阶段独立完成与团队完成并存，本人独立归属仍有疑问');
      if (reasons.length) {
        flags.push({
          id: newId('RV'),
          projectKey,
          stage,
          factIds: group.map((f) => f.id),
          reasons,
          status: 'open',
          resolution: null,
          resolvedBy: null,
          resolvedAt: null,
        });
      }
    }
  }
  return flags;
}

export function refreshReviewFlags(state) {
  const incoming = detectReviewFlags(state);
  for (const flag of incoming) {
    const exists = state.reviewFlags.find(
      (f) => f.status === 'open' && f.projectKey === flag.projectKey && f.stage === flag.stage,
    );
    if (!exists) state.reviewFlags.push(flag);
  }
  return state.reviewFlags.filter((f) => f.status === 'open');
}

export function resolveReviewFlag(state, flagId, { resolution, advisor }) {
  const flag = state.reviewFlags.find((f) => f.id === flagId);
  if (!flag) throw new Error(`复核项不存在：${flagId}`);
  flag.status = 'resolved';
  flag.resolution = resolution; // 例如“采信 S2：本人独立组织验收”
  flag.resolvedBy = advisor;
  flag.resolvedAt = new Date().toISOString();
  return flag;
}

// 同段经历使用登记：conditionId -> 使用的事实/项目键。
// 选项组内各选项视为同一条“或条件”，共用经历不违规；
// 跨越明确不可合用的独立条件重复使用同一段经历时报警。
export function checkDoubleUse(usages) {
  // usages: [{ conditionId, alternativeGroup, projectKey, factIds }]
  const projectToConditions = new Map();
  for (const u of usages) {
    if (!u.projectKey) continue;
    if (!projectToConditions.has(u.projectKey)) projectToConditions.set(u.projectKey, []);
    projectToConditions.get(u.projectKey).push(u);
  }
  const violations = [];
  for (const [projectKey, list] of projectToConditions) {
    const groups = new Set(list.map((u) => u.alternativeGroup ?? u.conditionId));
    if (groups.size > 1) {
      violations.push({
        projectKey,
        conditionIds: [...new Set(list.map((u) => u.conditionId))],
        reason: '同一段经历被重复用于两个明确不可合用的条件，必须另找证据或放弃其一',
      });
    }
  }
  return violations;
}
