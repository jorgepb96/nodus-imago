import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Repository} from '../electron/db/repository';
import {Automations} from '../electron/automations';
import type {AutomationRule} from '../shared/automations';
test('automation outbox is durable, opt-in, atomic and prevents loops',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'imago-automations-'));let repo=new Repository(root);
 try{
  const d=repo.create('Research'),title=d.columns[0],label=repo.addColumn(d.database.id,'Label','text');let aiCalls=0;
  let automation=new Automations(repo,()=>{aiCalls++;return 'job';},()=>{});
  const rule:AutomationRule={id:'rule',databaseId:d.database.id,name:'Label images',enabled:false,trigger:'changed',watchColumnId:title.id,intervalMinutes:60,filters:[],actions:[{kind:'set',columnId:label.id,value:'Review',overwrite:false}]};
  automation.save(rule);const row=repo.createRow(d.database.id);repo.setCell(row.id,title.id,'A');automation.tick();assert.equal(repo.getRow(row.id).cells[label.id]??null,null);
  automation.save({...rule,enabled:true});repo.setCell(row.id,title.id,'B');repo.close();repo=new Repository(root);automation=new Automations(repo,()=>{aiCalls++;return 'job';},()=>{});automation.tick();assert.equal(repo.getRow(row.id).cells[label.id],'Review');
  assert.equal(automation.history(d.database.id).length,1);automation.tick();assert.equal(automation.history(d.database.id).length,1);assert.equal(aiCalls,0);
  automation.save({...rule,enabled:true,actions:[{kind:'set',columnId:label.id,value:'Should roll back',overwrite:true},{kind:'analyze',columnIds:[label.id]}]});
  automation=new Automations(repo,()=>{throw Error('Missing model');},()=>{});repo.setCell(row.id,title.id,'C');automation.tick();assert.equal(repo.getRow(row.id).cells[label.id],'Review');assert.equal(automation.history(d.database.id)[0].state,'failed');
  assert.equal((repo.db.prepare('SELECT muted FROM automation_control').get() as any).muted,0);
 }finally{repo.close();await fs.rm(root,{recursive:true,force:true});}
});
