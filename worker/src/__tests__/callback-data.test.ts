import { describe, it, expect } from 'vitest';
import { KeyboardBuilder } from '../telegram/keyboard-builder';
import { InlineKeyboardMarkup } from '../types/telegram';

// Telegram rejects the WHOLE message if any button's callback_data exceeds 64 bytes,
// which silently broke issue selection and offer delivery before.
const UUID = '123e4567-e89b-12d3-a456-426614174000';
const bytes = (s: string) => new TextEncoder().encode(s).length;
const allData = (k: InlineKeyboardMarkup) => k.inline_keyboard.flat().map((b) => b.callback_data ?? '');

describe('callback_data stays within Telegram 64-byte limit', () => {
  it('KeyboardBuilder keyboards', () => {
    const keyboards = [
      KeyboardBuilder.offerActionButtons(UUID),
      KeyboardBuilder.customerConfirmCompletion(UUID),
      KeyboardBuilder.cancelRequestButton(UUID),
      KeyboardBuilder.ratingButtons(UUID),
      ...(['ASSIGNED', 'CONTACTED', 'DISCUSSING_SCOPE', 'AGREED', 'IN_PROGRESS'] as const).map((s) =>
        KeyboardBuilder.technicianJobStatusButtons(UUID, s)
      ),
    ];
    for (const data of keyboards.flatMap(allData)) expect(bytes(data), data).toBeLessThanOrEqual(64);
  });

  it('callbacks built inline in the flows', () => {
    const inline = [
      `cat:${UUID}`,
      `iss:${UUID}`,
      `addr_use:${UUID}`,
      `addr_del:${UUID}`,
      `req_cancel_yes:${UUID}`,
      `est_dispute:${UUID}`,
      `tech_skill:${UUID}`,
      `job:CANCEL_YES:${UUID}`,
      `rskip:${UUID}`,
      `rtag:5:${UUID}`,
      `rcomment:${UUID}`,
      `req_reassign_yes:${UUID}`,
      `pay:DISPUTE:${UUID}`,
      `creason:FOUND_OTHER:${UUID}`,
      `jreason:4:${UUID}`,
      `ureason:3:${UUID}`,
      `req_opcancel:${UUID}`,
      `req_nocontact:${UUID}`,
      `prob:${UUID}`,
      `repc:3:${UUID}`,
      `safety_share:${UUID}`,
      `safety_alert:${UUID}`,
      `relay_block:${UUID}`,
    ];
    for (const data of inline) expect(bytes(data), data).toBeLessThanOrEqual(64);
  });
});
