// Native Intel packaging only. Cross-architecture repo copies are intentionally forbidden.
import {spawn} from 'node:child_process';
if(process.platform!=='darwin'||process.arch!=='x64')throw Error('Build on the native macos-15-intel CI runner. The current repository and ARM64 dependencies are left untouched.');
const p=spawn('npx',['electron-builder','--mac','--x64','--config','build/electron-builder.cjs','--publish','never'],{stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});p.on('exit',code=>process.exit(code??1));
