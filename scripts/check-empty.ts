import { readFileSync, readdirSync } from 'fs';
let minimal = 0, total = 0;
const sample: unknown[] = [];
for (const f of readdirSync('data/records')) {
  const lines = readFileSync('data/records/'+f,'utf8').trim().split('\n').filter(Boolean);
  for (const l of lines) {
    total++;
    try {
      const r = JSON.parse(l) as Record<string, unknown>;
      // A login-page artifact: has recordNumber+url but nothing else meaningful
      const fields = ['title','description','classification','institution','collection',
        'techniqueMaterial','images','dimensions','conservationState'].filter(k => {
          const v = r[k];
          return v && (Array.isArray(v) ? (v as unknown[]).length > 0 : true);
        });
      if (fields.length === 0) {
        minimal++;
        if (sample.length < 3) sample.push(r);
      }
    } catch {}
  }
}
console.log({ total, minimal, pct: (minimal/total*100).toFixed(1)+'%' });
if (sample.length) console.log('sample minimal records:', JSON.stringify(sample, null, 2));
else console.log('no suspicious records found — data looks clean');
