// ADPS localization safety gate: verify translations are eligible before any Shopify write.
// No network, store mutation, publication or admin locale change.
const validId = id => /^gid:\/\/shopify\/Product\/\d+$/.test(String(id ?? ''));
export function validateTranslationSyncBatch(products, {maxProducts=9}={}) {
  if (!Array.isArray(products) || products.length===0 || products.length>maxProducts) {
    throw new Error('Translation batch must contain 1 to '+maxProducts+' products');
  }
  const seen=new Set();
  const items=products.map(product=>{
    if (!validId(product?.id) || product?.status!=='DRAFT') throw new Error('Only Shopify draft products are eligible');
    if (seen.has(product.id)) throw new Error('Duplicate product in translation batch');
    seen.add(product.id);
    if (typeof product.title!=='string' || !product.title.trim() ||
        typeof product.descriptionHtml!=='string' || !product.descriptionHtml.trim()) {
      throw new Error('Product source title and description are required');
    }
    return Object.freeze({id:product.id,status:'DRAFT',eligible:true});
  });
  return Object.freeze({adminLocale:'ja',targetLocale:'en',mode:'dry-run',productCount:items.length,items});
}
