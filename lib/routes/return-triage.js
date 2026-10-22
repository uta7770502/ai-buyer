// Read-only return/complaint triage. Never initiates refunds, CJ tickets or customer messages.
const categories={
 damaged:{priority:'high',review:true,steps:['写真と外箱の状態を確認','CJへ破損証拠を提出する前に担当者確認','返金または再発送の条件を確認']},
 defective:{priority:'high',review:true,steps:['不具合の症状と写真・動画を確認','保証・返品条件を確認','CJへの交換・返金申請を担当者が判断']},
 missing:{priority:'high',review:true,steps:['追跡情報と配達完了状況を確認','配送業者の調査を依頼','再発送・返金は担当者が承認']},
 wrong_item:{priority:'high',review:true,steps:['注文SKUと受取商品の写真を照合','CJ出荷情報を確認','返品または再発送を担当者が承認']},
 late:{priority:'medium',review:true,steps:['追跡番号と最終更新日を確認','配送予定と遅延状況を確認','購入者へ案内する文面を担当者が確認']},
 change_of_mind:{priority:'medium',review:true,steps:['返品期限と未使用条件を確認','返送先・送料負担を確認','返金の可否を担当者が承認']},
 other:{priority:'medium',review:true,steps:['内容を担当者が確認','CJおよびShopifyの記録を照合','対応方針を承認']}
};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
 const admin=String(process.env.AI_BUYER_ADMIN_KEY||'');
 if(!admin||req.headers?.authorization!=='Bearer '+admin)return res.status(401).json({ok:false,error:'Unauthorized'});
 const type=String(req.body?.type||'other');
 if(!Object.hasOwn(categories,type))return res.status(400).json({ok:false,error:'Unknown complaint category'});
 const days=Number(req.body?.daysSinceDelivery);
 if(req.body?.daysSinceDelivery!==undefined&&(typeof req.body.daysSinceDelivery!=='number'||!Number.isSafeInteger(days)||days<0||days>3650))return res.status(400).json({ok:false,error:'Invalid daysSinceDelivery'});
 const policyDays=Number(req.body?.returnWindowDays);
 if(req.body?.returnWindowDays!==undefined&&(typeof req.body.returnWindowDays!=='number'||!Number.isSafeInteger(policyDays)||policyDays<1||policyDays>365))return res.status(400).json({ok:false,error:'Invalid returnWindowDays'});
 const hasDays=Object.hasOwn(req.body||{},'daysSinceDelivery');
 const hasWindow=Object.hasOwn(req.body||{},'returnWindowDays');
 const policyReview=!hasDays||!hasWindow||days>policyDays;
 return res.status(200).json({ok:true,readOnly:true,type,priority:categories[type].priority,manualApprovalRequired:true,policyReviewRequired:policyReview,returnEligibilityVerified:hasDays&&hasWindow&&days<=policyDays,steps:categories[type].steps,customerMessageSent:false,cjTicketCreated:false,refundIssued:false});
}
