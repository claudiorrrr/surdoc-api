const fs = require('fs');
const idx = JSON.parse(fs.readFileSync('data/index.json','utf8'));
const facets = JSON.parse(fs.readFileSync('data/facets.json','utf8'));
const instId = new Map((facets.institution||[]).map(f=>[f.label, f.id]));
const shardCounts = {};
for (const r of idx) {
  const id = instId.get(r.institution||'') || 'unknown';
  shardCounts[id] = (shardCounts[id]||0) + 1;
}
let totalMissing = 0;
for (const [id, expected] of Object.entries(shardCounts)) {
  try {
    const lines = fs.readFileSync('data/records/'+id+'.ndjson','utf8').trim().split('\n').filter(Boolean).length;
    const missing = expected - lines;
    if (missing !== 0) console.log('shard', id, 'expected', expected, 'got', lines, 'missing', missing);
    totalMissing += Math.max(0, missing);
  } catch(e) { console.log('shard', id, 'FILE MISSING — expected', expected); totalMissing += expected; }
}
console.log('total missing:', totalMissing);
