// Real clean installation. Downloads are explicit, licensed and retained under test-results.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {launchNative,pollNative,waitNativeJob,seedNativeImages} from './native-test-support.mjs';
const profile=path.resolve(process.env.IMAGO_ONBOARDING_PROFILE||'test-results/v1-onboarding-'+Date.now());
if(!profile.startsWith(path.resolve('test-results')+path.sep))throw Error('The onboarding profile must be isolated under test-results.');
await fs.mkdir(profile,{recursive:true});
if((await fs.readdir(profile)).length)throw Error('Use a new isolated onboarding profile; existing data is preserved.');
await fs.writeFile(path.join(profile,'isolation.json'),JSON.stringify({format:'nodus.imago.native-qa/1',root:profile}));
let app,page,call;const errors=[];const report={date:new Date().toISOString(),profile,root:path.join(profile,'collection'),platform:process.platform,arch:process.arch,checks:[],simulatedInference:false};
try{
 ({app,page,call}=await launchNative(profile));page.on('pageerror',e=>errors.push(e.message));
 // An invalid Python executable proves the primary path cannot accidentally use it.
 await call('updateSettings',{python:path.join(profile,'PYTHON_MUST_NOT_RUN'),device:'cpu',language:'es'});
 const fixture=await seedNativeImages(app,call,path.join(profile,'fixtures'));
 assert.equal((await call('search',{mode:'literal',query:'Red square'})).total,1);
 await page.reload();
 await page.locator('.onboarding-intro').getByRole('button',{name:'Preparar búsqueda local',exact:true}).click();
 const section=page.getByRole('region',{name:'Preparar búsqueda local',exact:true});
 const plan=await call('modelPreparation');assert.equal(plan.ready,false);assert.equal(plan.supported,true);
 console.log('Authorized model preparation:',JSON.stringify({requirements:plan.requirements.map(m=>({model:m.label,license:m.license,bytes:Math.round(m.estimatedGB*1e9)})),destination:plan.destination}));
 const start=section.getByRole('button',{name:'Preparar búsqueda semántica',exact:true});assert.equal(await start.isDisabled(),true);
 await section.getByRole('checkbox',{name:'He revisado las licencias y autorizo estas descargas al destino indicado.',exact:true}).check();
 await start.click();
 let job;await pollNative(async()=>{job=(await call('jobs')).find(j=>j.kind==='prepare'&&['running','queued'].includes(j.state));return !!job;});
 // Cancel a genuine download, retain its files, then create a resumable new preparation.
 await call('controlJob',{id:job.id,action:'cancel'});await pollNative(async()=>!(await call('jobs')).some(j=>j.id===job.id&&j.state==='running'));
 assert.equal((await call('jobs')).find(j=>j.id===job.id).state,'cancelled');
 const resumed=await call('prepareModels',{consent:true});await waitNativeJob(call,resumed);
 await pollNative(async()=>await section.getByText('Listo para indexar',{exact:true}).count()===1);
 const ready=await call('modelPreparation');assert.equal(ready.ready,true);assert.ok(ready.requirements.every(m=>m.verified));
 report.checks.push('Literal without models, consent, exact dependency/licence/size/destination, cancelled real download, resume and SHA verification');
 // Corrupt only this disposable profile's config, retaining its official byte count.
 const model=ready.requirements.find(m=>m.id==='embeddinggemma2-onnx');
 if(model){
  const config=path.join(ready.destination,model.id,model.revision,'config.json');const bytes=await fs.readFile(config);bytes[0]^=1;await fs.writeFile(config,bytes);
  await assert.rejects(call('verifyModel',{id:model.id}),/Integridad/);
  await waitNativeJob(call,await call('prepareModels',{consent:true}));assert.equal((await call('modelPreparation')).ready,true);
  report.checks.push('Same-size corrupted file rejected and genuinely repaired');
 }
 const memory=[];let sampling=false;const sampler=setInterval(async()=>{if(sampling)return;sampling=true;try{const d=await call('inferenceDiagnostics');if(d.processId){let rss=0;if(process.platform==='darwin')rss=Number(execFileSync('ps',['-o','rss=','-p',String(d.processId)],{encoding:'utf8'}).trim())*1024;else if(process.platform==='linux'){const stat=await fs.readFile('/proc/'+d.processId+'/status','utf8');rss=Number(stat.match(/^VmRSS:\s+(\d+)/m)?.[1]??0)*1024;}else rss=Number(execFileSync('powershell',['-NoProfile','-Command',`(Get-Process -Id ${d.processId}).WorkingSet64`],{encoding:'utf8'}).trim());if(rss)memory.push({at:Date.now(),rssBytes:rss});}}catch{}finally{sampling=false;}},1000);
 const before=performance.now();try{await waitNativeJob(call,await call('indexImages',{databaseIds:[fixture.database.id]}));report.indexMs=performance.now()-before;}finally{clearInterval(sampler);}report.memory={sampledPeakRssBytes:Math.max(0,...memory.map(m=>m.rssBytes)),samples:memory.length,method:'RSS sampled every second during indexing; may miss shorter peaks'};
 const result=await call('search',{databaseIds:[fixture.database.id],query:'a red geometric shape',mode:'semantic'});assert.equal(result.rows.length,2);
 const row=await call('getRow',{id:fixture.rows[0]});const similar=await call('search',{databaseIds:[fixture.database.id],similarAssetId:row.images[0].id,mode:'semantic'});assert.equal(similar.rows[0].id,row.id);
 const diagnostics=await call('inferenceDiagnostics');report.diagnostics=diagnostics;
 assert.equal(diagnostics.backend,process.platform==='darwin'&&process.arch==='x64'?'harrier-oss-v1-0.6b-q8_0':'embeddinggemma2-onnx');
 report.checks.push('Actual indexing, text query and identical-image retrieval without a Python executable');
 await app.close();app=null;
 ({app,page,call}=await launchNative(profile));
 assert.equal((await call('status')).indexed,2);
 assert.equal((await call('search',{databaseIds:[fixture.database.id],query:'geometric shape',mode:'semantic'})).rows.length,2);
 report.checks.push('Close, reopen, retained models/vectors and real query after reopening');
 assert.deepEqual(errors,[]);report.errors=errors;report.passed=true;
 await fs.writeFile('test-results/v1-onboarding-e2e.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){if(page)await page.screenshot({path:'test-results/v1-onboarding-failure.png'}).catch(()=>{});throw error;}
finally{if(app)await app.close().catch(()=>{});}
