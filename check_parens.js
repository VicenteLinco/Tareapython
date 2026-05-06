const fs = require('fs');
const content = fs.readFileSync('frontend/src/pages/recepciones/nueva.tsx', 'utf8');
const lines = content.split('\n');
let balance = 0;
let firstImbalanced = null;

for (let lineIdx = 662; lineIdx < 984; lineIdx++) {
  const line = lines[lineIdx];
  let inStr = null;
  let inBlockComment = false;
  let inLineComment = false;
  let prevBalance = balance;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    const next = i+1 < line.length ? line[i+1] : '';

    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inLineComment) break;
    if (inStr) {
      if (inStr === '`') {
        if (c === '`') inStr = null;
      } else {
        if (c === '\\') { i++; continue; }
        if (c === inStr) inStr = null;
      }
      continue;
    }
    if (c === '/' && next === '/') { inLineComment = true; break; }
    if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(') balance++;
    if (c === ')') balance--;
  }
  if (lineIdx >= 978) {
    console.log('Line ' + (lineIdx+1) + ' balance=' + balance + ': ' + line.trim().substring(0,70));
  }
}
console.log('\nFinal balance (lines 663-984):', balance);
