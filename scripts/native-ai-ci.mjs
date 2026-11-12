import {spawn} from 'node:child_process';
for(const script of ['scripts/onboarding-e2e.mjs','scripts/native-ai-e2e.mjs']) {
 const command=process.platform==='linux'?'xvfb-run':process.execPath;
 const args=process.platform==='linux'?['-a','env','IMAGO_E2E_NO_SANDBOX=1',process.execPath,script]:[script];
 const code=await new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env:process.env});child.on('error',reject);child.on('exit',resolve);});
 if(code!==0)process.exit(code??1);
}
