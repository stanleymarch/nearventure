import { Injectable, Logger } from '@nestjs/common';
import type { OptimizationRunCounters } from './optimization-run-budget';

export interface SelectionDiagnosticsPayload {
  isochronePois: number;
  placesAfterClustering: number;
  graphHopperRequests: number;
  cacheHits: number;
  cacheMisses: number;
  searchIterations: number;
  finalValidationRebuilds: number;
  /** How many materially different alternatives were returned (0..2). */
  alternativesReturned?: number;
  exclusionReasons: Record<string, number>;
  deadlineExceeded: boolean;
  returnedBestConfirmed: boolean;
  graphVersion?: string;
  modelVersion?: string;
  selectedUniquePois: number;
  selectedPlaces: number;
  maxAutomaticExcursionMinutes: number | null;
}

/** Denylist of patterns that must never appear in a serialized diagnostics payload.
 *  Uses key-level checks (not substring) to avoid false positives like
 *  "iso*lat*ed" matching a naive /lat/ pattern. */
const COORDINATE_PATTERN = /-?\d{1,3}\.\d{4,}/;
const PII_KEY_PATTERNS = [
  /"(?:lat|lon|lng|latitude|longitude)"\s*:/i,
  /"(?:owner|client|user|token|email|phone|name|coord|address)"\s*:/i,
  /"(?:poiId|placeName|poiName)"\s*:/i,
];

/**
 * Aggregate, no-PII structured logger for automatic-selection diagnostics (M4).
 *
 * Emits one aggregate record per optimize() run containing only operational
 * counts and outcome flags. Coordinates, owner identifiers, POI ids and names
 * are never logged.
 */
@Injectable()
export class SelectionDiagnosticsLogger {
  private readonly logger = new Logger('SelectionDiagnostics');

  log(payload: SelectionDiagnosticsPayload): void {
    const serialized = JSON.stringify(payload);
    // Hard assertion: the serialized payload must not contain coordinates or PII keys.
    if (COORDINATE_PATTERN.test(serialized) || PII_KEY_PATTERNS.some((p) => p.test(serialized))) {
      this.logger.error('SelectionDiagnostics payload failed PII scan and was NOT logged.');
      return;
    }
    this.logger.log(`aggregate: ${serialized}`);
  }

  /** Verify a payload is PII-free without logging it (for unit tests). */
  isPIIFree(payload: SelectionDiagnosticsPayload): boolean {
    const serialized = JSON.stringify(payload);
    if (COORDINATE_PATTERN.test(serialized)) return false;
    return !PII_KEY_PATTERNS.some((pattern) => pattern.test(serialized));
  }

  /** Build payload from run counters + known facts. */
  static buildPayload(counters: OptimizationRunCounters, extra: Pick<SelectionDiagnosticsPayload, 'selectedUniquePois' | 'selectedPlaces' | 'maxAutomaticExcursionMinutes' | 'graphVersion' | 'modelVersion'>): SelectionDiagnosticsPayload {
    return {
      isochronePois: counters.isochronePois,
      placesAfterClustering: counters.placesAfterClustering,
      graphHopperRequests: counters.graphHopperRequests,
      cacheHits: counters.cacheHits,
      cacheMisses: counters.cacheMisses,
      searchIterations: counters.searchIterations,
      finalValidationRebuilds: counters.finalValidationRebuilds,
      alternativesReturned: counters.alternativesReturned,
      exclusionReasons: { ...counters.exclusionReasons },
      deadlineExceeded: counters.deadlineExceeded,
      returnedBestConfirmed: counters.returnedBestConfirmed,
      selectedUniquePois: extra.selectedUniquePois,
      selectedPlaces: extra.selectedPlaces,
      maxAutomaticExcursionMinutes: extra.maxAutomaticExcursionMinutes,
      graphVersion: extra.graphVersion,
      modelVersion: extra.modelVersion,
    };
  }
}
