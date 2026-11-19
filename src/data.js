// Edit these texts freely: they are read aloud (voice guide) and shown in the caption at each place.
// They are generic placeholders - replace them with the real descriptions from the farm owner.
export const PLACE_INFO = {
  entrance: 'Welcome to Navita Melon Farm. This is the main entrance.',
  parking_lots: 'These are the parking lots. Visitors park here before walking into the farm.',
  controlled_shed: 'The greenhouse, a controlled-environment shed where plants are grown under managed conditions.',
  reception: 'Reception. This is where visitors are welcomed and can ask for information.',
  melon_sculpture: 'The melon sculpture at the center of the plaza, the landmark of the farm.',
  melon_info_1: 'Melon information building number one.',
  melon_info_2: 'Melon information building number two.',
  melon_info_3: 'Melon information building number three.',
  cafe: 'The round cafe, a place to sit and relax during your visit.',
  buffer: 'The green buffer between the parking lots and the rest of the farm.',
  workshop: 'The workshop building.',
  outdoor_workshop: 'The outdoor workshop area, an open paved space for activities.',
  melon_farm: 'The melon farm. Rows of melon plants grow here. Say "pick up a melon" to harvest one.',
  photo_checkin: 'The photo and check-in spot, a round pergola at the edge of the melon farm.',
  pond: 'The pond, with seating around its edge.',
  pavilion: 'The pavilion beside the pond.',
  drive_through: 'The drive-through, where visitors can stop without leaving their cars.',
  drive_through_exit: 'The drive-through exit. Thank you for visiting Navita Melon Farm.',
  lawn: 'The open lawn.',
};

// Guided tour: EVERY place, in a walking order that loops around the farm.
export const TOUR_ORDER = [
  'entrance', 'lawn', 'parking_lots', 'controlled_shed', 'buffer', 'cafe', 'outdoor_workshop', 'workshop',
  'melon_info_2', 'melon_info_1', 'melon_info_3', 'melon_farm', 'photo_checkin', 'melon_sculpture', 'reception',
  'pond', 'pavilion', 'drive_through', 'drive_through_exit',
];

export const HELP = [
  'go to the cafe', 'run to the pool', 'walk north 20 meters', 'turn left', 'stop',
  'pick up a melon', 'start the tour', 'next place', 'double speed', 'triple speed', 'normal speed', 'hide labels',
];
