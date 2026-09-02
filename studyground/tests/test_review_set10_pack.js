/* SET 10 결과는 저장 시점마다 SET10, SET 010, T-010으로 표기가 달랐다.
 * 리뷰가 세 표기를 모두 같은 팩으로 읽고, 모르는 SET은 다른 정답지로
 * 대체하지 않는지 확인한다.
 * 실행: node studyground/tests/test_review_set10_pack.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.join(__dirname, '..', 'sg2', 'assets');
var sandbox = {
  window: { SMEAG_SET1: { code: 'SET1' }, SMEAG_SET9: { code: 'SET9' }, SMEAG_SET10: { code: 'SET10' }, SMEAG_SET11: { code: 'SET11' } },
  console: console,
  Promise: Promise,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'sg-results.js'), 'utf8'), sandbox,
  { filename: 'sg-results.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'set10.js'), 'utf8'), sandbox,
  { filename: 'set10.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'set11.js'), 'utf8'), sandbox,
  { filename: 'set11.js' });

var failed = 0;
function same(got, want, name) {
  if (got === want) { console.log('PASS ' + name); return; }
  failed += 1;
  console.error('FAIL ' + name);
}

var results = sandbox.window.SG_RESULTS;
same(results.pack('SET10'), sandbox.window.SMEAG_SET10, 'SET10 loads SET10 pack');
same(results.pack('SET 010'), sandbox.window.SMEAG_SET10, 'SET 010 loads SET10 pack');
same(results.pack('T-010'), sandbox.window.SMEAG_SET10, 'T-010 loads SET10 pack');
same(results.pack('SET11'), sandbox.window.SMEAG_SET11, 'SET11 loads SET11 pack');
same(results.pack('T-011'), sandbox.window.SMEAG_SET11, 'T-011 loads SET11 pack');
same(results.pack('SET99'), null, 'unknown set never falls back to another pack');

var detail = results.score(results.pack('T-010'), {});
same(detail.rows.length, 120, 'raw SET10 pack expands all 120 review rows');
same(detail.total, 107, 'raw SET10 pack exposes 107 auto-scored items');
same(results.productive({ set_code: 'T-010' }).length, 13,
  'raw SET10 pack exposes 13 AI scoring tasks');

process.exit(failed ? 1 : 0);
