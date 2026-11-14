import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('legal and product return day checks enforce the same upper bound',()=>{
 const legal=readFileSync(new URL('../lib/routes/release-readiness.js',import.meta.url),'utf8');
 const audit=readFileSync(new URL('../lib/routes/prelaunch-product-audit.js',import.meta.url),'utf8');
 assert.match(legal,/legalReturnDays:[^\n]*Number\.isSafeInteger\(Number\(days\)\)&&Number\(days\)<=365/);
 assert.match(audit,/Number\.isSafeInteger\(Number\(byKey\.return_days\)\)\|\|Number\(byKey\.return_days\)>365/);
});
