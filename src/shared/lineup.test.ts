import { describe, expect, it } from 'vitest';
import { makeLineup } from './lineup';

describe('makeLineup', () => {
  it('gives six runners, each with an animal, an outfit and two facts', () => {
    const l = makeLineup();
    expect(l).toHaveLength(6);
    for (const r of l) {
      expect(r.animalFact).toMatch(/^This /);
      expect(r.jockeyFact).toMatch(/^This jockey/);
      expect(r.animalFact).not.toContain('{a}');
    }
  });

  it('never repeats a common fact within a round', () => {
    for (let i = 0; i < 200; i++) {
      const l = makeLineup();
      const facts = l.filter((r) => r.animal === 'horse').map((r) => r.animalFact);
      expect(new Set(facts).size).toBe(facts.length);
    }
  });

  it('is mostly horses, with the odd rare animal and fancy dress', () => {
    const all = Array.from({ length: 500 }, () => makeLineup()).flat();
    const horses = all.filter((r) => r.animal === 'horse').length / all.length;
    expect(horses).toBeGreaterThan(0.75);
    expect(horses).toBeLessThan(0.92);
    expect(all.some((r) => r.animal === 'unicorn')).toBe(true);
    expect(all.some((r) => r.outfit === 'santa')).toBe(true);
  });
});
