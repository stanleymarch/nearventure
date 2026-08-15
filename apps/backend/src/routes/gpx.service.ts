import { Injectable } from '@nestjs/common';

/**
 * GPX 1.1 generator from a route geometry.
 *
 * Based on the telegram-bot `GpxBuilder`, but:
 *  - works from a stored geometry (not a live RouteResult);
 *  - preserves elevation: writes `<ele>` when a coordinate carries a third value
 *    (GraphHopper returns [lon, lat, elevation] when elevation=true);
 *  - flattens MultiLineString into a single trkseg.
 *
 * Output is a GPX 1.1 document string (no external deps).
 */
@Injectable()
export class GpxService {
  /**
   * @param geometry GeoJSON geometry: a LineString or MultiLineString (the
   *   `geometry` field of the Feature stored in routeData.geojson).
   * @param title Optional route name (metadata + track name).
   */
  generate(
    geometry: { type: string; coordinates: number[][] | number[][][] } | null,
    title?: string,
  ): string {
    const name = this.escape(title) || 'Nearventure Route';
    const now = new Date().toISOString();

    const pts = this.flattenCoordinates(geometry);
    const { minLon, minLat, maxLon, maxLat } = this.bounds(pts);

    const trackPoints = pts
      .map((c) => {
        const lon = c[0];
        const lat = c[1];
        const ele = c[2];
        const eleTag =
          typeof ele === 'number' && Number.isFinite(ele)
            ? `\n        <ele>${ele.toFixed(1)}</ele>`
            : '';
        return `      <trkpt lat="${lat}" lon="${lon}">${eleTag}</trkpt>`;
      })
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Nearventure" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${now}</time>
    <bounds minlat="${minLat}" minlon="${minLon}" maxlat="${maxLat}" maxlon="${maxLon}"/>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
  }

  /** Flatten LineString + MultiLineString into a single number[][] of points. */
  private flattenCoordinates(
    geometry: { type: string; coordinates: number[][] | number[][][] } | null,
  ): number[][] {
    if (!geometry || !geometry.coordinates) return [];
    if (geometry.type === 'LineString') {
      return geometry.coordinates as number[][];
    }
    if (geometry.type === 'MultiLineString') {
      return (geometry.coordinates as number[][][]).flat() as number[][];
    }
    // Unknown geometry type — best-effort flatten.
    return (geometry.coordinates as any).flat() as number[][];
  }

  private bounds(pts: number[][]): {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  } {
    if (pts.length === 0) {
      return { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 };
    }
    let minLon = Infinity,
      minLat = Infinity,
      maxLon = -Infinity,
      maxLat = -Infinity;
    for (const [lon, lat] of pts) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    return { minLon, minLat, maxLon, maxLat };
  }

  private escape(s: string | null | undefined): string {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
