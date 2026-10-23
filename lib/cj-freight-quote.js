// Normalize a CJ freight quote without treating browser-provided data as verified.
export function normalizeCjFreightQuote(quote, {expectedVid, now=Date.now(), maxAgeMs=15*60*1000}={}) {
  const fail=reason=>({verified:false,shippingCostJpy:null,reason});
  if(!quote||quote.ok!==true||quote.destination!=='JP')return fail('日本向けCJ送料見積がありません');
  if(!expectedVid||String(quote.vid)!==String(expectedVid))return fail('商品バリエーションが一致しません');
  const fetchedAt=Date.parse(quote.fetchedAt||'');
  if(!Number.isFinite(fetchedAt)||fetchedAt>now||now-fetchedAt>maxAgeMs)return fail('送料見積の取得日時が不明または期限切れです');
  if(quote.quoteSource!=='cj-server'||quote.currency!=='USD')return fail('CJサーバーから取得した米ドル建て送料ではありません');
  const fx=Number(quote.usdJpyRate);
  if(!Number.isFinite(fx)||fx<=0||quote.fxVerified!==true)return fail('確認済みの米ドル円換算レートがありません');
  const fxAt=Date.parse(quote.fxVerifiedAt||'');
  if(!Number.isFinite(fxAt)||fxAt>now||now-fxAt>maxAgeMs)return fail('為替レートの確認日時が不明または期限切れです');
  const options=Array.isArray(quote.options)?quote.options:[];
  const selected=options.find(o=>o.name===quote.selectedMethod);
  if(!selected)return fail('配送方法が未選択です');
  const usd=Number(selected.usd);
  if(selected.usd===null||selected.usd===undefined||selected.usd===''||!Number.isFinite(usd)||usd<0)return fail('送料金額が不正です');
  return {verified:false,shippingCostJpy:Math.ceil(usd*fx),reason:'参考換算額です。サーバー側でCJ見積・為替の検証が必要です',shippingUsd:usd,fxRate:fx,method:selected.name};
}
