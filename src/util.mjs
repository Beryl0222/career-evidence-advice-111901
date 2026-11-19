// 通用辅助：ID、文本定位、原子写文件、断言。
import { randomUUID } from 'node:crypto';
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function newId(prefix) {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

// 在原文中定位句子，返回 { start, end, excerpt }；找不到时 start=-1。
export function locate(sourceText, sentence) {
  const start = sourceText.indexOf(sentence);
  if (start < 0) return { start: -1, end: -1, excerpt: sentence };
  return { start, end: start + sentence.length, excerpt: sentence };
}

// 按中文标点切句，保留标点并过滤空串。
export function splitClauses(text) {
  return text
    .split(/(?<=[。；;！？!?])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function atomicWriteJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}

export function readJsonMaybe(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return JSON.parse(value);
}

export function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function unique(list) {
  return [...new Set(list)];
}
