import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhaseResult } from '../../src/executors/protocol.ts';

void test('LOCATE result preserves its selected bug-case directory', () => {
  const result = parsePhaseResult(JSON.stringify({
    status: 'pass', summary: 'matched case 13', artifacts: [],
    evidence: ['bugfix/index.md'], changedFiles: [],
    bugClassification: 'code_defect',
    bugCaseDir: 'bugfix/13-参数推断被样例值覆盖列元数据',
  }), []);
  assert.equal(result.bugCaseDir, 'bugfix/13-参数推断被样例值覆盖列元数据');
});
