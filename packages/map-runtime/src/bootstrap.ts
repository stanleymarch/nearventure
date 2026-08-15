/* PMTiles protocol registration — call once at app startup. */
import { addProtocol } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

let registered = false;

/** Register the PMTiles protocol handler for MapLibre.
 *  Safe to call multiple times — only registers once. */
export function registerPmtilesProtocol(): void {
  if (registered) return;
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
  registered = true;
}
