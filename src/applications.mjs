// 申请材料准备：对外摘要的每一句都必须同时满足
//   1) 授权给 employer + application；2) 落在 shareable 获准事实范围内；3) 有足够证据支撑整条条件。
// 只能证明一部分的摘要不得写成“已满足整条条件”。
// 发送时保存快照（当时授权范围与证据），授权撤回或条件变化后逐句重判并标出需更正处。
import { newId } from './util.mjs';
import { permissionFor, factUsable } from './authz.mjs';
import { VERDICTS } from './assess.mjs';

export function createApplication(state, { student, jobId, name }) {
  const app = {
    id: newId('APP'),
    student,
    jobId,
    name: name ?? `申请 ${jobId}`,
    status: 'draft',
    statements: [], // 摘要句
    snapshots: [],
    createdAt: new Date().toISOString(),
  };
  state.applications.push(app);
  return app;
}

// 依据评估结果自动起草候选句，只纳入在对外视角可用、且证据足以支持该条件结论的事实。
export function draftFromAssessment(state, app, assessment) {
  for (const r of assessment.standalone) {
    pushEvidenceStatements(state, app, r, assessment.audience);
  }
  for (const group of assessment.optionGroups) {
    for (const opt of group.options) {
      if (opt.verdict === VERDICTS.UNKNOWN) continue;
      const detail = group.allOptions.find((o) => o.option.id === opt.optionConditionId);
      if (detail) pushEvidenceStatements(state, app, detail.result, assessment.audience, { groupId: group.groupId });
      for (const gate of opt.gateDetails ?? []) pushEvidenceStatements(state, app, gate, assessment.audience, { gate: true });
    }
  }
  return app.statements;
}

function pushEvidenceStatements(state, app, result, audience, extra = {}) {
  for (const e of result.evidence) {
    const fact = state.facts.find((f) => f.id === e.factId);
    const usable = factUsable(state, fact, audience);
    const wording = usable.usable
      ? `可对外陈述：${e.fragment}`
      : `（仅辅导可见，不得外发）${e.fragment}`;
    // 部分证明：该条件整体未达“符合”，或本句证据只是团队/无证明材料时，
    // 都不能写成“已满足整条条件”。
    const partial = result.verdict !== VERDICTS.MET
      || !(e.role === 'self' && e.attestation);
    app.statements.push({
      id: newId('ST'),
      conditionId: result.conditionId,
      factId: e.factId,
      statementId: e.statementId,
      text: wording,
      partial,
      authorized: usable.usable,
      authReason: usable.reason,
      shareableScope: permissionFor(state, e.statementId)?.shareable ?? null,
      ...extra,
      status: 'pending',
    });
  }
}

export function addStatement(state, appId, payload) {
  const app = state.applications.find((a) => a.id === appId);
  if (!app) throw new Error(`申请不存在：${appId}`);
  const stmt = { id: newId('ST'), status: 'pending', partial: false, authorized: false, ...payload };
  app.statements.push(stmt);
  return stmt;
}

// 发送前校验：未授权句、部分证明写成整条满足的句子一律拦截。
export function validateForSending(state, app) {
  const problems = [];
  for (const stmt of app.statements) {
    if (!stmt.authorized) problems.push({ statementId: stmt.id, reason: '未获对外授权或超出 shareable 范围' });
    if (stmt.partial && /已满足|完全符合|具备.*资格/.test(stmt.text)) {
      problems.push({ statementId: stmt.id, reason: '仅部分证明，不能写成已满足整条条件' });
    }
  }
  return problems;
}

export function sendApplication(state, appId, { sentTo }) {
  const app = state.applications.find((a) => a.id === appId);
  if (!app) throw new Error(`申请不存在：${appId}`);
  const problems = validateForSending(state, app);
  if (problems.length) {
    return { sent: false, problems };
  }
  const snapshot = {
    id: newId('SN'),
    sentAt: new Date().toISOString(),
    sentTo,
    // 当时每句的授权范围与证据，供日后审计
    entries: app.statements.map((s) => ({
      statementId: s.id,
      text: s.text,
      sourceStatement: s.statementId,
      permission: permissionFor(state, s.statementId),
      factId: s.factId,
      partial: s.partial,
    })),
  };
  app.snapshots.push(snapshot);
  app.status = 'sent';
  return { sent: true, snapshot };
}

// 逐句重判：授权撤回、shareable 收窄或条件变化后调用。
// 检查两个维度：
//   A. 授权维度——事实在当前对外视角是否仍可引用；
//   B. 充分性维度——结合当前条件下的评估结果，该句是否仍足以支持其条件结论。
// 未发送草稿：剔除失据句，保留仍有依据的内容；
// 已发送版本：保留快照可查，标出需提醒企业更正/降级表述的句子。
export function rejudge(state, appId, { trigger, assessment = null }) {
  const app = state.applications.find((a) => a.id === appId);
  if (!app) throw new Error(`申请不存在：${appId}`);
  const changes = [];

  // 条件变化时，用最新评估重建“条件 -> 结论/证据”索引
  const verdictByCondition = new Map();
  const sufficientEvidence = new Set(); // 仍足以支持整条条件的 factId
  if (assessment) {
    const collect = (r) => {
      verdictByCondition.set(r.conditionId, r.verdict);
      if (r.verdict === VERDICTS.MET) {
        for (const e of r.evidence.filter((x) => x.usable && x.role === 'self' && x.attestation)) {
          sufficientEvidence.add(`${r.conditionId}:${e.factId}`);
        }
      }
    };
    assessment.standalone.forEach(collect);
    assessment.preferred?.forEach(collect);
    for (const group of assessment.optionGroups) {
      for (const opt of group.allOptions) {
        collect(opt.result);
        opt.gates.forEach(collect);
      }
    }
  }

  for (const stmt of app.statements) {
    const fact = state.facts.find((f) => f.id === stmt.factId);
    if (!fact) {
      changes.push({ statementId: stmt.id, outcome: 'evidence_removed', text: stmt.text });
      stmt.authorized = false;
      continue;
    }
    // A. 授权维度
    const usable = factUsable(state, fact, 'application');
    if (stmt.authorized && !usable.usable) {
      stmt.authorized = false;
      stmt.authReason = usable.reason;
      changes.push({
        statementId: stmt.id,
        outcome: app.status === 'sent' ? 'needs_correction_notice' : 'dropped_from_draft',
        reason: usable.reason,
        text: stmt.text,
      });
      continue;
    }
    // B. 充分性维度：条件变化后，原先的整句满足可能只剩部分证明
    if (assessment && stmt.authorized && !stmt.partial) {
      const stillSufficient = sufficientEvidence.has(`${stmt.conditionId}:${stmt.factId}`)
        || verdictByCondition.get(stmt.conditionId) === VERDICTS.MET;
      if (!stillSufficient) {
        stmt.partial = true;
        changes.push({
          statementId: stmt.id,
          outcome: app.status === 'sent' ? 'needs_correction_notice' : 'downgraded_to_partial',
          reason: '条件变化后该句只能证明一部分，不得继续表述为已满足整条条件',
          text: stmt.text,
        });
      }
    }
  }
  if (app.status !== 'sent') {
    app.statements = app.statements.filter((s) => s.authorized || s.status === 'manual');
  }
  app.lastRejudge = { at: new Date().toISOString(), trigger, changes };
  return app.lastRejudge;
}

// 学生撤回某材料的某用途：只改授权并记录，重判由调用方带最新评估统一执行，
// 避免同一次撤回被重判两次、变化被“消费”掉。
export function withdrawConsent(state, { statementId, use, audience = 'application' }, auditFn) {
  const perm = permissionFor(state, statementId);
  if (!perm) throw new Error(`材料无授权记录：${statementId}`);
  const before = { readers: [...perm.readers], uses: [...perm.uses] };
  perm.uses = perm.uses.filter((u) => u !== use);
  if (audience === 'application') perm.readers = perm.readers.filter((r) => r !== 'employer');
  auditFn?.({
    action: 'consent_withdrawn',
    statementId,
    use,
    before,
    after: { readers: [...perm.readers], uses: [...perm.uses] },
  });
  const affectedApplications = state.applications
    .filter((app) => app.statements.some((s) => s.statementId === statementId))
    .map((app) => app.id);
  return { permission: perm, affectedApplications };
}
