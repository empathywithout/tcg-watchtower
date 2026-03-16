// ================================================================
// SET-TEMPLATE-PATCH.js
// Apply ALL of these find/replace operations in set-template.html
// Use Ctrl+H (Find & Replace) in your editor
// ================================================================

// ── PATCH 1: Hero card stretch fix (CSS) ────────────────────────
// FIND:
// .card-stack img {
//   position:absolute; width:180px; border-radius:12px;
//   box-shadow: 0 20px 60px rgba(0,0,0,0.6);
//   transition: transform 0.3s;
// }
//
// REPLACE WITH:
// .card-stack img {
//   position:absolute; width:180px; height:auto; border-radius:12px;
//   box-shadow: 0 20px 60px rgba(0,0,0,0.6);
//   transition: transform 0.3s;
//   object-fit: contain;
// }


// ── PATCH 2: Add Mega Hyper Rare to chase filter ─────────────────
// FIND:
// const CHASE_RARITIES = ['Special Illustration Rare', 'Hyper Rare', 'Ultra Rare', 'Illustration Rare'];
//
// REPLACE WITH:
// const CHASE_RARITIES = ['Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare', 'Ultra Rare', 'Illustration Rare'];


// ── PATCH 3: Update rarity sort tier ────────────────────────────
// FIND:
// const RARITY_TIER = { 'Hyper Rare': 0, 'Special Illustration Rare': 1, 'Ultra Rare': 2, 'Illustration Rare': 3 };
//
// REPLACE WITH:
// const RARITY_TIER = { 'Mega Hyper Rare': 0, 'Hyper Rare': 1, 'Special Illustration Rare': 2, 'Ultra Rare': 3, 'Illustration Rare': 4 };


// ── PATCH 4: Update rarity badge labels ─────────────────────────
// FIND:
// const RARITY_LABEL = { 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' };
//
// REPLACE WITH:
// const RARITY_LABEL = { 'Mega Hyper Rare': 'MHR', 'Hyper Rare': 'HR', 'Special Illustration Rare': 'SIR', 'Ultra Rare': 'UR', 'Illustration Rare': 'IR' };


// ── PATCH 5: Update rarity badge CSS classes ─────────────────────
// FIND:
// const RARITY_CLASS = { 'Hyper Rare': 'rarity-hr', 'Special Illustration Rare': 'rarity-sir', 'Ultra Rare': 'rarity-ur', 'Illustration Rare': 'rarity-ir' };
//
// REPLACE WITH:
// const RARITY_CLASS = { 'Mega Hyper Rare': 'rarity-hr', 'Hyper Rare': 'rarity-hr', 'Special Illustration Rare': 'rarity-sir', 'Ultra Rare': 'rarity-ur', 'Illustration Rare': 'rarity-ir' };


// ================================================================
// AFTER APPLYING ALL PATCHES TO set-template.html:
// Re-run the generator for all ME sets to rebuild their HTML.
// ================================================================
