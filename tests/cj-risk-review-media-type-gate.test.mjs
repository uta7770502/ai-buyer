import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../lib/routes/cj-risk.js';

for (const mediaType of [null, 'text/html; charset=utf-8', 'application/+json', 'application/jsonp']) {
  test(`CJ review response ${mediaType ?? 'without content-type'} fails closed before JSON parsing`, async t => {
    const previous = process.env.CJ_ACCESS_TOKEN;
    process.env.CJ_ACCESS_TOKEN = 'test';
    t.after(() => {
      if (previous === undefined) delete process.env.CJ_ACCESS_TOKEN;
      else process.env.CJ_ACCESS_TOKEN = previous;
    });
    let requests = 0;
    let parsedBadBody = false;
    t.mock.method(globalThis, 'fetch', async url => {
      requests++;
      const isDetail = new URL(url).pathname.endsWith('/product/query');
      return {
        ok: true,
        status: 200,
        headers: isDetail ? new Headers({'content-type':'application/json'})
          : mediaType === null ? new Headers() : new Headers({'content-type':mediaType}),
        json: async () => {
          if (!isDetail) {
            parsedBadBody = true;
            throw Error('PRIVATE_UPSTREAM_BODY');
          }
          return {result:true,data:{pid:'p1',comprehensiveScore:4.8}};
        }
      };
    });
    const res = {
      setHeader(){},
      status(code){this.statusCode=code;return this;},
      json(body){this.body=body;return this;}
    };
    await handler({method:'GET',query:{id:'p1'}},res);
    assert.equal(requests,2);
    assert.equal(parsedBadBody,false);
    assert.equal(res.statusCode,502);
    assert.equal(res.body.code,'CJ_REVIEWS_UPSTREAM_REJECTED');
    assert.equal(res.body.ok,false);
    assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_UPSTREAM_BODY/);
  });
}
