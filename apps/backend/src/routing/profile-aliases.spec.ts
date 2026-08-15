import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTING_PROFILES, routingProfileFamily } from './routing.types';

describe('public GraphHopper profile aliases', () => {
  it('keeps legacy profiles and exposes configured aliases', () => {
    expect(ROUTING_PROFILES).toEqual(expect.arrayContaining(['bike', 'mtb', 'foot', 'car', 'bike_touring', 'mtb_leisure', 'foot_scenic']));
    expect(routingProfileFamily('bike_touring')).toBe('bike');
    expect(routingProfileFamily('mtb_leisure')).toBe('mtb');
    expect(routingProfileFamily('foot_scenic')).toBe('foot');
  });
  it('declares separate custom models and LM preparations for each adventure profile', () => {
    const graphhopperDir = new URL('../../../../docker/graphhopper/', import.meta.url);
    const config = readFileSync(new URL('config.yml', graphhopperDir), 'utf8');
    const expected = {
      bike_touring: 'nearventure-bike-touring.json',
      mtb_leisure: 'nearventure-mtb-leisure.json',
      foot_scenic: 'nearventure-foot-scenic.json',
    };
    for (const [profile, modelFile] of Object.entries(expected)) {
      expect(config).toMatch(new RegExp(`name: ${profile}`));
      expect(config).toMatch(new RegExp(`profile: ${profile}`));
      expect(config).toMatch(new RegExp(`name: ${profile}\\n\\s+custom_model_files: \\[[^\\]]*${modelFile}`));
      const model = JSON.parse(readFileSync(new URL(`models/${modelFile}`, graphhopperDir), 'utf8'));
      expect(model.priority.length).toBeGreaterThan(0);
      expect(model.distance_influence).toBeGreaterThan(0);
    }
    const touring = readFileSync(new URL('models/nearventure-bike-touring.json', graphhopperDir), 'utf8');
    const leisure = readFileSync(new URL('models/nearventure-mtb-leisure.json', graphhopperDir), 'utf8');
    const scenic = readFileSync(new URL('models/nearventure-foot-scenic.json', graphhopperDir), 'utf8');
    expect(touring).toContain('surface == ASPHALT');
    expect(leisure).toContain('mtb_rating > 3');
    expect(scenic).toContain('road_class == PATH');
  });
});
