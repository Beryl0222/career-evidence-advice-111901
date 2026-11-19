#!/usr/bin/env node
// 本地就业辅导工具 CLI（仅使用 Node.js 标准库，数据不出本机）。
import { resolve } from 'node:path';
import { mkdir, access } from 'node:fs/promises';
import { loadState, saveState, appendAudit } from './store.mjs';
import { extractConditions } from './extract.mjs';
import { parseAllStatements } from './evidence.mjs';
import { linkProject, refreshReviewFlags, resolveReviewFlag } from './review.mjs';
import { assess } from './assess.mjs';
import {
  createApplication, draftFromAssessment, sendApplication,
  rejudge, withdrawConsent, addStatement,
} from './applications.mjs';
import {
  reportConditions, reportFacts, reportReview, reportAssessment,
  reportGaps, reportAuthMatrix, reportApplication, reportAudit,
} from './report.mjs';

const DEFAULT_WORKSPACE = resolve(process.cwd(), 'workspace.json');

async function openState(file) {
  try {
    return await loadState(file);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`工作区不存在：${file}。请先运行 init --from <inputs.json>`);
      process.exit(2);
    }
    throw err;
  }
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i += 1; }
    }
  }
  return flags;
}

const HELP = `本地就业辅导工具（Node.js 标准库，数据不出本机）

用法：node src/cli.mjs <命令> [--workspace workspace.json] [选项]

工作区：
  init --from data/inputs.json [--to workspace.json]
      从原始资料建立工作区，抽取条件、解析事实、建立复核队列。

岗位与条件：
  conditions                列出必备/优先/可替代/带前提/待澄清条件及原句定位
  add-posting --id P3 --text "..." [--response-to P1]
      辅导员录入招聘说明或企业补充答复，并自动重新抽取条件

证据：
  facts                     列出本人完成/团队完成/相关但未发生/期间/能力事实
  link --student A1 --project 星港 --statements S1,S2,S3
      学生确认多份材料讲的是同一项目
  review                    查看归属疑问与冲突的辅导员核实队列
  resolve-review --id RV_1 --resolution "采信 S2..." --advisor 王老师
      辅导员记录核实结论

判定与路径比较：
  assess --student A1 [--audience counselling|application]
      资格判定：符合 / 可能符合 / 无法凭现有来源判断（默认辅导视角）
  compare --student A1
      并排比较辅导视角与对外申请视角的结论差异
  gaps --student A1 [--audience counselling|application]
      缺什么、可以补什么、差的是哪项必备条件
  auth-matrix --student A1
      每份材料可以给谁看、用于什么用途、shareable 限定范围

申请材料：
  new-app --student A1 --job P1 --name "星港岗申请"
  draft --app APP_1
      按对外视角自动起草摘要（未授权事实只标注、不写入可发句）
  add-sentence --app APP_1 --condition C2 --fact F_3 --text "..." [--partial]
      手工加入摘要句（仍会做授权校验）
  send --app APP_1 --to 某企业
      发送前校验并保存授权快照；失据或越权句会被拦截
  app --app APP_1           查看申请材料、快照与重判记录

授权变更：
  withdraw --statement S2 --use application
      学生撤回某材料的对外用途；草稿自动剔除失据句，已发版本标出需更正处
  rejudge-app --app APP_1 --trigger "企业补充验收记录要求"
      条件或授权变化后对已备摘要逐句重新判定
  audit                     查看授权/撤回/重判留痕

通用：
  --workspace <file>        指定工作区文件（默认 ./workspace.json）
  -h, --help                显示本帮助

说明：本工具用于辅导与申请材料准备，录用仍由企业决定。`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '-h' || command === '--help') {
    console.log(HELP);
    return;
  }
  const flags = parseFlags(rest);
  const ws = flags.workspace ? resolve(flags.workspace) : DEFAULT_WORKSPACE;

  switch (command) {
    case 'init': {
      const from = resolve(flags.from ?? 'data/inputs.json');
      const to = flags.to ? resolve(flags.to) : ws;
      const state = await loadState(from);
      state.conditions = extractConditions(state);
      state.facts = parseAllStatements(state);
      refreshReviewFlags(state);
      await saveState(to, state);
      console.log(`已初始化工作区：${to}`);
      console.log(`条件 ${state.conditions.length} 条，事实 ${state.facts.length} 条，待复核 ${state.reviewFlags.length} 项`);
      break;
    }

    case 'add-posting': {
      const state = await openState(ws);
      if (!flags.id || !flags.text) throw new Error('需要 --id 与 --text');
      state.postings.push({ id: flags.id, ...(flags['response-to'] ? { responseTo: flags['response-to'] } : {}), text: flags.text });
      state.conditions = extractConditions(state);
      refreshReviewFlags(state);
      await saveState(ws, state);
      console.log(`已录入 ${flags.id} 并重新抽取，当前条件 ${state.conditions.length} 条`);
      break;
    }

    case 'conditions': {
      const state = await openState(ws);
      console.log(reportConditions(state));
      break;
    }

    case 'facts': {
      const state = await openState(ws);
      console.log(reportFacts(state));
      break;
    }

    case 'link': {
      const state = await openState(ws);
      const link = linkProject(state, {
        student: flags.student,
        projectName: flags.project,
        statementIds: String(flags.statements).split(',').map((s) => s.trim()),
        note: flags.note ?? '',
      });
      refreshReviewFlags(state);
      await saveState(ws, state);
      console.log(`已登记同一项目关联 ${link.id}：${link.statementIds.join('、')} -> ${link.projectName}`);
      break;
    }

    case 'review': {
      const state = await openState(ws);
      console.log(reportReview(state));
      break;
    }

    case 'resolve-review': {
      const state = await openState(ws);
      resolveReviewFlag(state, flags.id, { resolution: flags.resolution, advisor: flags.advisor ?? '辅导员' });
      await saveState(ws, state);
      console.log(`复核项 ${flags.id} 已记录核实结论`);
      break;
    }

    case 'assess': {
      const state = await openState(ws);
      console.log(reportAssessment(assess(state, { student: flags.student, audience: flags.audience ?? 'counselling' })));
      break;
    }

    case 'compare': {
      const state = await openState(ws);
      const internal = assess(state, { student: flags.student, audience: 'counselling' });
      const external = assess(state, { student: flags.student, audience: 'application' });
      console.log('== 辅导视角 ==');
      console.log(reportAssessment(internal));
      console.log('\n== 对外申请视角（按授权重新检查证据）==');
      console.log(reportAssessment(external));
      console.log('\n== 缺口对照 ==');
      console.log('辅导视角：');
      console.log(reportGaps(internal));
      console.log('\n对外视角：');
      console.log(reportGaps(external));
      break;
    }

    case 'gaps': {
      const state = await openState(ws);
      console.log(reportGaps(assess(state, { student: flags.student, audience: flags.audience ?? 'counselling' })));
      break;
    }

    case 'auth-matrix': {
      const state = await openState(ws);
      console.log(reportAuthMatrix(state, flags.student));
      break;
    }

    case 'new-app': {
      const state = await openState(ws);
      const app = createApplication(state, { student: flags.student, jobId: flags.job, name: flags.name });
      await saveState(ws, state);
      console.log(`已创建申请 ${app.id}`);
      break;
    }

    case 'draft': {
      const state = await openState(ws);
      const app = state.applications.find((a) => a.id === flags.app);
      if (!app) throw new Error(`申请不存在：${flags.app}`);
      const assessment = assess(state, { student: app.student, audience: 'application' });
      const stmts = draftFromAssessment(state, app, assessment);
      await saveState(ws, state);
      console.log(`已起草 ${stmts.length} 句（未授权句已标注为不得外发）`);
      console.log(reportApplication(state, app));
      break;
    }

    case 'add-sentence': {
      const state = await openState(ws);
      const fact = state.facts.find((f) => f.id === flags.fact);
      const payload = {
        conditionId: flags.condition,
        factId: flags.fact,
        statementId: fact?.statementId,
        text: flags.text,
        partial: Boolean(flags.partial),
      };
      const stmt = addStatement(state, flags.app, payload);
      const app = state.applications.find((a) => a.id === flags.app);
      // 授权校验在发送时统一执行，这里先给出即时提示
      const { factUsable } = await import('./authz.mjs');
      if (fact) {
        const check = factUsable(state, fact, 'application');
        stmt.authorized = check.usable;
        stmt.authReason = check.reason;
      }
      await saveState(ws, state);
      console.log(reportApplication(state, app));
      break;
    }

    case 'send': {
      const state = await openState(ws);
      const result = sendApplication(state, flags.app, { sentTo: flags.to ?? '企业' });
      if (!result.sent) {
        console.log('发送被拦截，存在以下问题：');
        for (const p of result.problems) console.log(`- ${p.statementId}: ${p.reason}`);
      } else {
        appendAudit(state, { action: 'application_sent', applicationId: flags.app, snapshotId: result.snapshot.id, sentTo: flags.to });
        console.log(`已发送并保存快照 ${result.snapshot.id}`);
      }      await saveState(ws, state);
      break;
    }

    case 'app': {
      const state = await openState(ws);
      const app = state.applications.find((a) => a.id === flags.app);
      if (!app) throw new Error(`申请不存在：${flags.app}`);
      console.log(reportApplication(state, app));
      break;
    }

    case 'withdraw': {
      const state = await openState(ws);
      const { permission, affectedApplications } = withdrawConsent(
        state,
        { statementId: flags.statement, use: flags.use },
        (entry) => appendAudit(state, entry),
      );
      // 撤回后按最新授权重新评估，再逐句重判关联申请
      const affected = [];
      for (const applicationId of affectedApplications) {
        const app = state.applications.find((a) => a.id === applicationId);
        const fresh = assess(state, { student: app.student, audience: 'application' });
        const rejudgeResult = rejudge(state, applicationId, {
          trigger: `撤回 ${flags.statement} 的 ${flags.use} 授权`,
          assessment: fresh,
        });
        affected.push({ applicationId, rejudge: rejudgeResult });
      }
      await saveState(ws, state);
      console.log(`已撤回 ${flags.statement} 的 ${flags.use} 用途，当前 uses=${permission.uses.join('/')} readers=${permission.readers.join('/')}`);
      for (const a of affected) {
        console.log(`申请 ${a.applicationId} 重判：${a.rejudge.changes.length} 句受影响`);
      }
      break;
    }

    case 'rejudge-app': {
      const state = await openState(ws);
      const app = state.applications.find((a) => a.id === flags.app);
      if (!app) throw new Error(`申请不存在：${flags.app}`);
      // 条件/授权可能已变化，按最新状态重新评估后再逐句重判
      const freshAssessment = assess(state, { student: app.student, audience: 'application' });
      const result = rejudge(state, flags.app, { trigger: flags.trigger ?? '手工重判', assessment: freshAssessment });
      appendAudit(state, { action: 'rejudge', applicationId: flags.app, trigger: result.trigger });
      await saveState(ws, state);
      console.log(`重判完成，${result.changes.length} 句变化`);
      console.log(reportApplication(state, app));
      break;
    }

    case 'audit': {
      const state = await openState(ws);
      console.log(reportAudit(state));
      break;
    }

    default:
      console.error(`未知命令：${command}\n\n${HELP}`);
      process.exit(2);
  }
}

main().catch((err) => {
  console.error(`错误：${err.message}`);
  process.exit(1);
});
