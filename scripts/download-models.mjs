// Explicit developer/user action only. Never run by build, test or postinstall.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
if(!process.argv.includes('--yes'))throw new Error('This downloads about 3 GB of model weights. Run with --yes only after explicit user consent.');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.IMAGO_USER_DATA;delete env.IMAGO_DEV_URL;
const app=await electron.launch({args:['.'],env});
try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.imago);
  let status=await page.evaluate(()=>window.imago.call('status'));
  console.log('Model store:',path.join(status.root,'models'));
  const jobs=[];
  for(const id of ['embeddinggemma2','lfm3-vl-2b','llama-runtime']){
    if(!status.models.find(m=>m.id===id)?.verified)jobs.push(await page.evaluate(id=>window.imago.call('downloadModel',{id}),id));
  }
  let previous='';
  while(jobs.length){
    const list=await page.evaluate(()=>window.imago.call('jobs')),current=jobs.map(id=>list.find(j=>j.id===id));
    const summary=current.map(j=>`${j.kind}: ${j.done}/${j.total} ${j.state} ${j.message??''}`).join(' | ');
    if(summary!==previous){console.log(summary);previous=summary;}
    const failed=current.find(j=>j.state==='failed'||j.state==='cancelled');if(failed)throw new Error(failed.message??'Model download failed.');
    if(current.every(j=>j.state==='completed'))break;
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  await page.evaluate(python=>window.imago.call('updateSettings',{python,device:'cpu',dimensions:512,descriptionModel:{provider:'local',model:'lfm3-vl-2b'},classificationModel:{provider:'local',model:'lfm3-vl-2b'}}),path.resolve('.venv/bin/python'));
  status=await page.evaluate(()=>window.imago.call('status'));
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile('test-results/model-store.json',JSON.stringify({root:status.root,models:status.models},null,2));
  console.log('All requested models downloaded and integrity-verified.');
}finally{await app.close();}
