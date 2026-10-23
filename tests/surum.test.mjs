import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVersion, readDocs, stale, stamp } from '../scripts/surum.mjs';

test('dosya sürümü: docs/ damgaları güncel (değilse: npm run surum)', () => {
  assert.deepEqual(stale(readDocs()), []);
});

test('dosya sürümü: her yerel betik ve stil adresi aynı sürümle damgalı', () => {
  const files = readDocs();
  const v = computeVersion(files);
  for (const [name, text] of Object.entries(files)) {
    if (name.endsWith('.html')) {
      for (const m of text.matchAll(/(?:src|href)="([a-z0-9-]+\.(?:js|css)[^"]*)"/g)) assert.ok(m[1].endsWith(`?v=${v}`), `${name}: ${m[1]}`);
    }
    if (name.endsWith('.js')) {
      for (const m of text.matchAll(/from\s+'(\.\/[^']+)'/g)) assert.ok(m[1].endsWith(`?v=${v}`), `${name}: ${m[1]}`);
    }
  }
});

test('dosya sürümü: içerik değişince sürüm değişir, damga değişikliği sürümü değiştirmez', () => {
  const files = { 'a.html': '<link href="styles.css"><script type="module" src="a.js"></script><a href="b.html">',
    'a.js': "import { x } from './ui.js';\nexport const y = 1;", 'ui.js': 'export const x = 1;', 'styles.css': 'body{}' };
  const v = computeVersion(files);
  const s = stamp(files);
  assert.equal(computeVersion(s), v);
  assert.equal(s['a.html'], `<link href="styles.css?v=${v}"><script type="module" src="a.js?v=${v}"></script><a href="b.html">`);
  assert.equal(s['a.js'], `import { x } from './ui.js?v=${v}';\nexport const y = 1;`);
  assert.deepEqual(stale(s), []);
  assert.deepEqual(stale(files).sort(), ['a.html', 'a.js']);
  const changed = { ...s, 'ui.js': 'export const x = 2;' };
  assert.notEqual(computeVersion(changed), v);
  assert.deepEqual(stale(changed).sort(), ['a.html', 'a.js']);
  assert.notEqual(computeVersion({ ...s, 'styles.css': 'body{color:red}' }), v);
});
