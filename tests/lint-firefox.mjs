// Firefox lint pass: lint the extension exactly as Firefox sees it (Firefox ignores
// background.service_worker and uses background.scripts), with warnings treated as errors.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zg-firefox-'));
fs.cpSync(path.resolve(HERE, '../extension'), tmp, { recursive: true });
const mfPath = path.join(tmp, 'manifest.json');
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
delete mf.background.service_worker;
fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
const bin = path.join(HERE, 'node_modules', '.bin', process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext');
try {
  execFileSync(bin, ['lint', '--source-dir', tmp, '--warnings-as-errors'], { stdio: 'inherit' });
  console.log('Firefox lint: 0 errors, 0 warnings');
} catch (e) {
  process.exit(e.status || 1);
}
