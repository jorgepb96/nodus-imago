import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFileSync} from 'node:child_process';
const directory=process.argv[2];if(!directory)throw Error('Choose the current build output directory.');
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const files=(await fs.readdir(directory)).filter(file=>/\.(?:dmg|zip|exe|AppImage|deb|rpm)$/.test(file));
if(!files.length)throw Error('No current installers found.');
const artifacts=[];
for(const file of files){const location=path.join(directory,file),hash=createHash('sha256');for await(const chunk of createReadStream(location))hash.update(chunk);artifacts.push({file,bytes:(await fs.stat(location)).size,sha256:hash.digest('hex')});}
await fs.writeFile(path.join(directory,'artifacts.json'),JSON.stringify({commit,date:new Date().toISOString(),signed:false,release:false,platform:process.platform,arch:process.arch,artifacts},null,2));
await fs.writeFile(path.join(directory,'SHA256SUMS'),artifacts.map(a=>a.sha256+'  '+a.file).join('\n')+'\n');
console.log('Recorded',artifacts.length,'test installers for',commit);
