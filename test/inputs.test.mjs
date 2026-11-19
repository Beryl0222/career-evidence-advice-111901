import test from 'node:test';
import assert from 'node:assert/strict';
import { readInputs } from '../scripts/inspect.mjs';

const data = await readInputs();

test("授权与补充答复各自引用已有资料", () => {
  for (const permission of data.permissions) assert.ok(data.statements.some(item => item.id === permission.document));
  for (const posting of data.postings.filter(item => item.responseTo)) {
    assert.ok(data.postings.some(item => item.id === posting.responseTo));
  }
  assert.equal(new Set(data.statements.map(item => item.student)).size, 1);
});
