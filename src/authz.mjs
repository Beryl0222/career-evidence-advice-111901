// 授权：每份材料有 readers（可见对象）与 uses（许可用途）。
// 未列出的对象或用途没有许可；带 shareable 时，许可对象可引用的内容限于该字段所述事实，
// 其余原文仅对学生和辅导员开放。
export const AUDIENCES = {
  counselling: { reader: 'advisor', use: 'counselling', label: '辅导员辅导视角' },
  application: { reader: 'employer', use: 'application', label: '对外申请视角（企业）' },
};

export function permissionFor(state, statementId) {
  return state.permissions.find((p) => p.document === statementId) ?? null;
}

export function isAllowed(permission, audience) {
  if (!permission) return false;
  const { reader, use } = AUDIENCES[audience];
  return permission.readers.includes(reader) && permission.uses.includes(use);
}

// 事实在该视角下是否可引用；shareable 材料还要求事实片段落在获准说明的事实范围内。
export function factUsable(state, fact, audience) {
  const perm = permissionFor(state, fact.statementId);
  if (!isAllowed(perm, audience)) return { usable: false, reason: '该材料未授权给此对象/用途' };
  if (perm.shareable && !withinShareableScope(fact, perm.shareable)) {
    return { usable: false, reason: `超出该材料获准公开的范围（仅限：${perm.shareable}）` };
  }
  return { usable: true, reason: null };
}

// 以 shareable 文本中的内容词判断事实片段是否在获准范围内。
// 做法：去除“这一事实”等指代表述后，比较双方中文二元组（bigram）的重合，
// 至少命中一个实质内容 bigram 才算在获准范围内；期间类细节默认不在“组织评审”范围内。
const SCOPE_STOPWORDS = ['这一事实', '的事实', '事实', '该', '这一'];

function bigrams(text) {
  const cleaned = text.replace(/[，,。；;：:\s]/g, '');
  const set = new Set();
  for (let i = 0; i < cleaned.length - 1; i += 1) set.add(cleaned.slice(i, i + 2));
  return set;
}

export function withinShareableScope(fact, shareable) {
  let scope = shareable;
  for (const stop of SCOPE_STOPWORDS) scope = scope.split(stop).join('');
  const scopeGrams = bigrams(scope);
  const text = `${fact.fragment} ${fact.capabilities?.join('') ?? ''}`;
  const factGrams = bigrams(text);
  let hits = 0;
  for (const gram of scopeGrams) if (factGrams.has(gram)) hits += 1;
  return hits >= 1;
}

export function visibleStatements(state, audience, student) {
  return state.statements.filter((s) => {
    if (student && s.student !== student) return false;
    const perm = permissionFor(state, s.id);
    return isAllowed(perm, audience);
  });
}

export function visibleFacts(state, audience, student) {
  return state.facts
    .filter((f) => (!student || f.student === student))
    .map((f) => ({ fact: f, ...factUsable(state, f, audience) }))
    .filter((x) => x.usable)
    .map((x) => x.fact);
}
