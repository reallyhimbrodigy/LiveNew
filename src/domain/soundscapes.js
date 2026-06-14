export const SOUNDSCAPES = [
  // FREE
  { id: 'brown',     name: 'Brown noise',    free: true,  desc: 'Deep, even calm. The one everyone swears by.',       source: require('../../assets/audio/brown-noise.m4a') },
  { id: 'rain',      name: 'Rain',            free: true,  desc: 'Soft, steady rainfall.',                             source: require('../../assets/audio/rain.m4a') },
  { id: 'ocean',     name: 'Ocean',           free: true,  desc: 'Slow waves rolling in.',                             source: require('../../assets/audio/ocean.m4a') },
  // PREMIUM
  { id: 'white',     name: 'White noise',     free: false, desc: 'A soft, airy hush.',                                 source: require('../../assets/audio/white-noise.m4a') },
  { id: 'pink',      name: 'Pink noise',      free: false, desc: 'Gentler than white — rounded and warm.',             source: require('../../assets/audio/pink-noise.m4a') },
  { id: 'stream',    name: 'Stream',          free: false, desc: 'A quiet creek over stones.',                         source: require('../../assets/audio/stream.m4a') },
  { id: 'distant',   name: 'Distant shore',   free: false, desc: 'Waves, far away.',                                   source: require('../../assets/audio/distant-waves.m4a') },
  { id: 'wind',      name: 'Wind',            free: false, desc: 'A soft breeze through open space.',                  source: require('../../assets/audio/wind.m4a') },
  { id: 'still',     name: 'Stillness',       free: false, desc: 'A warm low hum to wind down.',                       source: require('../../assets/audio/stillness.m4a') },
  { id: 'drone',     name: 'Deep drone',      free: false, desc: 'A meditative, grounding tone.',                      source: require('../../assets/audio/drone.m4a') },
  { id: 'heavyrain', name: 'Heavy rain',      free: false, desc: 'A full, enveloping downpour.',                       source: require('../../assets/audio/heavy-rain.m4a') },
  { id: 'fan',       name: 'Fan',             free: false, desc: 'Steady, familiar air.',                              source: require('../../assets/audio/fan.m4a') },
  { id: 'underwater',name: 'Underwater',      free: false, desc: 'Muffled and weightless.',                            source: require('../../assets/audio/underwater.m4a') },
  { id: 'night',     name: 'Night air',       free: false, desc: 'A faint, cool hush.',                                source: require('../../assets/audio/night-air.m4a') },
  { id: 'cocoon',    name: 'Cocoon',          free: false, desc: 'Soft warmth, all around you.',                       source: require('../../assets/audio/cocoon.m4a') },
];

export function soundscapeById(id) { return SOUNDSCAPES.find(s => s.id === id); }
