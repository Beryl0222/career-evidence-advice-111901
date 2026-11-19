// 端到端规则测试：在内存状态上验证抽取、证据分级、双视角判定、
// 授权裁剪、重判、撤回与防重复使用等关键业务规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_STATE } from '../src/store.mjs';
import { extractConditions } from '../src/extract.mjs';
import { parseAllStatements } from '../src/evidence.mjs';
import { linkProject, refreshReviewFlags, checkDoubleUse } from '../src/review.mjs';
import { assess, VERDICTS } from '../src/assess.mjs';
import { factUsable, isAllowed, permissionFor, withinShareableScope } from '../src/authz.mjs';
import {
  createApplication, draftFromAssessment, sendApplication,
  rejudge, withdrawConsent, validateForSending,
} from '../src/applications.mjs';

const here = dirname(fileURLToPath(import.meta.url));

async function buildState(fixture = 'inputs.json') {
  const raw = JSON.parse(await readFile(resolve(here, '..', 'data', fixture), 'utf8'));
  const state = EMPTY_STATE();
  Object.assign(state, {
    postings: raw.postings,
    statements: raw.statements,
    permissions: raw.permissions,
  });
  state.conditions = extractConditions(state);
  state.facts = parseAllStatements(state);
  return state;
}

function linkSample(state) {
  linkProject(state, { student: 'A1', projectName: '星港', statementIds: ['S1', 'S2', 'S3', 'S4'] });
  return refreshReviewFlags(state);
}

test('条件抽取：必备/优先/替代/前提/待澄清分类并保留原句定位', async () => {
  const state = await buildState();
  const yearsConditions = state.conditions.filter((c) => c.concept === 'experience_years');
  const firstYears = yearsConditions[0];
  assert.equal(firstYears.kind, 'mandatory');
  assert.ok(firstYears.needsClarification, '“相关经历”应标记待企业澄清');
  assert.equal(firstYears.yearsRequired, 2);
  assert.equal(state.conditions.find((c) => c.concept === 'certificate').kind, 'preferred');

  const delivery = state.conditions.find((c) => c.concept === 'full_delivery');
  assert.ok(delivery.alternativeGroup, '完整交付应在替代选项组内');
  assert.ok(yearsConditions.some((c) => c.alternativeGroup === delivery.alternativeGroup), '年限与项目互为替代路径');

  const gate = state.conditions.find((c) => c.concept === 'acceptance_record');
  assert.ok(gate.gate, '独立验收记录是带前提条件');
  assert.deepEqual(gate.locator.start >= 0, true);
  assert.ok(gate.locator.excerpt.includes('独立验收记录'));
});

test('企业补充答复中的前提约束整组替代路径', async () => {
  const state = await buildState();
  const gate = state.conditions.find((c) => c.concept === 'acceptance_record');
  assert.ok(gate.gate.onConcepts.includes('full_delivery'));
  assert.ok(gate.gate.onConcepts.includes('experience_years'));
  // 前提本身不是替代选项
  assert.equal(gate.alternativeGroup, null);
});

test('证据分级：培训不被当交付，“未参与上线”是相关但未发生', async () => {
  const state = await buildState();
  const nonEvents = state.facts.filter((f) => f.type === 'non_event');
  assert.equal(nonEvents.length, 1);
  assert.equal(nonEvents[0].stage, 'launch');
  assert.equal(nonEvents[0].role, 'none');

  const training = state.facts.find((f) => f.fragment.includes('培训'));
  assert.equal(training.stage, 'training');
  assert.equal(training.role, 'team');

  const selfAttested = state.facts.find((f) => f.statementId === 'S2' && f.role === 'self');
  assert.ok(selfAttested.attestation);
  assert.ok(selfAttested.concepts.includes('acceptance_record'), '“交付验收”同时命中交付与验收概念');

  const identity = state.facts.find((f) => f.type === 'project_identity');
  assert.ok(identity, '同一项目说明被识别且不参与条件匹配');
});

test('同一项目关联后，归属冲突进入辅导员复核队列', async () => {
  const state = await buildState();
  const open = linkSample(state);
  assert.ok(open.length >= 1);
  assert.ok(open[0].reasons.some((r) => r.includes('独立完成与团队完成并存')));
  // 未关联前不应产生跨材料冲突
  const fresh = await buildState();
  assert.equal(refreshReviewFlags(fresh).length, 0);
});

test('辅导视角：证明支持的本人事实可判符合，证书缺失不影响总体', async () => {
  const state = await buildState();
  linkSample(state);
  const result = assess(state, { student: 'A1', audience: 'counselling' });
  assert.equal(result.overall, VERDICTS.MET);
  const cert = result.preferred.find((r) => r.condition.concept === 'certificate');
  assert.equal(cert.verdict, VERDICTS.UNKNOWN);
  assert.equal(result.doubleUseWarnings.length, 0, '前提与主选项共用同一段经历不算重复使用');
});

test('对外视角：仅辅导员可见的 S2 被剔除，结论降级且不泄漏原文', async () => {
  const state = await buildState();
  linkSample(state);
  const result = assess(state, { student: 'A1', audience: 'application' });
  const allEvidence = result.optionGroups.flatMap((g) => g.allOptions.flatMap((o) =>
    [o.result, ...o.gates].flatMap((r) => r.evidence)));
  assert.ok(!allEvidence.some((e) => e.statementId === 'S2'), 'S2 不得出现在对外证据链');
  assert.ok(allEvidence.every((e) => e.usable));
});

test('shareable：期间细节不在“组织交付评审”获准范围内', async () => {
  const state = await buildState();
  const reviewFact = state.facts.find((f) => f.statementId === 'S4' && f.fragment.includes('评审'));
  const periodFact = state.facts.find((f) => f.statementId === 'S4' && f.fragment.includes('暑期'));
  const perm = permissionFor(state, 'S4');
  assert.equal(withinShareableScope(reviewFact, perm.shareable), true);
  if (periodFact) assert.equal(withinShareableScope(periodFact, perm.shareable), false);
});

test('授权：未列出的对象或用途没有许可', async () => {
  const state = await buildState();
  const s2 = permissionFor(state, 'S2');
  assert.equal(isAllowed(s2, 'application'), false);
  assert.equal(isAllowed(s2, 'counselling'), true);
  const s3 = permissionFor(state, 'S3');
  assert.equal(s3, null);
  const s3Fact = state.facts.find((f) => f.statementId === 'S3');
  assert.equal(factUsable(state, s3Fact, 'counselling').usable, false);
});

test('申请摘要：未授权事实不得外发，部分证明不得写成整条满足', async () => {
  const state = await buildState();
  linkSample(state);
  const app = createApplication(state, { student: 'A1', jobId: 'P1', name: '测试申请' });
  const external = assess(state, { student: 'A1', audience: 'application' });
  draftFromAssessment(state, app, external);
  assert.ok(!app.statements.some((s) => s.statementId === 'S2' && s.authorized));
  assert.ok(app.statements.some((s) => s.partial), '团队/培训类证据必须标注部分证明');
  const problems = validateForSending(state, app);
  assert.equal(problems.length, 0, '自动起草的句子均通过发送校验');
});

test('发送拦截：手工加入仅辅导员可见材料的句子会被拦截', async () => {
  const state = await buildState();
  linkSample(state);
  const app = createApplication(state, { student: 'A1', jobId: 'P1', name: '测试申请' });
  const s2Fact = state.facts.find((f) => f.statementId === 'S2' && f.role === 'self');
  app.statements.push({
    id: 'ST_x', conditionId: 'C2', factId: s2Fact.id, statementId: 'S2',
    text: '本人独立组织验收，满足完整交付要求', partial: false, authorized: false,
    authReason: '该材料未授权给此对象/用途', status: 'manual',
  });
  const sent = sendApplication(state, app.id, { sentTo: '企业' });
  assert.equal(sent.sent, false);
  assert.ok(sent.problems[0].reason.includes('未获对外授权'));
});

test('撤回授权：未发送草稿剔除失据句，已发送版本保留快照并标更正', async () => {
  const state = await buildState();
  linkSample(state);
  const app = createApplication(state, { student: 'A1', jobId: 'P1', name: '测试申请' });
  draftFromAssessment(state, app, assess(state, { student: 'A1', audience: 'application' }));
  const before = app.statements.length;
  const { affectedApplications } = withdrawConsent(state, { statementId: 'S1', use: 'application' }, () => {});
  const fresh = assess(state, { student: 'A1', audience: 'application' });
  const changes = rejudge(state, app.id, { trigger: '撤回测试', assessment: fresh });
  assert.deepEqual(affectedApplications, [app.id]);
  assert.equal(changes.changes.length, 2);
  assert.ok(app.statements.every((s) => s.statementId !== 'S1'), '草稿中 S1 句子被剔除');
  assert.ok(app.statements.length < before);

  // 已发送场景
  const state2 = await buildState();
  linkSample(state2);
  const app2 = createApplication(state2, { student: 'A1', jobId: 'P1', name: '已发申请' });
  draftFromAssessment(state2, app2, assess(state2, { student: 'A1', audience: 'application' }));
  const send = sendApplication(state2, app2.id, { sentTo: '企业' });
  assert.equal(send.sent, true);
  const snapshotCount = app2.snapshots[0].entries.length;
  withdrawConsent(state2, { statementId: 'S1', use: 'application' }, () => {});
  const fresh2 = assess(state2, { student: 'A1', audience: 'application' });
  const r2 = rejudge(state2, app2.id, { trigger: '撤回测试', assessment: fresh2 });
  assert.equal(app2.snapshots[0].entries.length, snapshotCount, '已发送快照保持不变可审计');
  assert.ok(r2.changes.every((c) => c.outcome === 'needs_correction_notice'));
});

test('条件变化重判：新增独立验收记录门槛后对外结论降级', async () => {
  const state = await buildState('strict.json');
  linkProject(state, { student: 'A1', projectName: '星港', statementIds: ['S1', 'S2', 'S4'] });
  refreshReviewFlags(state);
  const app = createApplication(state, { student: 'A1', jobId: 'P1', name: '测试申请' });
  draftFromAssessment(state, app, assess(state, { student: 'A1', audience: 'application' }));
  assert.equal(assess(state, { student: 'A1', audience: 'application' }).overall, VERDICTS.POSSIBLE);

  // 模拟企业补充：加入带独立验收记录前提的答复后重新抽取
  state.postings.push({ id: 'P2', responseTo: 'P1', text: '项目可以替代年限，须有独立验收记录。' });
  state.conditions = extractConditions(state);
  const after = assess(state, { student: 'A1', audience: 'application' });
  assert.equal(after.overall, VERDICTS.POSSIBLE);
  const group = after.optionGroups[0];
  assert.ok(group.options[0].blockers.some((b) => b.includes('独立贡献')));
  const result = rejudge(state, app.id, { trigger: '企业补充验收记录要求', assessment: after });
  assert.ok(Array.isArray(result.changes));
});

test('防重复使用：同段经历跨两个互斥条件充当时报警', () => {
  const violations = checkDoubleUse([
    { conditionId: 'C1', alternativeGroup: 'AG1', projectKey: 'PL1', factIds: ['F1'] },
    { conditionId: 'C9', alternativeGroup: null, projectKey: 'PL1', factIds: ['F1'] },
  ]);
  assert.equal(violations.length, 1);
  const ok = checkDoubleUse([
    { conditionId: 'C2', alternativeGroup: 'AG1', projectKey: 'PL1', factIds: ['F1'] },
    { conditionId: 'C5', alternativeGroup: 'AG1', projectKey: 'PL1', factIds: ['F1'] },
  ]);
  assert.equal(ok.length, 0);
});

test('培训记录不得抬升为交付/年限的“可能符合”', async () => {
  const raw = {
    postings: [{ id: 'P1', text: '两年及以上相关经历，或独立完成一个完整交付项目。' }],
    statements: [{ id: 'S1', student: 'A1', source: '简历', text: '参与星港项目培训，我未参与上线。' }],
    permissions: [{ document: 'S1', readers: ['student', 'advisor', 'employer'], uses: ['counselling', 'application'] }],
  };
  const state = EMPTY_STATE();
  Object.assign(state, { postings: raw.postings, statements: raw.statements, permissions: raw.permissions });
  state.conditions = extractConditions(state);
  state.facts = parseAllStatements(state);
  const result = assess(state, { student: 'A1', audience: 'counselling' });
  assert.equal(result.overall, VERDICTS.UNKNOWN);
  assert.ok(result.gaps.missingMandatory.length >= 1);
});

test('独立“另须”句是独立必备条件，同一项目证据会触发重复使用警告', async () => {
  const raw = {
    postings: [{ id: 'P1', text: '独立完成一个完整交付项目。另须具备同类项目验收经历。' }],
    statements: [{ id: 'S2', student: 'A1', source: '证明', text: 'A1 独立组织星港交付验收。' }],
    permissions: [{ document: 'S2', readers: ['student', 'advisor'], uses: ['counselling'] }],
  };
  const state = EMPTY_STATE();
  Object.assign(state, { postings: raw.postings, statements: raw.statements, permissions: raw.permissions });
  state.conditions = extractConditions(state);
  state.facts = parseAllStatements(state);
  const gate = state.conditions.find((c) => c.concept === 'acceptance_record');
  assert.equal(gate.gate, null, '另须句是独立条件而非前提');
  const result = assess(state, { student: 'A1', audience: 'counselling' });
  assert.equal(result.doubleUseWarnings.length, 1);
  assert.deepEqual(result.doubleUseWarnings[0].conditionIds.sort(), ['C1', 'C2']);
});
