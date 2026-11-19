// The avatar line-up. Every avatar is a rigged GLB with animation clips; `clips` maps OUR clip names
// (Idle, Walk, Run, Pick, Wave, Cheer) to the names used inside each file.
export const AVATARS = [
  {
    id: 'explorer', name: 'Melon Explorer', url: './models/avatars/melon_explorer.glb',
    clips: { Idle: 'Idle', Walk: 'Walk', Run: 'Run', Pick: 'Pick', Wave: 'Wave', Cheer: 'Cheer' },
    height: 1.5, scale: 1, handBone: 'RightHand', designWalk: 1.0, designRun: 2.3,
  },
  {
    id: 'farmer', name: 'Straw-Hat Farmer', url: './models/avatars/farmer.glb',
    clips: { Idle: 'Idle', Walk: 'Walk', Run: 'Run', Pick: 'Harvest' },
    height: 1.4, scale: 1.4, handBone: 'Hand.R', designWalk: 1.3, designRun: 3.0, legs: true,   // legs driven procedurally (clip legs cross)
  },
  {
    id: 'melonfarmer', name: 'Melon Farmer', url: './models/avatars/melon_farmer.glb',
    clips: { Walk: 'Walk', Run: 'Run', Pick: 'Harvest' },                      // no Idle clip: stands in its rest pose
    height: 1.4, scale: 1, handBone: 'RightHand', designWalk: 1.3, designRun: 3.0,
  },
  {
    id: 'meli', name: 'Meli', url: './models/avatars/meli_girl.glb',
    clips: { Idle: 'Idle', Walk: 'Walk', Run: 'Run', Pick: 'Harvest', Cheer: 'Celebrate' },
    height: 1.4, scale: 1, handBone: 'Hand.R', designWalk: 1.3, designRun: 3.0,
  },
];
