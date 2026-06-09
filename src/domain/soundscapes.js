export const SOUNDSCAPES = [
  { id: 'brown', name: 'Brown noise', desc: 'Deep, even focus. The one everyone swears by.', source: require('../../assets/audio/brown-noise.m4a') },
  { id: 'rain',  name: 'Rain',        desc: 'Soft rainfall to settle the system.',           source: require('../../assets/audio/rain.m4a') },
  { id: 'pink',  name: 'Pink noise',  desc: 'Softer than brown — calm without the rumble.',   source: require('../../assets/audio/pink-noise.m4a') },
  { id: 'still', name: 'Stillness',   desc: 'A warm low hum for winding down.',                source: require('../../assets/audio/stillness.m4a') },
];

export function soundscapeById(id) { return SOUNDSCAPES.find(s => s.id === id); }
