import crypto from 'node:crypto';

// Keep existing production records readable; never fall back to them in Preview.
export function previewStorageKey(key){
  if(process.env.VERCEL_ENV!=='preview')return key;
  const branch=String(process.env.VERCEL_GIT_COMMIT_REF||'').trim();
  if(!branch)throw Error('Previewの保存先を特定できません。ブランチ設定を確認してください。');
  const namespace=crypto.createHash('sha256').update(branch).digest('hex');
  return 'ai-buyer:preview:'+namespace+':'+key;
}
