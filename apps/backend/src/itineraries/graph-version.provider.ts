import { Injectable, Logger } from '@nestjs/common';
import { GraphHopperClient } from '../routing/graphhopper.client';

/**
 * Namespace for the directed route-cost cache derived from GraphHopper graph
 * identity (design D5, plan M2).
 *
 * The cache must never let a cost produced against one graph import be served
 * after a PBF re-import or a custom-model/graphhopper upgrade. GraphHopper
 * `/info` exposes the graphhopper version and the graph bbox (which changes
 * when the imported region changes) but not an import timestamp, so the
 * namespace combines both. When `/info` is unavailable the provider returns a
 * conservative explicit fallback that can never be mistaken for a verified
 * graph identity: `unverified-graph`.
 *
 * The namespace is memoized for a short TTL so repeated pair lookups in one
 * optimization run do not re-query `/info`.
 */
@Injectable()
export class GraphVersionProvider {
  private readonly logger = new Logger(GraphVersionProvider.name);
  private memo: Promise<string> | null = null;
  private memoAt = 0;

  constructor(private readonly graphHopper: GraphHopperClient) {}

  /** Current cache namespace. Memoized for NAMESPACE_TTL_MS. */
  async namespace(): Promise<string> {
    const now = Date.now();
    if (this.memo && now - this.memoAt < NAMESPACE_TTL_MS) return this.memo;
    this.memo = this.fetchNamespace();
    this.memoAt = now;
    return this.memo;
  }

  private async fetchNamespace(): Promise<string> {
    try {
      const meta = await this.graphHopper.graphMetadata();
      if (!meta.version) return FALLBACK_NAMESPACE;
      const bboxKey = meta.bbox && meta.bbox.length === 4
        ? meta.bbox.map((v) => v.toFixed(3)).join(',')
        : 'no-bbox';
      return `gh-${meta.version}-${bboxKey}`;
    } catch (err: any) {
      this.logger.debug(`Graph version namespace unavailable: ${err?.message ?? err}`);
      return FALLBACK_NAMESPACE;
    }
  }
}

const NAMESPACE_TTL_MS = 5 * 60_000;
/** Conservative namespace when GraphHopper metadata cannot be verified. */
export const FALLBACK_NAMESPACE = 'unverified-graph';
