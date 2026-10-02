import { readFile, writeFile } from 'node:fs/promises';

const file = 'server/services/animationDirector.ts';
const source = await readFile(file, 'utf8');
const lines = source.split(/\r?\n/);
const index = 259;
if (!lines[index]) throw new Error('Không tìm thấy dòng 260 trong animationDirector.ts.');

const before = lines[index];
let after = before;

// Repair English possessive contractions accidentally inserted inside a
// single-quoted TypeScript string, e.g. mascot's -> mascot\'s.
after = after.replace(/([A-Za-z])'s\b/g, "$1\\'s");

if (after === before) {
  console.log('LINE_260_NO_CHANGE');
  console.log(before);
  process.exitCode = 2;
} else {
  lines[index] = after;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  await writeFile(file, lines.join(newline), 'utf8');
  console.log('LINE_260_PATCHED');
  console.log('BEFORE:', before);
  console.log('AFTER :', after);
}
