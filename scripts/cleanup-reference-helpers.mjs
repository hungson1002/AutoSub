import fs from 'node:fs';
const files=['check-reference-runtime.mjs','inspect-reference-provider.mjs','reference-pilot-status.mjs','reference-flow-progress.mjs','list-reference-assets.mjs','reference-existing-contact.mjs','reference-existing-contact.ts','reference-cached-contact.mjs','reference-v2-contact.mjs','reference-local-progress.mjs'];
for(const name of files)fs.rmSync('scripts/'+name,{force:true});
fs.writeFileSync('workdir/reference-pilot/state.json',JSON.stringify({stage:'interrupted',error:'The detached verification process ended before asset generation completed. Observed Flow HTTP 400 responses; no completed new asset or production video. Preserve existing provider idempotency records before any resume.'},null,2));
console.log(JSON.stringify({removed:files.length}));
