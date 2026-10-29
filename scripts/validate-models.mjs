import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import electron from 'electron';
await build({entryPoints:['scripts/validate-models.ts'],outfile:'test-results/validate-models.mjs',bundle:true,packages:'external',platform:'node',format:'esm'});
const child=spawn(electron,['test-results/validate-models.mjs'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});child.on('exit',code=>process.exit(code??1));
