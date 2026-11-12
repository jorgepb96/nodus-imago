import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Repository} from '../electron/db/repository';
import {writeBackup,restoreBackup} from '../electron/export/backup';
test('block documents update atomically, retain imported originals and survive backup restore',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'imago-blocks-')),repo=new Repository(path.join(root,'source')),restored=new Repository(path.join(root,'restored'));
 try{
  const d=repo.create('Pages'),c=repo.addColumn(d.database.id,'Content','rich_text'),r=repo.createRow(d.database.id);
  repo.setCell(r.id,c.id,'# Original\n\n- Parent\n  - Child');
  repo.db.prepare('UPDATE page_documents SET imported_markdown=source_markdown').run();
  repo.setCell(r.id,c.id,'# Edited');
  assert.match(repo.pageDocument(r.id,c.id).importedMarkdown!,/Child/);
  assert.equal(repo.pageDocument(r.id,c.id).blocks[0].text,'Edited');
  const backup=path.join(root,'backup.zip');await writeBackup(repo,backup);await restoreBackup(restored,backup);
  assert.deepEqual(restored.pageDocument(r.id,c.id),repo.pageDocument(r.id,c.id));
  repo.setCell(r.id,c.id,null);assert.equal(repo.pageDocument(r.id,c.id).blocks.length,0);
 }finally{repo.close();restored.close();await fs.rm(root,{recursive:true,force:true});}
});
