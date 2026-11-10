import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const python=fileURLToPath(new URL(process.platform==='win32'?'../.local/venv/Scripts/python.exe':'../.local/venv/bin/python',import.meta.url));
if(!existsSync(python)) {
  console.error('Set up the local Python environment first; see models/swisstopo/README.md.');
  process.exit(1);
}
const args=process.argv.slice(2),check=args[0]==='--check';
const result=spawnSync(python,['-u',check?'scripts/check_swisstopo.py':'scripts/prepare_swisstopo.py',...(check?args.slice(1):args)],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
