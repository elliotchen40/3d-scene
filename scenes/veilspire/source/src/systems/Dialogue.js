// Contextual chatter. Lines are picked from pools keyed by what is true right
// now: the hour, the weather, and how long you have been in the valley.
//
// The valley has no quests and no enemies left in it, so nothing anyone says
// is about fighting. They talk about the light, the weather, the buildings
// around them, and each other — the texture of an ordinary day.

const GREETING = {
  stranger: [
    'New face at the academy?',
    'Mind the cliff path past the treeline.',
    'You have the look of a first-year.',
    'The wind comes in off the water this morning.',
  ],
  noticed: [
    'You have been out past the wards, haven’t you.',
    'The mist sits thicker in the valley after rain.',
    'You walk like someone who knows the way well.',
  ],
  known: [
    'The professor speaks well of you.',
    'You’re a familiar face now — the gate has seen you enough.',
    'Word travels fast in a castle this small.',
  ],
  hero: [
    'You have been everywhere in this valley, haven’t you.',
    'You know the paths better than the paths know you.',
    'They will remember your face on these stones.',
  ],
};

const BY_HOUR = [
  { from: 5, to: 8, lines: ['Too early for lessons.', 'The mist hasn’t lifted yet.'] },
  { from: 8, to: 12, lines: ['Lessons start soon — don’t be late.', 'I have theory first period.'] },
  { from: 12, to: 15, lines: ['The courtyard is warm today.', 'Have you eaten?'] },
  { from: 15, to: 19, lines: ['Good hour for a walk to the lake.', 'The light is lovely this time of day.'] },
  { from: 19, to: 24, lines: ['Curfew soon.', 'The corridors get strange after dark.'] },
  { from: 0, to: 5, lines: ['You shouldn’t be out at this hour.', 'Did you hear that, out past the wall?'] },
];

const BY_WEATHER = {
  rain: ['This rain will not let up.', 'My robes are soaked through.', 'Inside, quickly — you’ll catch cold.'],
  storm: ['That thunder shook the windows!', 'Get under cover, the sky is angry.', 'Storms like this make the old stones groan.'],
  overcast: ['Gloomy sort of day.', 'Feels like rain coming.'],
};

// Longer exchanges when the player presses F
const CONVERSATION = {
  stranger: 'The academy looks bigger from outside than in — you’ll learn its shortcuts soon enough. ' +
    'Just don’t take the east stair after dark.',
  noticed: 'You have been up on the cliff path, haven’t you? The view up there is worth the climb, ' +
    'though the wind up there is not kind about it.',
  known: 'The lanterns stay lit all the way to the gate on your account. ' +
    'Small thing, maybe. It matters to those of us who walk it.',
  hero: 'You have seen every corner of this valley, I think. ' +
    'I am not sure whether to envy you or to be glad you are still here.',
};

export function pickGreeting(worldState, hour, weatherState, rng = Math.random) {
  const pools = [];
  // Weather is the most immediate thing to remark on
  if (BY_WEATHER[weatherState]) pools.push(...BY_WEATHER[weatherState]);
  const slot = BY_HOUR.find((h) => hour >= h.from && hour < h.to);
  if (slot) pools.push(...slot.lines);
  pools.push(...GREETING[worldState.standing]);
  // Deeds get double weight so the world feels like it is watching
  pools.push(...GREETING[worldState.standing]);
  return pools[Math.floor(rng() * pools.length)];
}

export function pickConversation(worldState) {
  return CONVERSATION[worldState.standing];
}
