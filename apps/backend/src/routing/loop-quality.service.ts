import { Injectable } from '@nestjs/common';

export interface LoopQuality {
  closureGapMeters: number;
  repeatedRoadRatio: number;
  outAndBackRatio: number;
  sharedStemMeters: number;
  warnings: string[];
}

type Coord = number[];
type NormalizedSegment = { a: Point; b: Point; midpoint: Point; length: number; direction: number };
type Point = { x: number; y: number };
type GridEntry = { index: number; segment: NormalizedSegment };

/** Length-weighted loop metrics over normalized ~20m road pieces. A spatial
 * grid makes matching linear in geometry size and insensitive to how the
 * original LineString was segmented. */
@Injectable()
export class LoopQualityService {
  private static readonly SAMPLE_METERS = 20;
  private static readonly GRID_METERS = 30;
  private static readonly DIRECTION_BINS = 18;
  private static readonly MAX_SHARED_STEM_METERS = 120;

  assess(coords: Coord[]): LoopQuality {
    const closureGapMeters = coords.length > 1 ? this.distance(coords[0], coords[coords.length - 1]) : 0;
    const segments = this.normalize(coords);
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    const stem = this.sharedStem(segments);
    const excluded = new Set<number>();
    for (let i = 0; i < stem.count; i++) {
      excluded.add(i);
      excluded.add(segments.length - 1 - i);
    }

    const grid = new Map<string, GridEntry>();
    let repeated = 0;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!excluded.has(i) && this.hasNonAdjacentMatch(grid, segment, i)) {
        // Count both traversals of the repeated road, not just the later copy.
        repeated += segment.length * 2;
      }
      this.addToGrid(grid, segment, i);
    }

    const repeatedRoadRatio = total ? Math.min(1, repeated / total) : 0;
    return {
      closureGapMeters,
      repeatedRoadRatio,
      outAndBackRatio: repeatedRoadRatio,
      sharedStemMeters: stem.meters * 2,
      warnings: repeatedRoadRatio >= 0.6 ? ['UNAVOIDABLE_OUT_AND_BACK'] : [],
    };
  }

  /** Fraction of candidate length that follows a road in reference. */
  overlap(reference: Coord[], candidate: Coord[]): number {
    const left = this.normalize(reference);
    const right = this.normalize(candidate);
    const grid = new Map<string, GridEntry>();
    left.forEach((segment, index) => this.addToGrid(grid, segment, index));
    const total = right.reduce((sum, segment) => sum + segment.length, 0);
    if (!total) return 0;
    const repeated = right.reduce(
      (sum, segment) => sum + (this.hasMatch(grid, segment) ? segment.length : 0),
      0,
    );
    return Math.min(1, repeated / total);
  }

  private normalize(coords: Coord[]): NormalizedSegment[] {
    if (coords.length < 2) return [];
    const originLat = coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
    const cosLat = Math.cos(originLat * Math.PI / 180);
    const points = coords.map(([lon, lat]) => ({ x: lon * 111_320 * cosLat, y: lat * 111_320 }));
    const sampled: Point[] = [points[0]];
    let carried = 0;
    let cursor = points[0];
    for (let i = 1; i < points.length; i++) {
      const target = points[i];
      let remaining = Math.hypot(target.x - cursor.x, target.y - cursor.y);
      if (remaining === 0) continue;
      while (carried + remaining >= LoopQualityService.SAMPLE_METERS) {
        const needed = LoopQualityService.SAMPLE_METERS - carried;
        const ratio = needed / remaining;
        cursor = {
          x: cursor.x + (target.x - cursor.x) * ratio,
          y: cursor.y + (target.y - cursor.y) * ratio,
        };
        sampled.push(cursor);
        carried = 0;
        remaining = Math.hypot(target.x - cursor.x, target.y - cursor.y);
      }
      carried += remaining;
      cursor = target;
    }
    const last = points[points.length - 1];
    const sampledLast = sampled[sampled.length - 1];
    if (Math.hypot(last.x - sampledLast.x, last.y - sampledLast.y) > 0.5) sampled.push(last);

    const result: NormalizedSegment[] = [];
    for (let i = 0; i + 1 < sampled.length; i++) {
      const a = sampled[i];
      const b = sampled[i + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      let direction = Math.atan2(b.y - a.y, b.x - a.x) % Math.PI;
      if (direction < 0) direction += Math.PI;
      result.push({
        a,
        b,
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        length,
        direction,
      });
    }
    return result;
  }

  private sharedStem(segments: NormalizedSegment[]): { count: number; meters: number } {
    let count = 0;
    let meters = 0;
    const maxPairs = Math.floor(segments.length / 2);
    while (count < maxPairs) {
      const first = segments[count];
      const last = segments[segments.length - 1 - count];
      if (!this.samePiece(first, last)) break;
      const next = Math.min(first.length, last.length);
      if (meters + next > LoopQualityService.MAX_SHARED_STEM_METERS) break;
      meters += next;
      count++;
    }
    return { count, meters };
  }

  private samePiece(a: NormalizedSegment, b: NormalizedSegment): boolean {
    return Math.hypot(a.midpoint.x - b.midpoint.x, a.midpoint.y - b.midpoint.y) <= LoopQualityService.GRID_METERS
      && this.directionDifference(a.direction, b.direction) <= Math.PI / LoopQualityService.DIRECTION_BINS;
  }

  private hasNonAdjacentMatch(grid: Map<string, GridEntry>, segment: NormalizedSegment, index: number): boolean {
    for (const key of this.nearbyKeys(segment)) {
      const previous = grid.get(key);
      if (previous && previous.index <= index - 2 && this.samePiece(previous.segment, segment)) return true;
    }
    return false;
  }

  private hasMatch(grid: Map<string, GridEntry>, segment: NormalizedSegment): boolean {
    return this.nearbyKeys(segment).some((key) => {
      const entry = grid.get(key);
      return Boolean(entry && this.samePiece(entry.segment, segment));
    });
  }

  private addToGrid(grid: Map<string, GridEntry>, segment: NormalizedSegment, index: number): void {
    const key = this.key(segment.midpoint.x, segment.midpoint.y, this.directionBin(segment.direction));
    const existing = grid.get(key);
    if (existing === undefined || index < existing.index) grid.set(key, { index, segment });
  }

  private nearbyKeys(segment: NormalizedSegment): string[] {
    const cellX = Math.floor(segment.midpoint.x / LoopQualityService.GRID_METERS);
    const cellY = Math.floor(segment.midpoint.y / LoopQualityService.GRID_METERS);
    const bin = this.directionBin(segment.direction);
    const keys: string[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let db = -1; db <= 1; db++) {
          const wrapped = (bin + db + LoopQualityService.DIRECTION_BINS) % LoopQualityService.DIRECTION_BINS;
          keys.push(`${cellX + dx}:${cellY + dy}:${wrapped}`);
        }
      }
    }
    return keys;
  }

  private directionBin(direction: number): number {
    return Math.floor(direction / Math.PI * LoopQualityService.DIRECTION_BINS) % LoopQualityService.DIRECTION_BINS;
  }

  private directionDifference(a: number, b: number): number {
    const difference = Math.abs(a - b);
    return Math.min(difference, Math.PI - difference);
  }

  private key(x: number, y: number, direction: number): string {
    return `${Math.floor(x / LoopQualityService.GRID_METERS)}:${Math.floor(y / LoopQualityService.GRID_METERS)}:${direction}`;
  }

  private distance(a: Coord, b: Coord): number {
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const dLat = lat2 - lat1;
    const dLon = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
}
