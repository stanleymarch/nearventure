import { describe, expect, it } from 'vitest';
import { LoopQualityService } from './loop-quality.service';

const quality = new LoopQualityService();

describe('LoopQualityService', () => {
  it('does not score a normal closed loop as self-overlap', () => {
    const result = quality.assess([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]);
    expect(result.repeatedRoadRatio).toBeLessThan(0.1);
  });

  it('detects a real out-and-back by repeated length', () => {
    const result = quality.assess([[0, 0], [0.01, 0], [0.02, 0], [0.03, 0], [0.02, 0], [0.01, 0], [0, 0]]);
    expect(result.repeatedRoadRatio).toBeGreaterThan(0.7);
    expect(result.warnings).toContain('UNAVOIDABLE_OUT_AND_BACK');
  });

  it('matches the same road with unequal source segmentation', () => {
    const outbound = [[0, 0], [0.03, 0]];
    const returned = [[0.03, 0], [0.025, 0], [0.014, 0], [0.006, 0], [0, 0]];
    expect(quality.overlap(outbound, returned)).toBeGreaterThan(0.9);
  });

  it('excludes a multi-segment short shared start/end stem', () => {
    const stem = [[0, 0], [0.0003, 0], [0.0006, 0]];
    const route = [
      ...stem,
      [0.003, 0.003], [0, 0.006], [-0.003, 0.003],
      [0.0006, 0], [0.0003, 0], [0, 0],
    ];
    const result = quality.assess(route);
    expect(result.sharedStemMeters).toBeGreaterThan(80);
    expect(result.repeatedRoadRatio).toBeLessThan(0.15);
  });

  it('ignores adjacent segments and closure while remaining linear on long geometry', () => {
    const points = Array.from({ length: 20_000 }, (_, index) => {
      const angle = index * 2 * Math.PI / 19_999;
      return [Math.cos(angle) * 0.02, Math.sin(angle) * 0.02];
    });
    const started = Date.now();
    const result = quality.assess(points);
    expect(result.repeatedRoadRatio).toBeLessThan(0.1);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
