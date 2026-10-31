// What the valley remembers about the player. NPC dialogue reads these flags,
// so the world comments on what you have actually done.
//
// With the quests and the fight removed, the only thing the valley can know
// is how long you have been here and how much of it you have walked.

export class WorldState {
  constructor() {
    this.flags = {};
    this.visits = 0;
    this.distanceWalked = 0;
  }

  set(flag, value = true) { this.flags[flag] = value; }
  has(flag) { return !!this.flags[flag]; }

  // A short label for the player's current standing, used to pick greetings
  get standing() {
    if (this.distanceWalked > 4000 || this.visits > 3) return 'hero';
    if (this.distanceWalked > 1200 || this.visits > 1) return 'known';
    if (this.distanceWalked > 200) return 'noticed';
    return 'stranger';
  }
}
