// Defense applies to Functions and static responses routed through Functions.
const editorOrigin = 'https://canopia-webeditor.pages.dev';
const reply = (error,status,extra={})=>Response.json({error},{status,headers:{'Cache-Control':'no-store',...extra}});
const privatePath = /(?:^|\/)(?:\.[^/]+|tests|scripts|docs|migrations|references|components|node_modules|functions|canopia-redesign|canopia-webeditor|canopia-editor-security)(?:\/|$)|\.(?:sql|toml|log|bak|pem|key|map|md|bat)$/i;
const security = {
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
 'Referrer-Policy':'strict-origin-when-cross-origin',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https:; frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};
export async function onRequest(context){
 const {env}=context;let {request}=context;const url=new URL(request.url);
 let response;
 try {
  const path=decodeURIComponent(url.pathname);
  if(privatePath.test(path)||/^\/(?:package(?:-lock)?\.json|debug_seo\.mjs)$/.test(path))return reply('No encontrado.',404);
  const api=path.startsWith('/api/');
  if(path==='/api/orders'&&url.searchParams.has('action')&&!['confirm','reject'].includes(url.searchParams.get('action')))return reply('Accion invalida.',400);
  const origin=request.headers.get('Origin');
  const trusted=!origin||origin===url.origin||(origin===editorOrigin&&['/api/products','/api/analytics'].includes(path));
  if(api&&(!trusted||request.headers.get('Sec-Fetch-Site')==='cross-site'&&origin!==editorOrigin))return reply('Origen no permitido.',403);
  if(api&&request.method==='OPTIONS'){
   response=new Response(null,{status:204});
  }else{
   const mutation=!['GET','HEAD','OPTIONS'].includes(request.method);
   if(api&&mutation){
    const type=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
    if(type!=='application/json'&&!(path==='/api/withdrawals'&&type==='application/x-www-form-urlencoded'))return reply('Formato no admitido.',415);
    const max=path==='/api/admin/upload-images'?14500000:32768;
    if(Number(request.headers.get('Content-Length')||0)>max)return reply('Solicitud demasiado grande.',413);
    const reader=request.body?.getReader();const chunks=[];let size=0;
    if(reader){try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();return reply('Solicitud demasiado grande.',413);}chunks.push(part.value);}}finally{reader.releaseLock();}}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    request=new Request(request,{body:bytes});
   }
   // Durable atomic counters, shared across isolates. CF-Connecting-IP is set by Cloudflare.
   const bucket=path==='/api/orders'&&mutation&&!url.searchParams.has('action')?'orders':path==='/api/admin/groq'&&mutation?'groq':path==='/api/admin/upload-images'&&mutation?'upload':(path.startsWith('/api/admin/')||request.headers.has('Authorization')&&['/api/products','/api/orders','/api/analytics'].includes(path))?'admin':path==='/api/auth'&&mutation?'auth':path==='/api/analytics'&&mutation?'analytics':null;
   if(bucket){
    const db=env.canopia_db?.withSession?.('first-primary')||env.canopia_db;
    if(!db)return reply('Servicio temporalmente no disponible.',503);
    const now=Date.now(),seconds=600;
    const ip=request.headers.get('CF-Connecting-IP')||'local-shared';
    const key=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${bucket}:${Math.floor(now/86400000)}:${ip}`))),b=>b.toString(16).padStart(2,'0')).join('');
    await db.prepare('CREATE TABLE IF NOT EXISTS security_limits(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
    await db.prepare('DELETE FROM security_limits WHERE expires_at<=?').bind(now).run();
    const row=await db.prepare(`INSERT INTO security_limits(key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).bind(key,now+seconds*1000).first();
    const budget={orders:5,admin:300,auth:20,analytics:120,groq:10,upload:20}[bucket];
    if(row.attempts>budget)return reply('Demasiadas solicitudes. Volve a intentar mas tarde.',429,{'Retry-After':String(seconds)});
   }
   response=await context.next(request);
  }
  response=new Response(response.body,response);
  for(const [key,value]of Object.entries(security))response.headers.set(key,value);
  if(url.protocol==='https:')response.headers.set('Strict-Transport-Security','max-age=31536000');
  if(api){
   response.headers.set('Cache-Control','no-store');
   for(const name of ['Access-Control-Allow-Origin','Access-Control-Allow-Credentials','Access-Control-Allow-Headers','Access-Control-Allow-Methods'])response.headers.delete(name);
   if(origin&&trusted){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.append('Vary','Origin');response.headers.set('Access-Control-Allow-Headers','Content-Type, Authorization, x-admin-password, X-Last-Active, X-Canopia-Consent');response.headers.set('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');}
  }
  return response;
 }catch{ return reply('Servicio temporalmente no disponible.',503); }
}
