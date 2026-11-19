#!/usr/bin/env node
// 端到端演示：基于 data/inputs.json 的合成案例，走完辅导员的一次完整辅导流程。
// 运行：npm run demo
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.mjs');

const dir = await mkdtemp(join(tmpdir(), 'career-demo-'));
const ws = join(dir, 'workspace.json');
const run = (args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  process.stdout.write(r.stdout);
  if (r.status !== 0) {
    process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  }
};
const capture = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).stdout.trim();
const appId = (out) => (out.match(/APP_[a-z0-9]+/) ?? [])[0];

console.log('═══ 第 1 步：导入招聘说明、简历/自述/证明与授权，建立本地工作区 ═══');
run(['init', '--from', join(root, 'data', 'inputs.json'), '--to', ws]);

console.log('\n═══ 第 2 步：岗位要求释义（必备/优先/可替代/带前提/待澄清，定位到原句）═══');
run(['conditions', '--workspace', ws]);

console.log('\n═══ 第 3 步：证据事实分级（培训不等于交付；未参与上线单独成类）═══');
run(['facts', '--workspace', ws]);

console.log('\n═══ 第 4 步：学生确认 S1/S2/S3/S4 讲的是同一个星港项目 ═══');
run(['link', '--workspace', ws, '--student', 'A1', '--project', '星港', '--statements', 'S1,S2,S3,S4']);

console.log('\n═══ 第 5 步：归属疑问进入辅导员核实队列 ═══');
run(['review', '--workspace', ws]);

console.log('\n═══ 第 6 步：双视角比较——辅导可见 S2 全文，对外只能用获准范围 ═══');
run(['compare', '--workspace', ws, '--student', 'A1']);

console.log('\n═══ 第 7 步：材料授权矩阵：哪些材料可以给谁看 ═══');
run(['auth-matrix', '--workspace', ws, '--student', 'A1']);

console.log('\n═══ 第 8 步：起草对外申请摘要（S2 仅辅导可见，自动排除；部分证明显式标注）═══');
const app = appId(capture(['new-app', '--workspace', ws, '--student', 'A1', '--job', 'P1', '--name', '星港岗申请']));
run(['draft', '--workspace', ws, '--app', app]);

console.log('\n═══ 第 9 步：发送并保存当时授权快照 ═══');
run(['send', '--workspace', ws, '--app', app, '--to', '某科技公司']);

console.log('\n═══ 第 10 步：学生撤回简历（S1）的对外用途——已发版本标更正，快照保留 ═══');
run(['withdraw', '--workspace', ws, '--statement', 'S1', '--use', 'application']);
run(['app', '--workspace', ws, '--app', app]);

console.log('\n═══ 第 11 步：留痕与授权审计 ═══');
run(['audit', '--workspace', ws]);

await rm(dir, { recursive: true, force: true });
console.log('\n演示完成（临时工作区已清理）。提醒：本工具用于辅导与申请材料准备，录用仍由企业决定。');
