import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Api, InputFile } from 'grammy';
import { InlineKeyboardMarkup, InlineKeyboardButton } from '@grammyjs/types';
import { PoisService, PoiRow } from '../pois/pois.service';
import { PoiMediaCacheEntity } from './entities/poi-media-cache.entity';
import { CATEGORIES, esc, keyboard } from './keyboards';
import { hashImageUrl } from './media-hash';

/** Telegram-side heritage wording (the web/miniapp have their own maps). */
const HERITAGE_LABELS_TG: Record<string, string> = {
  federal: 'Памятник архитектуры федерального значения',
  regional: 'Памятник архитектуры регионального значения',
  local: 'Памятник архитектуры местного значения',
};

/** Approximate bounding box of Kirov Oblast (Кировская область). */

const ROMAN_C = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];

/** Human construction date from the optional year range (collector pipeline). */
function centuryLabel(year: number | null, yearEnd?: number | null): string | null {
  if (!year) return null;
  const end = yearEnd && yearEnd > year ? yearEnd : null;
  const roman = (y: number) => {
    const c = Math.max(1, Math.floor((y - 1) / 100) + 1);
    return ROMAN_C[c] ?? String(c);
  };
  if (end) {
    if (end - year >= 80) {
      const a = roman(year), b = roman(end);
      return a === b ? `${a} в.` : `${a}–${b} вв.`;
    }
    return `${year}–${end} гг.`;
  }
  return year < 1950 ? `${roman(year)} в.` : `${year} г.`;
}

/** One-line admin location (city, district, region) with duplicates dropped. */
function locationLine(region?: string | null, district?: string | null, city?: string | null): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const p of [city, district, region]) {
    if (!p) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    parts.push(p);
  }
  return parts.length ? parts.join(', ') : null;
}

/** Caption payload from a POI, HTML-escaped, capped to Telegram's 1024 limit. */
export function poiCardHtml(poi: PoiRow): string {
  const cat = CATEGORIES.find((c) => c.key === poi.category);
  const lines: string[] = [];
  lines.push(`${cat?.emoji ?? '📍'} <b>${esc(poi.name || 'Без названия')}</b>`);
  if (poi.heritageSignificance && HERITAGE_LABELS_TG[poi.heritageSignificance]) {
    lines.push(`<i>${HERITAGE_LABELS_TG[poi.heritageSignificance]}</i>`);
  }
  const built = centuryLabel(poi.year, poi.year_end);
  const loc = locationLine(poi.region, poi.district, poi.city);
  if (built || loc) {
    lines.push(`<i>${[built, loc].filter(Boolean).map(esc).join(' · ')}</i>`);
  }
  if (poi.descRu) {
    lines.push('', esc(truncate(poi.descRu, 620)));
  }
  const foot = attributionFooter(poi);
  if (foot) lines.push('', foot);
  const out = lines.join('\n');
  return out.length > 1024 ? out.slice(0, 1021) + '…' : out;
}

/** Inline keyboard: website / social / "read more" — only the buttons we have. */
export function poiCardKeyboard(poi: PoiRow): InlineKeyboardMarkup {
  const rows: InlineKeyboardButton[][] = [];
  const urlRow: InlineKeyboardButton[] = [];
  if (poi.officialUrl) urlRow.push({ text: '🌐 Сайт', url: poi.officialUrl });
  if (poi.socialUrl) {
    const isVk = /vk\.com|vkontakte/i.test(poi.socialUrl);
    urlRow.push({ text: isVk ? '🔵 ВКонтакте' : '💬 Сообщество', url: poi.socialUrl });
  }
  if (urlRow.length) rows.push(urlRow);
  if (poi.articleUrl) rows.push([{ text: '📖 Подробнее', url: poi.articleUrl }]);
  return keyboard(rows);
}

function attributionFooter(poi: PoiRow): string {
  const parts: string[] = [];
  const ia = poi.imageAttribution;
  if (ia) {
    const who = ia.artist || ia.credit;
    if (who) parts.push(`Фото: ${who}`);
    else if (ia.source) parts.push(`Источник изображения: ${ia.source}`);
    if (ia.license) parts.push(`Лицензия: ${ia.license}`);
    if (ia.notice) parts.push(ia.notice);
  }

  const sourceNotice = poi.imageSourceNotice;
  if (sourceNotice?.source) parts.push(`Источник изображения: ${sourceNotice.source}`);
  if (sourceNotice?.notice) parts.push(`Сведения об источнике: ${sourceNotice.notice}`);

  return parts.length ? `📷 ${parts.map(esc).join(' · ')}` : '';
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

/**
 * Sends a POI detail card (photo + caption + link buttons) to a Telegram chat.
 *
 * Media-id caching: on the first send we upload our JPEG to Telegram and persist
 * the returned file_id in telegram_poi_media. Every later send reuses file_id →
 * no upload, instant delivery. Falls back to a text card if there's no image.
 */
@Injectable()
export class TelegramPoiCardService {
  private readonly logger = new Logger(TelegramPoiCardService.name);

  constructor(
    private readonly pois: PoisService,
    @InjectRepository(PoiMediaCacheEntity)
    private readonly mediaRepo: Repository<PoiMediaCacheEntity>,
  ) {}

  async sendPoiCard(
    api: Api,
    chatId: number,
    poiUuid: string,
    extraButtons?: InlineKeyboardButton[][],
  ): Promise<void> {
    const poi = await this.pois.byId(poiUuid).catch(() => null);
    if (!poi) {
      await api.sendMessage(chatId, 'Объект не найден.').catch(() => {});
      return;
    }

    const caption = poiCardHtml(poi);
    const cardKb = poiCardKeyboard(poi);
    const replyMarkup = extraButtons?.length
      ? keyboard([...cardKb.inline_keyboard, ...extraButtons])
      : cardKb;

    // 1. Cached file_id → validate staleness, then instant resend (no upload).
    //
    //    Staleness rules (cheap checks first, avoid a wasted sendPhoto round-trip):
    //    a) POI's current imageUrl hash differs from what we uploaded from →
    //       drop cache, re-upload (we know the photo changed on our side).
    //    b) Cache lacks image_url_hash (legacy row from before this column) →
    //       treat as stale (we can't verify, so safer to re-upload once).
    //    c) Telegram itself returns a different file_unique_id (rare) → drop
    //       cache. Detected implicitly when sendPhoto throws.
    const cached = await this.mediaRepo
      .findOne({ where: { poi_uuid: poiUuid } })
      .catch(() => null);
    if (cached?.file_id) {
      const currentHash = hashImageUrl(poi.imageUrl);
      const hashMatches =
        cached.image_url_hash != null && cached.image_url_hash === currentHash;

      if (hashMatches) {
        try {
          await api.sendPhoto(chatId, cached.file_id, {
            caption,
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
          });
          return;
        } catch (e: any) {
          // Stale / invalid file_id (Telegram-side rotation) → drop cache and
          // re-upload below. We keep file_unique_id if we had it; the next
          // cache write will overwrite.
          this.logger.warn(
            `cached file_id failed for ${poiUuid}: ${e.message} — re-uploading`,
          );
          await this.mediaRepo.delete({ poi_uuid: poiUuid }).catch(() => {});
        }
      } else {
        this.logger.log(
          `imageUrl hash drift for ${poiUuid} (cached ${cached.image_url_hash} ≠ current ${currentHash}) — re-uploading`,
        );
        await this.mediaRepo.delete({ poi_uuid: poiUuid }).catch(() => {});
      }
    }

    // 2. Upload JPEG from our media proxy, then cache the new file_id.
    const jpeg = await this.pois.getMediaJpegBuffer(poiUuid);
    if (jpeg) {
      try {
        const sent = await api.sendPhoto(chatId, new InputFile(jpeg, `${poiUuid}.jpg`), {
          caption,
          parse_mode: 'HTML',
          reply_markup: replyMarkup,
        });
        const sizes = (sent as any).photo as any[] | undefined;
        const fileId = sizes?.[sizes.length - 1]?.file_id;
        const fileUniqueId = sizes?.[sizes.length - 1]?.file_unique_id ?? null;
        if (fileId) {
          await this.upsertCache(poiUuid, {
            file_id: fileId,
            file_unique_id: fileUniqueId,
            image_url_hash: hashImageUrl(poi.imageUrl),
            image_url: poi.imageUrl,
          });
        }
        return;
      } catch (e: any) {
        this.logger.warn(`sendPhoto upload failed for ${poiUuid}: ${e.message}`);
      }
    }

    // 3. No image (or upload failed) → text card.
    await api
      .sendMessage(chatId, caption, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        link_preview_options: { is_disabled: true },
      })
      .catch(() => {});
  }

  private async upsertCache(
    poiUuid: string,
    fields: {
      file_id: string;
      file_unique_id: string | null;
      image_url_hash: string;
      image_url: string | null;
    },
  ): Promise<void> {
    try {
      const existing = await this.mediaRepo.findOne({ where: { poi_uuid: poiUuid } });
      if (existing) {
        existing.file_id = fields.file_id;
        existing.file_unique_id = fields.file_unique_id;
        existing.image_url_hash = fields.image_url_hash;
        existing.image_url = fields.image_url;
        await this.mediaRepo.save(existing);
      } else {
        await this.mediaRepo.insert({
          poi_uuid: poiUuid,
          file_id: fields.file_id,
          file_unique_id: fields.file_unique_id,
          image_url_hash: fields.image_url_hash,
          image_url: fields.image_url,
        });
      }
    } catch (e: any) {
      this.logger.warn(`failed to cache file_id for ${poiUuid}: ${e.message}`);
    }
  }

  /**
   * Diagnostic: surface the cache state for a single POI. Used by the test
   * suite and (eventually) by the admin panel.
   */
  async describeCache(poiUuid: string): Promise<{
    cached: boolean;
    file_id?: string;
    file_unique_id?: string | null;
    image_url_hash?: string | null;
    image_url?: string | null;
    current_url_hash: string;
  }> {
    const row = await this.mediaRepo.findOne({ where: { poi_uuid: poiUuid } });
    const current = await this.pois.byId(poiUuid).catch(() => null);
    return {
      cached: !!row,
      file_id: row?.file_id,
      file_unique_id: row?.file_unique_id,
      image_url_hash: row?.image_url_hash,
      image_url: row?.image_url,
      current_url_hash: hashImageUrl(current?.imageUrl),
    };
  }
}
