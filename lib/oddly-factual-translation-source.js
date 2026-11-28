// Keep factual product descriptions separate from unverified fulfillment claims.
// No AI inference, product write, or Shopify publication.
const riskPatterns=[
 /送料目安|日本向け送料|配送料|送料は|送料:/,
 /返品条件|返品ポリシー|返金条件/,
 /仕入先の在庫|配送状況|配送日数|お届け予定|発送予定/,
 /販売価格|価格・仕入先|価格は変動/,
 /使用適性は未確認|販売準備中/,
 /価格・仕入先|価格・配送|ご注|変動するため|\.\.\.|…/
];
const stripPatterns=[
 /<h3>ご購入前に<\/h3>\s*<p>(?:日本向け)?送料目安\s*[:：]\s*¥[\d,]+<\/p>/g,
 /<p>(?:日本向け)?送料目安\s*[:：]\s*¥[\d,]+<\/p>/g,
 /<p>販売価格・仕入先在庫・配送状況は変動するため、ご注文時に最新情報を確認して手配します。<\/p>/g,
 /<p>返品条件はストアポリシーをご確認ください。<\/p>/g,
 /(?:ご購入前に)?(?:日本向け)?送料目安\s*[:：]\s*¥[\d,]+/g,
 /返品条件はストアポリシーをご確認ください。?/g,
 /販売価格\s*[:：]\s*¥[\d,]+/g,
 /ご注文後、仕入先の在庫・価格・配送状況を確認して手配します。?/g
];
export function prepareFactualTranslationSource({title,description}={}){
 if(typeof title!=='string'||!title.trim()||typeof description!=='string'||!description.trim())
  throw new Error('Title and description are required');
 const original=description;
 let sanitized=original;
 for(const pattern of stripPatterns)sanitized=sanitized.replace(pattern,' ');
 sanitized=sanitized.replace(/\s+/g,' ').trim();
 const unverifiedRemaining=riskPatterns.some(pattern=>pattern.test(sanitized));
 const reviewReasons=[];
 if(unverifiedRemaining)reviewReasons.push('unverified-claims-remain');
 if(sanitized.length<12)reviewReasons.push('insufficient-factual-copy');
 if(/\.\.\.|…/.test(original))reviewReasons.push('possibly-truncated-source');
 return Object.freeze({
  title:title.trim(),description:sanitized,
  removedUnverifiedCopy:sanitized!==original,
  readyForTranslation:reviewReasons.length===0,
  reviewReasons
 });
}
