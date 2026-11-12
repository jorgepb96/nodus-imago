// Native CPU vision and embedding audit; no API keys, Python or fabricated inference.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {launchNative,waitNativeJob,pollNative} from './native-test-support.mjs';
const installation=JSON.parse(await fs.readFile('test-results/v1-onboarding-e2e.json','utf8'));
const {app,page,call}=await launchNative(installation.profile);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={date:new Date().toISOString(),platform:process.platform,arch:process.arch,backend:installation.diagnostics.backend,checks:[],simulatedInference:false};
try{
 for(const id of ['llama-runtime','lfm3-vl-2b']){
  const model=(await call('status')).models.find(m=>m.id===id);if(!model)throw Error('Required native runtime is missing from the catalogue');
  console.log('Authorized local test dependency:',model.label,model.license,model.estimatedGB,'GB',installation.root+'/models');
  if(!model.verified)await waitNativeJob(call,await call('downloadModel',{id}));
 }
 const databases=await call('listDatabases'),database=databases.find(d=>d.name==='Fuentes de prueba nativa');
 const description=await call('addColumn',{databaseId:database.id,name:'Descripción nativa',type:'text'});
 const rows=(await call('search',{databaseIds:[database.id]})).rows;
 const before=performance.now();const job=await call('analyze',{databaseId:database.id,columnIds:[description.id],language:'English',detailed:false});
 await waitNativeJob(call,job);report.visionMs=performance.now()-before;
 const proposals=await call('proposals');assert.equal(proposals.filter(p=>p.columnId===description.id).length,2);assert.ok(proposals.every(p=>p.value&&p.model.includes('lfm3')));
 for(const row of rows)assert.equal((await call('getRow',{id:row.id})).cells[description.id]??null,null);
 await call('reviewProposals',{ids:proposals.map(p=>p.id),action:'accept'});
 for(const row of rows)assert.ok((await call('getRow',{id:row.id})).cells[description.id]);
 report.checks.push('Actual LFM3 CPU descriptions, proposals, protected original cells and deliberate acceptance');
 const beforeQuery=performance.now();assert.equal((await call('search',{databaseIds:[database.id],query:'a blue circle',mode:'semantic'})).rows.length,2);report.queryMs=performance.now()-beforeQuery;
 const diagnostics=await call('inferenceDiagnostics');report.diagnostics=diagnostics;
 if(process.platform==='darwin'&&diagnostics.processId)report.embeddingRssBytes=Number(execFileSync('ps',['-o','rss=','-p',String(diagnostics.processId)],{encoding:'utf8'}).trim())*1024;
 report.checks.push('Actual semantic retrieval and native process memory/latency diagnostics');
 assert.deepEqual(errors,[]);report.errors=errors;report.passed=true;
 await fs.writeFile('test-results/v1-native-ai-e2e.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:'test-results/v1-native-ai-failure.png'}).catch(()=>{});throw error;}
finally{await app.close();}
