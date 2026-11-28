import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../api/shopify-publish.js',import.meta.url),'utf8');
test('Shopify draft endpoint validates whole-yen sale price server-side before CJ lookup',()=>{
 const validation=source.indexOf('!Number.isSafeInteger(price)||price<=0||price>10000000');
 const cj=source.indexOf('const cj=await cjVariant(p.cjProductId||p.id,p.cjVariantId||p.vid)');
 assert.ok(validation>0&&cj>validation);
 assert.match(source,/status:'DRAFT'/);
});
