# Live GraphHopper routing corpus

The built-in default is `apps/backend/src/routing/fixtures/live-routing-corpus.pfo.json`.
It is a checked-in **test-only** corpus for the repository's normal local
GraphHopper graph (`pfo-latest.osm.pbf`). Its Kirov points are not application
data, do not create an itinerary, and do not constrain the product's runtime
geography.

The default corpus runs one valid direct route for every current product profile
advertised by the local config (`car`, `bike`, `bike_touring`, `mtb`,
`mtb_leisure`, `foot`, and `foot_scenic`), plus a seeded bike round trip and a
walking isochrone. Its expectations are stable invariants and configurable
per-scenario latency limits, rather than captured route geometry. The suite
uses `/info` as the only source of advertised profiles: a fixture profile that
is not advertised is skipped and reported as such; an advertised fixture
profile that cannot route fails.

`apps/backend/src/routing/fixtures/live-routing-corpus.example.json` remains a
generic non-PFO example/custom-corpus template. Copy it when auditing another
local graph; it is not the normal PFO baseline.

## Run it explicitly

The suite is skipped unless `GRAPHHOPPER_LIVE=1` is set. It refuses non-loopback
`GRAPHHOPPER_URL` values before making a request, so it cannot be pointed at a
production GraphHopper endpoint.

```bash
GRAPHHOPPER_LIVE=1 npm run test:routing:live --workspace=apps/backend
```

PowerShell:

```powershell
$env:GRAPHHOPPER_LIVE='1'; npm run test:routing:live --workspace=apps/backend
```

The suite first loads the corpus and queries `/info`. A fixture/profile pair is
reported as a Vitest skip only if that profile is not advertised there. If an
advertised profile cannot route its fixture, the test fails. A missing corpus,
non-loopback URL, missing `/info` endpoint, or any other setup failure also
fails and is recorded in both `LIVE_ROUTING_CORPUS` JSON and the human summary
as `setup-failed`; it is never printed as a zero-failure success.

Each enabled run writes two concise log lines: `LIVE_ROUTING_CORPUS` followed by
JSON for CI, then a human summary. They contain only corpus IDs, advertised
profile names, invariant metrics, status, and error summaries—never tokens,
init data, or raw GraphHopper responses.

## Custom corpus

Set `GRAPHHOPPER_LIVE_CORPUS` to an **absolute** path to a JSON file. The default
is resolved internally relative to the test module, not relative to the shell's
current working directory. The parser requires `version: 1`, named WGS84
`points`, and scenarios with unique IDs. Supported scenario kinds are:

- `point-to-point`: `start`, `finish`, profiles, distance/duration/latency bounds;
- `round-trip`: `start`, fixed `distanceMeters` and `seed`, closure and overlap
  class (`clean`, `out-and-back`, or `any`) bounds;
- `isochrone`: `point`, time limit, and latency bound.

All scenarios require `networkConfirmed: true`. Routes must have valid
LineString geometry and finite positive distance/duration. Round trips also use
the existing geometry-derived loop-quality service. Isochrones must be actual,
non-degenerate GraphHopper polygons; a local fallback circle is deliberately not
accepted as network confirmation. `roadFacts.configuredOnly: true` verifies that
any optional road facts are returned only from configured
`GRAPHHOPPER_PATH_DETAILS` keys; absent details remain valid.

Latency is bounded per fixture in `expect.maxLatencyMs` to suit the developer's
machine and graph. Adjust only a copied local corpus when its graph coverage or
capacity differs; keep checked-in fixtures declarative and deterministic.
