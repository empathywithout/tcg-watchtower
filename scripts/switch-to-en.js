// scripts/switch-to-en.js
// Switches a set from JP preview phase to EN phase in sets.json.
// Run this when the English set releases on TCGplayer.
//
// Usage:
//   SET_ID=sv11 TCGP_GROUP_ID=99999 node scripts/switch-to-en.js
//
// Then run sync-card-images workflow with PHASE=en to pull EN images to R2.

import { readFileSync, writeFileSync } from 'fs';

const SET_ID       = (process.env.SET_ID        || '').trim();
const TCGP_GROUP_ID = (process.env.TCGP_GROUP_ID || '').trim();

if (!SET_ID)        { console.error('❌ SET_ID required');        process.exit(1); }
if (!TCGP_GROUP_ID) { console.error('❌ TCGP_GROUP_ID required'); process.exit(1); }

const setsPath = 'sets.json';
const sets     = JSON.parse(readFileSync(setsPath, 'utf8'));
const entry    = sets.find(s => s.setId === SET_ID);

if (!entry) {
  console.error(`❌ No set found with setId="${SET_ID}" in sets.json`);
  process.exit(1);
}

if (entry.phase === 'en') {
  console.log(`ℹ️  ${SET_ID} is already in EN phase — nothing to do`);
  process.exit(0);
}

const oldPhase = entry.phase;
entry.phase        = 'en';
entry.tcgpGroupId  = TCGP_GROUP_ID;

writeFileSync(setsPath, JSON.stringify(sets, null, 2));

console.log(`✅ Switched ${SET_ID} from "${oldPhase}" → "en"`);
console.log(`   tcgpGroupId set to ${TCGP_GROUP_ID}`);
console.log(`\nNext steps:`);
console.log(`  1. Run the "Sync Card Images to R2" workflow with:`);
console.log(`       SET_ID=${SET_ID}  PHASE=en`);
console.log(`  2. Commit sets.json`);
console.log(`  3. Redeploy — prices will load automatically from TCGplayer`);
