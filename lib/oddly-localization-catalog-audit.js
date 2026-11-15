// Read-only audit of existing ODDLY Shopify draft data before internationalization.
// Inventory shown by Shopify is not assumed to equal supplier (CJ) stock.
const risky=/送料目安|日本向け送料|返品条件|仕入先の在庫|配送状況|使用適性は未確認|販売準備中/;
export function auditEnglishLocalizationCandidates(products){
 if(!Array.isArray(products))throw new TypeError('Products must be an array');
 const seen=new Set();
 const items=products.map(p=>{
  const reasons=[];
  if(!/^gid:\/\/shopify\/Product\/\d+$/.test(String(p?.id??'')))reasons.push('invalid-product-id');
  if(seen.has(p?.id))reasons.push('duplicate-product');
  seen.add(p?.id);
  if(p?.status!=='DRAFT')reasons.push('not-draft');
  if(typeof p?.title!=='string'||!p.title.trim()||typeof p?.description!=='string'||!p.description.trim())reasons.push('missing-copy');
  if(risky.test(String(p?.description??'')))reasons.push('unverified-commercial-or-suitability-copy');
  if(!Number.isSafeInteger(p?.shopifyInventory)||p.shopifyInventory<=0)reasons.push('shopify-inventory-not-positive');
  return {id:p?.id??null,translationReviewRequired:reasons.includes('unverified-commercial-or-suitability-copy'),
   launchBlocked:reasons.length>0,reasons};
 });
 return {count:items.length,launchReadyCount:items.filter(x=>!x.launchBlocked).length,
  translationReviewCount:items.filter(x=>x.translationReviewRequired).length,
  items};
}
