// 中文文本报告：条件清单、事实分级、双视角判定、缺口、授权矩阵、申请摘要与审计。
import { FACT_TYPE_LABEL, ROLE_LABEL } from './evidence.mjs';
import { VERDICTS } from './assess.mjs';
import { permissionFor, AUDIENCES } from './authz.mjs';

const LINE = '─'.repeat(64);

function verdictMark(v) {
  return v === VERDICTS.MET ? '✔ 符合' : v === VERDICTS.POSSIBLE ? '◐ 可能符合' : '✘ 无法判断';
}

export function reportConditions(state) {
  const out = ['招聘条件抽取（保留原句定位）', LINE];
  for (const c of state.conditions) {
    const kind = c.kind === 'preferred' ? '优先' : '必备';
    const alt = c.alternativeGroup ? ` [选项组 ${c.alternativeGroup}，组内满足其一]` : '';
    const gate = c.gate ? ` [带前提，约束：${c.gate.onConcepts?.join('/') ?? '未定位'}]` : '';
    const clarify = c.needsClarification ? ` [待企业澄清：${c.clarificationNote}]` : '';
    const years = c.yearsRequired ? `（年限要求 ${c.yearsRequired} 年）` : '';
    out.push(`${c.id} [${kind}] 概念=${c.concept}${years}${alt}${gate}${clarify}`);
    out.push(`   来源 ${c.sourcePostingId} 定位[${c.locator.start},${c.locator.end}]：${c.locator.excerpt}`);
  }
  return out.join('\n');
}

export function reportFacts(state) {
  const out = ['证据事实解析', LINE];
  for (const f of state.facts) {
    const perm = permissionFor(state, f.statementId);
    const scope = perm?.shareable ? ` 公开范围限定：${perm.shareable}` : '';
    out.push(`${f.id} 来源=${f.statementId}(${f.source}) 类型=${FACT_TYPE_LABEL[f.type]} 归属=${ROLE_LABEL[f.role] ?? f.role}${f.attestation ? ' 含证明' : ''}`);
    out.push(`   概念=${f.concept ?? '-'} 阶段=${f.stage ?? '-'} 定位[${f.locator.start},${f.locator.end}]：${f.fragment}${scope}`);
  }
  return out.join('\n');
}

export function reportReview(state) {
  const out = ['辅导员复核队列', LINE];
  const open = state.reviewFlags.filter((f) => f.status === 'open');
  if (!open.length) {
    out.push('无待核实项。');
  }
  for (const flag of open) {
    out.push(`${flag.id} 项目=${flag.projectKey} 阶段=${flag.stage} 事实=${flag.factIds.join(',')}`);
    for (const r of flag.reasons) out.push(`   - ${r}`);
  }
  const resolved = state.reviewFlags.filter((f) => f.status === 'resolved');
  if (resolved.length) {
    out.push('', '已核实：');
    for (const flag of resolved) out.push(`${flag.id} -> ${flag.resolution}（${flag.resolvedBy}）`);
  }
  return out.join('\n');
}

function reportResult(r, indent = '  ') {
  const out = [`${indent}${verdictMark(r.verdict)} 条件 ${r.conditionId}：${r.note}`];
  for (const e of r.evidence) {
    const tag = e.usable ? '可引用' : `不可引用（${e.scopeReason}）`;
    out.push(`${indent}   - [${tag}] ${e.statementId}/${e.factId} ${ROLE_LABEL[e.role] ?? e.role}${e.attestation ? '·证明' : ''}：${e.fragment}`);
  }
  for (const b of r.blockers) out.push(`${indent}   阻断/缺口：${b}`);
  return out;
}

export function reportAssessment(assessment) {
  const out = [
    `资格判定（${AUDIENCES[assessment.audience].label}，学生 ${assessment.student}）`,
    LINE,
    `总体结论：${verdictMark(assessment.overall)}`,
    '',
    '独立必备条件（AND）：',
  ];
  for (const r of assessment.standalone) out.push(...reportResult(r));
  if (assessment.preferred?.length) {
    out.push('', '优先条件（不影响必备资格结论）：');
    for (const r of assessment.preferred) out.push(...reportResult(r));
  }
  out.push('', '选项组（OR，满足其一即可，含前提）：');
  for (const g of assessment.optionGroups) {
    out.push(`  选项组 ${g.groupId} -> ${verdictMark(g.verdict)}`);
    for (const opt of g.options) {
      out.push(`    路径 概念=${opt.concept} 条件=${opt.optionConditionId} -> ${verdictMark(opt.verdict)}：${opt.note}`);
      for (const b of opt.blockers) out.push(`       缺口：${b}`);
      for (const gate of opt.gateDetails ?? []) out.push(...reportResult(gate, '       前提 '));
    }
  }
  if (assessment.doubleUseWarnings.length) {
    out.push('', '重复使用警告：');
    for (const w of assessment.doubleUseWarnings) out.push(`  - ${w.reason}（项目 ${w.projectKey}，条件 ${(w.conditionIds ?? []).join('、')}）`);
  }
  out.push('', '说明：本工具用于辅导与申请材料准备，录用仍由企业决定。');
  return out.join('\n');
}

export function reportGaps(assessment) {
  const out = ['缺口与补料清单', LINE];
  if (!assessment.gaps.missingMandatory.length && !assessment.gaps.canSupplement.length) {
    out.push('当前视角下无缺口。');
    return out.join('\n');
  }
  if (assessment.gaps.missingMandatory.length) {
    out.push('明确不符合/无法判断的必备条件：');
    for (const g of assessment.gaps.missingMandatory) {
      out.push(`  - ${g.label}${g.blockers.length ? `（${g.blockers.join('；')}）` : ''}`);
    }
  }
  if (assessment.gaps.canSupplement.length) {
    out.push('', '可以补材料转符合的项：');
    for (const g of assessment.gaps.canSupplement) {
      out.push(`  - ${g.label}：${g.blockers.join('；')}`);
    }
  }
  return out.join('\n');
}

export function reportAuthMatrix(state, student) {
  const out = ['材料授权矩阵（未列出的对象/用途即无许可）', LINE];
  out.push('材料    来源      可见对象                         用途                  shareable 限定');
  for (const s of state.statements.filter((x) => x.student === student)) {
    const p = permissionFor(state, s.id);
    if (!p) {
      out.push(`${s.id.padEnd(6)}${s.source.padEnd(8)}无授权记录`);
      continue;
    }
    out.push(
      `${s.id.padEnd(6)}${s.source.padEnd(8)}${p.readers.join('/').padEnd(30)}${p.uses.join('/').padEnd(20)}${p.shareable ?? '无（原文整体受 readers 限制）'}`,
    );
  }
  return out.join('\n');
}

export function reportApplication(state, app) {
  const out = [`申请材料 ${app.id}（${app.name}，状态=${app.status}）`, LINE];
  for (const s of app.statements) {
    const tag = s.authorized ? '已授权可外发' : '未授权/超范围';
    const partial = s.partial ? '【部分证明，不得表述为整条满足】' : '';
    out.push(`- [${tag}]${partial} 条件=${s.conditionId} 来源=${s.statementId}`);
    out.push(`  ${s.text}`);
    if (s.authReason) out.push(`  原因：${s.authReason}`);
  }
  if (app.snapshots.length) {
    out.push('', '已发送快照（可查当时授权范围）：');
    for (const snap of app.snapshots) {
      out.push(`  ${snap.id} 发送于 ${snap.sentAt} 给 ${snap.sentTo}，共 ${snap.entries.length} 句`);
      for (const e of snap.entries) {
        out.push(`    - ${e.text} | 授权 readers=${e.permission.readers.join('/')} uses=${e.permission.uses.join('/')}${e.partial ? ' | 部分证明' : ''}`);
      }
    }
  }
  if (app.lastRejudge) {
    out.push('', `最近重判（${app.lastRejudge.at}，触发：${app.lastRejudge.trigger}）：`);
    for (const ch of app.lastRejudge.changes) {
      out.push(`  - ${ch.statementId} ${ch.outcome}：${ch.reason ?? ''} ${ch.text}`);
    }
  }
  return out.join('\n');
}

export function reportAudit(state) {
  const out = ['授权与操作留痕', LINE];
  if (!state.audit.length) {
    out.push('暂无留痕。');
    return out.join('\n');
  }
  for (const e of state.audit) {
    out.push(`${e.at} ${e.action} ${e.applicationId ?? e.statementId ?? ''} ${e.use ?? ''}`.trimEnd());
    if (e.before) out.push(`   前：readers=${e.before.readers.join('/')} uses=${e.before.uses.join('/')}`);
    if (e.after) out.push(`   后：readers=${e.after.readers.join('/')} uses=${e.after.uses.join('/')}`);
    if (e.trigger) out.push(`   触发：${e.trigger}`);
  }
  return out.join('\n');
}
