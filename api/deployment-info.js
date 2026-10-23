export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store, max-age=0');
 const timestamp=process.env.VERCEL_DEPLOYMENT_CREATED_AT||process.env.ODDLY_DEPLOYED_AT;
 if(timestamp){const d=new Date(/^\d+$/.test(timestamp)?Number(timestamp):timestamp);if(Number.isFinite(d.getTime()))return res.status(200).json({deployedAt:d.toISOString()});}
 return res.status(503).json({error:'Deployment timestamp unavailable'});
}
