/**
 * Single ordered registry of backend migrations.
 *
 * Both the manual migration CLI (src/database/cli/migrate.ts) and the
 * DatabaseModule register migrations from this one source of truth, so the
 * applied chain can never drift between the CLI and app boot paths.
 * Order matters: TypeORM executes pending migrations in the order listed.
 */
import { RoutePoisJsonb1731000000000 } from './migrations/1731000000000-RoutePoisJsonb';
import { ImageAttributionKeys1731000000001 } from './migrations/1731000000001-ImageAttributionKeys';
import { AddPoiUrlColumns1731000000002 } from './migrations/1731000000002-AddPoiUrlColumns';
import { AddWikidataUrl1731000000003 } from './migrations/1731000000003-AddWikidataUrl';
import { CreateItineraryDraft1744650000000 } from './migrations/1744650000000-CreateItineraryDraft';
import { AddEgrknRegNumber1744650000001 } from './migrations/1744650000001-AddEgrknRegNumber';
import { AddRouteLoop1744650000002 } from './migrations/1744650000002-AddRouteLoop';
import { CreateRuntimeFoundation1786340733385 } from './migrations/1786340733385-CreateRuntimeFoundation';
import { RetireOsmSyncState1786341200000 } from './migrations/1786341200000-RetireOsmSyncState';

export const MIGRATIONS = [
  RoutePoisJsonb1731000000000,
  ImageAttributionKeys1731000000001,
  AddPoiUrlColumns1731000000002,
  AddWikidataUrl1731000000003,
  CreateItineraryDraft1744650000000,
  AddEgrknRegNumber1744650000001,
  AddRouteLoop1744650000002,
  CreateRuntimeFoundation1786340733385,
  RetireOsmSyncState1786341200000,
];
