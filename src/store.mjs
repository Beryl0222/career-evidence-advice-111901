// 工作区存储：把 data/inputs.json 的原始资料（postings/statements/permissions）
// 扩展为工具状态（facts、links、conditions、applications、audit、reviewFlags）。
// 原始字段保持不动，便于与“资料检查”测试共存。
import { readFile } from 'node:fs/promises';
import { atomicWriteJson } from './util.mjs';

const SCHEMA_VERSION = 1;

export const EMPTY_STATE = () => ({
  schemaVersion: SCHEMA_VERSION,
  postings: [],
  statements: [],
  permissions: [],
  facts: [],          // 从 statements 解析出的结构化事实
  projectLinks: [],   // 学生确认的“同一项目”材料关联
  conditions: [],     // 从 postings 抽取的条件
  applications: [],   // 申请路径与材料摘要（含已发送快照）
  reviewFlags: [],    // 归属疑问/冲突，留待辅导员核实
  audit: [],          // 授权变更、撤回、重判留痕
});

export async function loadState(file) {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const state = EMPTY_STATE();
  for (const key of Object.keys(state)) {
    if (key === 'schemaVersion') continue;
    if (Array.isArray(raw[key])) state[key] = raw[key];
  }
  return state;
}

export async function saveState(file, state) {
  await atomicWriteJson(file, state);
}

export function findByRef(state, ref, { posting, statement, condition, fact, application } = {}) {
  if (posting) return state.postings.find((p) => p.id === ref);
  if (statement) return state.statements.find((s) => s.id === ref);
  if (condition) return state.conditions.find((c) => c.id === ref);
  if (fact) return state.facts.find((f) => f.id === ref);
  if (application) return state.applications.find((a) => a.id === ref);
  return undefined;
}

export function appendAudit(state, entry) {
  state.audit.push({ at: new Date().toISOString(), ...entry });
}
