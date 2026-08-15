import { describe, it, expect } from 'vitest';
import { copyTextButton, keyboard, wizardEscapeRow } from './keyboards';

/**
 * Tests for the keyboard helpers:
 *  - copyTextButton: produces a Bot API 9.4 inline button with
 *    `text` (label) and `copy_text: { text }` (the actual clipboard payload).
 *  - keyboard: wraps a row layout into the standard markup envelope.
 *  - wizardEscapeRow: the standard 2-button escape row used at the
 *    bottom of every wizard step (Home + Reset).
 */
describe('keyboards', () => {
  describe('copyTextButton', () => {
    it('produces a button with the label as `text` and a copy_text payload', () => {
      const btn = copyTextButton('📋 Скопировать ссылку', 'https://t.me/nearventure_bot');
      expect(btn.text).toBe('📋 Скопировать ссылку');
      // The shape matches the CopyTextButton union member of
      // InlineKeyboardButton. The `as unknown as InlineKeyboardButton`
      // cast in the helper makes the literal `copy_text` field pass the
      // type check — verify at runtime that the field is set as the
      // Telegram API expects.
      expect((btn as any).copy_text).toEqual({ text: 'https://t.me/nearventure_bot' });
    });

    it('preserves up to 256 chars in the copy payload (Telegram limit)', () => {
      const longText = 'x'.repeat(300);
      const btn = copyTextButton('Copy', longText);
      // The helper doesn't enforce the limit (Telegram API will reject
      // payloads over 256 chars). We document this in the type comment
      // and assert that no truncation happens in our helper — the
      // bot's call site is responsible for keeping payloads short.
      expect((btn as any).copy_text.text.length).toBe(300);
    });

    it('handles empty copy text (e.g. for empty state)', () => {
      const btn = copyTextButton('Copy', '');
      expect((btn as any).copy_text.text).toBe('');
    });
  });

  describe('wizardEscapeRow', () => {
    it('returns Home + Reset buttons in one row', () => {
      const row = wizardEscapeRow();
      expect(row).toHaveLength(2);
      expect(row[0].text).toMatch(/меню/);
      expect(row[1].text).toMatch(/Сбросить/);
      // Reset is destructive — should use the danger style for visual cue.
      expect((row[1] as any).style).toBe('danger');
    });
  });

  describe('keyboard()', () => {
    it('wraps rows into inline_keyboard markup', () => {
      const rows = [
        [copyTextButton('A', 'a')],
        [wizardEscapeRow()[0]],
      ];
      const k = keyboard(rows);
      expect(k.inline_keyboard).toEqual(rows);
    });

    it('preserves empty rows (regression: prevents accidental flatten)', () => {
      const k = keyboard([[], [copyTextButton('B', 'b')]]);
      expect(k.inline_keyboard).toHaveLength(2);
      expect(k.inline_keyboard[0]).toHaveLength(0);
    });
  });
});
