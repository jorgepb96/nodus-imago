import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Repository } from '../electron/db/repository';
import { AgreementResearch } from '../electron/research/agreement';
import { defaultAgreementConfig } from '../shared/agreement';
const root = fs.mkdtempSync(path.join(os.tmpdir(),'imago-research-volume-')), repo = new Repository(root);
const result: Record<string,unknown> = { date:new Date().toISOString(), units:10000, classes:9, models:8, humanReferences:1, fixture:'Synthetic catalogue, no inference or actual source images', timingsMs:{} };
const times = result.timingsMs as Record<string,number>;
const measure = <T>(label:string, work:()=>T):T => { const before=performance.now(); const value=work(); times[label]=Math.round((performance.now()-before)*10)/10; return value; };
try {
 const d=repo.create('10k research fixture'), title=d.columns.find(c=>c.type==='title')!;
 const location=repo.addColumn(d.database.id,'Lugar','location');
 const columns=Array.from({length:9},(_,i)=>repo.addColumn(d.database.id,i===8?'Humano':'Modelo '+i,'select'));
 for(const c of columns) repo.saveOptions(c.id,Array.from({length:9},(_,i)=>({label:'Tema '+i,color:null})));
 const real=columns.map(c=>repo.column(c.id)); const at='2026-11-12T12:00:00Z';
 const insert=repo.db.prepare('INSERT INTO db_rows VALUES(?,?,?,?,?)'); const ids:string[]=[];
 measure('seed',()=>repo.db.transaction(()=>{
  for(let i=0;i<10000;i++){
   const id=randomUUID();ids.push(id);insert.run(id,d.database.id,i,at,at);
   repo.rawCell(id,title.id,'IMG'+String(i+1).padStart(5,'0'),'title');
   repo.rawCell(id,location.id,JSON.stringify({name:'Lugar '+(i%100),latitude:37+(i%100)/100,longitude:-3+(i%70)/100}),'location');
   real.forEach((c,j)=>{if((i+j)%113!==0)repo.rawCell(id,c.id,c.options[(i+(i%(j+2)===0?j:0))%9].id,'select');});
  }
 })());
 const research=new AgreementResearch(repo), config={...defaultAgreementConfig(),raters:real.slice(0,8).map(c=>({columnId:c.id,label:c.name,model:'fixture/model',prompt:'Fixture only'})),referenceId:real[8].id};
 const rss=process.memoryUsage().rss;
 const report=measure('agreement10000',()=>research.run({databaseId:d.database.id,config}));
 assert.equal(report.report.total,10000); assert.equal(report.report.pairs.length,36); assert.ok(report.report.rows.some(r=>r.source.id===ids.at(-1)));
 result.complete=report.report.complete;
 const complete=measure('agreementCommonCohort',()=>research.run({databaseId:d.database.id,config:{...config,cohort:'complete'}}));
 assert.ok(complete.report.pairs.every(p=>p.n===complete.report.complete));
 const groupFilter={columnId:real[0].id,op:'any' as const,value:[real[0].options[0].id]};
 const filtered=measure('filteredAgreement',()=>research.run({databaseId:d.database.id,config,filters:[groupFilter]}));
 assert.equal(filtered.report.total,repo.literal({databaseIds:[d.database.id],filters:[groupFilter]}).total);
 const map=measure('map10000',()=>repo.mapRecords({databaseId:d.database.id,columnId:location.id})); assert.equal(map.records.length,10000);
 const sorted=measure('filterAndSort',()=>repo.literal({databaseIds:[d.database.id],filters:[groupFilter],sorts:[{columnId:'$title',direction:'desc'}],limit:200}));
 assert.equal(sorted.rows.length,200);
 const saved=measure('saveSnapshot',()=>research.save(report.token,'10k reproducible fixture'));
 const loaded=measure('loadSnapshot',()=>research.load(saved.id)); assert.deepEqual(loaded.report.models,report.report.models);
 result.filtered=filtered.report.total; result.snapshotMB=Math.round(Buffer.byteLength(JSON.stringify(report.snapshot))/2**20*100)/100;
 result.rssGrowthMB=Math.round((process.memoryUsage().rss-rss)/2**20*10)/10; result.passed=true;
 fs.writeFileSync('test-results/final-research-volume.json',JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally {repo.close();fs.rmSync(root,{recursive:true,force:true});}
