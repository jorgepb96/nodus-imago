// Install current artifacts without copying the repository or selecting stale installers.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const output=path.resolve(process.env.IMAGO_PACKAGE_DIR||'release');
const files=await fs.readdir(output);
const run=(command,args,env=process.env)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${command} exited ${code}`)));});
const pick=extension=>{const matches=files.filter(f=>f.endsWith(extension));if(matches.length!==1)throw Error(`Expected exactly one current ${extension} in ${output}; found ${matches.length}`);return path.join(output,matches[0]);};
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'imago-installed-'));
const exercise=executable=>run(process.execPath,['scripts/ci-e2e.mjs'],{...process.env,IMAGO_E2E_EXECUTABLE:executable});
const evidence=[];
if(process.platform==='darwin') {
 const mount=path.join(temporary,'dmg');await fs.mkdir(mount);
 await run('hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,pick('.dmg')]);
 try {await exercise(path.join(mount,'Nodus Imago.app','Contents','MacOS','Nodus Imago'));evidence.push('DMG mounted read-only: all desktop flows');}
 finally {await run('hdiutil',['detach',mount]);}
 const zip=path.join(temporary,'zip');await fs.mkdir(zip);
 await run('ditto',['-x','-k',pick('.zip'),zip]);
 await exercise(path.join(zip,'Nodus Imago.app','Contents','MacOS','Nodus Imago'));evidence.push('ZIP extracted: all desktop flows');
} else if(process.platform==='win32') {
 const installed=path.join(temporary,'installed');
 await run(pick('.exe'),['/S','/D='+installed]);
 await exercise(path.join(installed,'Nodus Imago.exe'));evidence.push('NSIS installed: all desktop flows');
} else {
 const appImage=pick('.AppImage'),extract=path.join(temporary,'appimage');await fs.mkdir(extract);await fs.chmod(appImage,0o755);
 await new Promise((resolve,reject)=>{const child=spawn(appImage,['--appimage-extract'],{cwd:extract,stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error('AppImage extraction failed')));});
 await exercise(path.join(extract,'squashfs-root','AppRun'));evidence.push('AppImage extracted: all desktop flows');
 await run('sudo',['dpkg','-i',pick('.deb')]);
 await exercise('/opt/Nodus Imago/nodus-imago');evidence.push('DEB installed: all desktop flows');
 const rpm=path.join(temporary,'rpm');await fs.mkdir(rpm);
 await run('rpm2archive',['--format=tar','--nocompression',pick('.rpm')]);
 await run('tar',['-xf',pick('.rpm')+'.tar','-C',rpm]);
 await exercise(path.join(rpm,'opt','Nodus Imago','nodus-imago'));evidence.push('RPM extracted: all desktop flows on Ubuntu host');
}
await fs.mkdir('test-results',{recursive:true});
await fs.writeFile('test-results/packaged-native.json',JSON.stringify({platform:process.platform,arch:process.arch,evidence,unsigned:true},null,2));
