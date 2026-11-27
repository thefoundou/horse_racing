// Each round's runners: what's actually racing in lanes 1-6 (usually horses,
// now and then something rarer), what each jockey is wearing, and a made-up
// fun fact about each. Picked by the lobby when a round starts, so every
// screen shows the same lineup.

import { HORSES } from './game';

export type Animal = 'horse' | 'zebra' | 'giraffe' | 'donkey' | 'cow' | 'unicorn';
export type Outfit = 'silks' | 'santa' | 'bunny' | 'cowboy' | 'tophat' | 'crown' | 'pirate' | 'chef' | 'viking' | 'wizard';

export interface Runner {
  animal: Animal;
  /** Coat colour for horses (index into the client's coat palette). */
  coat: number;
  outfit: Outfit;
  /** A (made-up) fun fact about the animal… */
  animalFact: string;
  /** …and one about its jockey. */
  jockeyFact: string;
}

/** How often each animal turns up: mostly horses, with the odd surprise. */
const ANIMALS: [Animal, number][] = [
  ['horse', 84], ['zebra', 4], ['giraffe', 4], ['donkey', 3], ['cow', 3], ['unicorn', 2],
];
/** Most jockeys wear racing silks; the rest are… not. */
const OUTFITS: [Outfit, number][] = [
  ['silks', 55], ['santa', 5], ['bunny', 5], ['cowboy', 5], ['tophat', 5], ['crown', 5],
  ['pirate', 5], ['chef', 5], ['viking', 5], ['wizard', 5],
];
export const COATS = 6;

export const ANIMAL_LABEL: Record<Animal, string> = {
  horse: 'Horse', zebra: '🦓 Zebra', giraffe: '🦒 Giraffe', donkey: 'Donkey', cow: '🐄 Cow', unicorn: '🦄 Unicorn',
};

/** Facts for any animal; `{a}` becomes "horse", "zebra" and so on. */
const ANIMAL_FACTS = [
  'This {a} came from Albania.',
  'This {a} was once a carousel horse and still goes round in circles when nervous.',
  'This {a} has never lost a staring contest.',
  'This {a} only eats organic carrots, flown in from Peru.',
  'This {a} is allergic to hay.',
  'This {a} has 40,000 followers on Instagram.',
  'This {a} has retired twice and came back both times for the snacks.',
  'This {a} was raised by a family of goats.',
  'This {a} once outran a parking ticket.',
  'This {a} only runs if someone is clapping.',
  'This {a} has a lucky sock. Nobody knows where it keeps it.',
  'This {a} was bought for three magic beans.',
  'This {a} is technically a tax write-off.',
  'This {a} hosts a podcast about oats.',
  'This {a} learned to gallop from YouTube tutorials.',
  'This {a} is terrified of butterflies.',
  'This {a} sleeps standing up, mostly during races.',
  'This {a} was voted "Most Likely to Bite a Steward".',
  'This {a} has a twin who is much faster and much meaner.',
  'This {a} is named after the owner\'s ex.',
  'This {a} once won a race it wasn\'t entered in.',
  'This {a} insists on a window seat in the horsebox.',
  'This {a} speaks fluent French but refuses to show it.',
  'This {a} was found wandering a supermarket car park.',
  'This {a} has been banned from three petting zoos.',
  'This {a} trains by chasing the ice-cream van.',
  'This {a} is 30% faster on Tuesdays.',
  'This {a} has never seen a finish line, but has heard great things.',
  'This {a}\'s great-grandmother pulled Queen Victoria\'s laundry cart.',
  'This {a} was sold online "as seen".',
  'This {a} is fuelled entirely by sugar cubes and spite.',
  'This {a} has a personal hairdresser for its mane.',
];

/** The rarer animals always get their own fact. */
const RARE_FACTS: Partial<Record<Animal, string[]>> = {
  zebra: ['This zebra escaped from a zoo and nobody has noticed yet.', 'This zebra insists the stripes are slimming.'],
  giraffe: ['This giraffe can see the finish line from the starting gate.', 'This giraffe has never once fitted in the horsebox.'],
  donkey: ['This donkey is only here on a technicality.', 'This donkey was promised it was a beach ride.'],
  cow: ['This cow was entered by mistake and decided to go with it.', 'This cow is mainly here for the grass.'],
  unicorn: ['This unicorn is not legally allowed to use its horn.', 'This unicorn has been fact-checked and does not exist.'],
};

const JOCKEY_FACTS = [
  'This jockey is on their 4th hip replacement.',
  'This jockey has never ridden a horse before today.',
  'This jockey is wanted in two counties.',
  'This jockey is 94 years old and undefeated at bingo.',
  'This jockey weighs exactly one bag of potatoes.',
  'This jockey only knows how to turn left.',
  'This jockey has bet their own house on this race.',
  'This jockey once fell off a stationary horse.',
  'This jockey trained at clown college.',
  'This jockey has a pet goldfish called Lightning.',
  'This jockey is the horse\'s landlord.',
  'This jockey has three exes in the grandstand.',
  'This jockey thinks this is a dressage event.',
  'This jockey ate a full English breakfast ten minutes ago.',
  'This jockey is mostly held together by duct tape.',
  'This jockey was disqualified in 2019 for riding a bicycle.',
  'This jockey has a black belt in karaoke.',
  'This jockey has never finished a race awake.',
  'This jockey keeps a raw egg in their left boot for luck.',
  'This jockey was a stunt double in a toothpaste advert.',
  'This jockey can\'t swim, which has never come up.',
  'This jockey is related to the horse, somehow.',
  'This jockey writes poetry about mud.',
  'This jockey sneezed through their last three races.',
  'This jockey once raced a train and lost badly.',
  'This jockey is only here for the free sandwiches.',
  'This jockey is scared of horses.',
  'This jockey learned to ride on a mechanical bull in Ibiza.',
  'This jockey has their tax return due at midnight.',
  'This jockey owes the bookies £40.',
];

/** Jockeys in fancy dress sometimes get a fact about the outfit instead. */
const OUTFIT_FACTS: Partial<Record<Outfit, string>> = {
  santa: 'This jockey refuses to say whether they\'re the real Santa.',
  bunny: 'This jockey came straight from an Easter egg hunt and hasn\'t checked their pockets.',
  cowboy: 'This jockey keeps asking where to tie up the horse.',
  tophat: 'This jockey is overdressed and knows it.',
  crown: 'This jockey claims to be minor royalty. Nobody has checked.',
  pirate: 'This jockey insists on being called Captain.',
  chef: 'This jockey has a soufflé in the oven and needs to win quickly.',
  viking: 'This jockey arrived by longboat.',
  wizard: 'This jockey has cast a speed spell. Results may vary.',
};

function weighted<T>(table: [T, number][], random: () => number): T {
  let r = random() * table.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of table) if ((r -= w) < 0) return v;
  return table[0][0];
}

/** Take a random item out of `pool` (so the round has no repeats). */
function draw(pool: string[], random: () => number): string {
  return pool.splice(Math.floor(random() * pool.length), 1)[0] ?? '';
}

/** A fresh lineup for a round: six runners, no fact used twice. */
export function makeLineup(random: () => number = Math.random): Runner[] {
  const animalFacts = ANIMAL_FACTS.slice(), jockeyFacts = JOCKEY_FACTS.slice();
  return Array.from({ length: HORSES }, () => {
    const animal = weighted(ANIMALS, random);
    const outfit = weighted(OUTFITS, random);
    const rare = RARE_FACTS[animal];
    const animalFact = rare ? rare[Math.floor(random() * rare.length)] : draw(animalFacts, random).replace('{a}', animal);
    const outfitFact = OUTFIT_FACTS[outfit];
    const jockeyFact = outfitFact && random() < 0.5 ? outfitFact : draw(jockeyFacts, random);
    return { animal, coat: Math.floor(random() * COATS), outfit, animalFact, jockeyFact };
  });
}
