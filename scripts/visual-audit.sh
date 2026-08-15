#!/bin/bash
# Visual Audit Tests for PMTiles + Bot UX Deploy
# Run after deploy to verify all features work

echo "=== NEARVENTURE VISUAL AUDIT TESTS ==="
echo ""

# Configuration
BASE_URL="${NEARVENTURE_URL:-http://nearventure.ru}"
BOT_NAME="${TELEGRAM_BOT:-@nearventure_bot}"

echo "Testing against: $BASE_URL"
echo "Bot: $BOT_NAME"
echo ""

# Test 1: Frontend loads
echo "Test 1: Frontend loads"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL")
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Frontend loads (HTTP $HTTP_CODE)"
else
  echo "❌ Frontend not accessible (HTTP $HTTP_CODE)"
fi
echo ""

# Test 2: PMTiles file accessible
echo "Test 2: PMTiles file accessible"
PMTILES_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/tiles/pfo.pmtiles")
if [ "$PMTILES_CODE" = "200" ]; then
  echo "✅ PMTiles file accessible (HTTP $PMTILES_CODE)"
else
  echo "❌ PMTiles file not accessible (HTTP $PMTILES_CODE)"
  echo "Check nginx config: docker exec nearventure-app cat /etc/nginx/conf.d/default.conf | grep -A 5 'location /tiles'"
fi
echo ""

# Test 3: POI API returns data
echo "Test 3: POI API returns data"
POI_COUNT=$(curl -s "$BASE_URL/api/pois?limit=1" | grep -o '"id"' | wc -l)
if [ "$POI_COUNT" -gt 0 ]; then
  echo "✅ POI API returns data (found POIs)"
else
  echo "❌ POI API not returning data"
fi
echo ""

# Test 4: Routes API accessible
echo "Test 4: Routes API accessible"
ROUTES_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/routes")
if [ "$ROUTES_CODE" = "200" ]; then
  echo "✅ Routes API accessible (HTTP $ROUTES_CODE)"
else
  echo "❌ Routes API not accessible (HTTP $ROUTES_CODE)"
fi
echo ""

# Test 5: Frontend bundle contains PMTiles code
echo "Test 5: Frontend bundle contains PMTiles code"
FRONTEND_HTML=$(curl -s "$BASE_URL" | grep -o "pmtiles" | wc -l)
if [ "$FRONTEND_HTML" -gt 0 ]; then
  echo "✅ Frontend contains PMTiles references"
else
  echo "⚠️  Frontend may not include PMTiles (check build)"
fi
echo ""

echo "=== MANUAL VERIFICATION REQUIRED ==="
echo ""
echo "🌐 Map Tests (open $BASE_URL):"
echo "  - [ ] Vector tiles load (F12 Network → pmtiles:// URLs)"
echo "  - [ ] Light theme works"
echo "  - [ ] Dark theme works (toggle: instant switch, no reload)"
echo "  - [ ] POI pins visible (teardrop shape, colored by category)"
echo "  - [ ] POI hover shows popup"
echo "  - [ ] POI click opens details"
echo "  - [ ] Terrain/hillshade (if enabled in controls)"
echo ""
echo "🤖 Bot Tests ($BOT_NAME):"
echo "  - [ ] /start command works"
echo "  - [ ] 'Поблизости' shows inline buttons"
echo "  - [ ] Inline queries: $BOT_NAME Киров shows POIs"
echo "  - [ ] Back button appears in all states"
echo "  - [ ] POI cards show name, category, distance"
echo "  - [ ] Menu items restored (nature, museum, heritage, etc.)"
echo ""
echo "🔍 API Tests:"
echo "  - [ ] GET /api/pois returns list"
echo "  - [ ] POST /api/routes creates route"
echo "  - [ ] POST /api/routing returns GraphHopper path"
echo ""
echo "=== AUTOMATED TESTS SUMMARY ==="
echo "Automated tests: frontend, PMTiles, POI API, routes API"
echo "Manual tests: map themes, bot UX, POI interactions"
echo ""
echo "For full checklist, see: DEPLOY.md → VERIFICATION CHECKLIST"