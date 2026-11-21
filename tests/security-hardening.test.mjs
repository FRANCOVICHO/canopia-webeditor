import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/_middleware.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {onRequestPost as order} from '../functions/api/orders.js';
import {onRequestGet as products} from '../functions/api/products.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 const db={prepare(query){const s=sql.prepare(query);const wrap=p=>({bind:(...v)=>wrap(v),run:async()=>s.run(...p),first:async()=>s.get(...p)});return wrap([]);}};
 let calls=0;
 return {sql,env:{canopia_db:db},get calls(){return calls;},next:async()=>{calls++;return new Response('ok');}};
}
const req=(path,headers={},body)=>new Request('https://canopiagrow.com'+path,{method:body?'POST':'GET',headers,...(body?{body}:{})});
test('denies private build files and cross-origin mutations before handlers',async()=>{
 const s=setup();
 for(const path of ['/.env','/debug.log','/canopia-webeditor/app.js','/tests/results/final.json','/seed.sql','/.git/config']) assert.equal((await onRequest({...s,request:req(path)})).status,404);
 assert.equal((await onRequest({...s,request:req('/api/orders',{'Origin':'https://evil.example','Content-Type':'application/json'},'{}')})).status,403);
 assert.equal(s.calls,0);
});
test('shared database counters limit concurrent orders and expire without trusting forwarded IP',async()=>{
 const s=setup();
 const send=()=>onRequest({...s,request:req('/api/orders',{'CF-Connecting-IP':'203.0.113.1','Content-Type':'application/json'},'{}')});
 const responses=await Promise.all(Array.from({length:12},send));
 assert.equal(responses.filter(r=>r.status===429).length,7);
 assert.equal(responses.find(r=>r.status===429).headers.get('Retry-After'),'600');
 s.sql.exec('UPDATE security_limits SET expires_at=0');
 assert.equal((await send()).status,200);
 assert(!JSON.stringify(s.sql.prepare('SELECT * FROM security_limits').all()).includes('203.0.113.1'));
});
test('limits streamed bodies with no content length and fails closed if limiter storage is absent',async()=>{
 const s=setup();
 assert.equal((await onRequest({...s,request:req('/api/orders',{'Content-Type':'application/json'},'x'.repeat(32769))})).status,413);
 assert.equal((await onRequest({...s,env:{},request:req('/api/orders',{'Content-Type':'application/json'},'{}')})).status,503);
});
test('forwards a readable request body; rejects wrong types; preserves response headers and adds CSP',async()=>{
 const s=setup();
 const response=await onRequest({...s,request:req('/api/orders',{'Content-Type':'application/json'},'{"items":[]}'),next:async request=>Response.json(await request.json(),{headers:{'X-Handler':'preserved'}})});
 assert.deepEqual(await response.json(),{items:[]});assert.equal(response.headers.get('X-Handler'),'preserved');
 assert(response.headers.get('Content-Security-Policy').includes("object-src 'none'"));
 assert.equal((await onRequest({...s,request:req('/api/orders',{'Content-Type':'text/plain'},'{}')})).status,415);
});
