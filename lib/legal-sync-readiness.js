export function legalSyncReadiness({legalReady,shopConnected,pageCount}) {
  const blockers=[];
  if(!legalReady) blockers.push('legal_information_incomplete');
  if(!shopConnected) blockers.push('shopify_not_connected');
  if(pageCount!==1) blockers.push('legal_page_requires_review');
  return {ready:blockers.length===0,blockers,automaticPublish:false};
}
