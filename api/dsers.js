const DSERS_MCP_URL='https://ai.dsers.com/mcp';

function json(res,status,body){
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req,res){
  const action=String(req.query?.action||'health');
  if(action==='health'){
    return json(res,200,{
      ok:true,
      provider:'dsers',
      transport:'mcp',
      auth:'oauth2.1-pkce',
      connected:false,
      status:'authorization_required',
      endpoint:DSERS_MCP_URL,
      message:'DSers MCP OAuth connection is not yet configured for AI BUYER.'
    });
  }
  if(action==='search'){
    return json(res,428,{
      ok:false,
      provider:'dsers',
      code:'DSERS_AUTH_REQUIRED',
      status:'authorization_required',
      products:[],
      message:'Authorize AI BUYER with DSers OAuth before supplier search can run.'
    });
  }
  return json(res,400,{ok:false,error:'unsupported_action'});
}
