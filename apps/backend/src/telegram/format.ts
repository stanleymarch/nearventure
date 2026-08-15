import { BuiltRoute } from './route-builder.service';
import { esc, CATEGORIES } from './keyboards';

/** Distance m → "12,4 км" / "850 м". */
export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',')} км` : `${Math.round(m)} м`;
}

/** Duration s → "1 ч 12 мин" / "45 мин". */
export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

/**
 * Russian plural agreement for "точка/точки/точек". Used by the guide
 * intro and outro where English-like number agreement is jarring.
 * Extracted here so it's testable without spinning up the bot.
 *
 * CLDR rules (ru):
 *  - 1, 21, 31, ... → one ("точка")
 *  - 2-4, 22-24, ... → few ("точки")
 *  - everything else (0, 5-20, 25-30, ...) → many ("точек")
 */
export function pluralPoints(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'точка';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'точки';
  return 'точек';
}

/** Render a built route as the chat summary (Rich-ish text, HTML mode). */
export function routeSummaryHtml(route: BuiltRoute): string {
  const head =
    `🎉 <b>Маршрут готов</b>\n\n` +
    `📏 <b>${esc(fmtDistance(route.distance))}</b>  ·  ⏱ <b>${esc(fmtDuration(route.duration))}</b>\n` +
    `⬆️ набор ${esc(route.ascend.toFixed(0))} м  ·  ⬇️ спуск ${esc(route.descend.toFixed(0))} м\n`;

  // Preserve server-authoritative totals when available (D2/M6).
  const totalsLine = route.totals
    ? `\n⏳ Всего ${Math.round(route.totals.totalMinutes)} мин` +
      (route.totals.stopMinutes > 0 ? ` (дорога ${Math.round(route.totals.travelMinutes)} + остановки ${Math.round(route.totals.stopMinutes)})` : '') +
      '\n'
    : '';

  // SelectionSummary caveats (locality/confidence).
  const summaryLines: string[] = [];
  if (route.selectionSummary?.localityGuardApplied && route.selectionSummary?.unusedBudgetIntentional) {
    summaryLines.push('📍 Маршрут оставлен компактным; часть времени в запасе');
  }
  if (route.selectionSummary?.networkConfidence === 'approximate_isochrone') {
    summaryLines.push('⚠️ Зона приблизительная; места проверяются по дорожной сети');
  } else if (route.selectionSummary?.networkConfidence === 'best_confirmed') {
    summaryLines.push('⚠️ Показан лучший вариант, подтверждённый до истечения времени расчёта');
  }

  // Warning messages (e.g. LOCKED_SET_OVER_BUDGET).
  for (const w of route.warnings ?? []) {
    summaryLines.push(`⚠️ ${esc(w.message)}`);
  }

  const summaryBlock = summaryLines.length > 0 ? '\n' + summaryLines.join('\n') + '\n' : '';

  if (route.pois.length === 0) {
    return (
      head +
      totalsLine +
      summaryBlock +
      `\n<i>Не нашлось мест по пути — попробуйте другие категории или увеличьте время.</i>\n\n` +
      `Скачайте GPX для навигатора — и хорошей прогулки! 🚶`
    );
  }

  const poiList = route.pois
    .map((p, i) => {
      const cat = CATEGORIES.find((c) => c.key === p.category);
      const icon = cat?.emoji ?? '📍';
      return `${i + 1}. ${icon} ${esc(p.name)}`;
    })
    .join('\n');

  return (
    head +
    totalsLine +
    summaryBlock +
    `\n<b>По пути (${route.pois.length}):</b>\n` +
    poiList +
    `\n\n⬇ Скачайте GPX — \"Открыть в приложении\" покажет маршрут на карте. Приятной прогулки!`
  );
}

/** Markdown-mode fallback is intentionally avoided — HTML parse_mode only. */
