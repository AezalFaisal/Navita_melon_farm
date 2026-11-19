// Exact stand points / label points (Blender x, y in metres) for places that were off. Usage: node tools/fix_places.js
const fs = require('fs');
const f = 'public/models/tour.json';
const j = JSON.parse(fs.readFileSync(f, 'utf8'));
const FIX = {
  cafe:               { stand: [60.5, 116.5], label: [60, 120] },     // inside the round cafe
  melon_info_1:       { stand: [112.5, 141],  label: [112, 141] },    // inside the north room
  melon_info_3:       { stand: [144, 137],    label: [143, 137] },    // inside the east wing
  pond:               { stand: [184.5, 100.5], label: [185, 100] },   // at the water's edge
  drive_through:      { stand: [206.5, 56.5], label: [203, 58] },     // at the shop's serving window
  drive_through_exit: { stand: [226.5, 79],   label: [227, 80] },     // where the drive-through lane meets the main road
};
for (const p of j.places) {
  const c = FIX[p.id]; if (!c) continue;
  p.stand_three = [c.stand[0], p.stand_three[1], -c.stand[1]];
  p.label_three = [c.label[0], p.label_three[1], -c.label[1]];
  console.log('fixed', p.id, p.stand_three);
}
fs.writeFileSync(f, JSON.stringify(j, null, 1));
