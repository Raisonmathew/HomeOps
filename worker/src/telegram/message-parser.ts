import { TelegramUpdate } from '../types/telegram';

/** Maximum number of issue photos allowed per request (spec §18.4). */
export const MAX_ISSUE_PHOTOS = 3;

export interface ParsedUpdate {
  userId: number;
  chatId: number;
  firstName: string;
  lastName?: string;
  username?: string;
  isCallback: boolean;
  callbackData?: string;
  callbackQueryId?: string;
  /** For callbacks: the bot message the button was on (lets us edit it in place) */
  messageId?: number;
  text?: string;
  command?: string;
  commandArgs?: string;
  location?: { latitude: number; longitude: number };
  /** userId is set by Telegram only when the contact belongs to a Telegram account */
  contact?: { phoneNumber: string; firstName: string; userId?: number };
  /** file_id of the largest photo variant (for sending/displaying) */
  photoFileId?: string;
  /** file_unique_id — stable across bot tokens, used for de-duplication (spec §18.4) */
  photoFileUniqueId?: string;
  photoFileSize?: number;
  /** A non-photo media message (document, video, voice...) that flows should reject */
  otherMedia?: boolean;
}

export function parseTelegramUpdate(update: TelegramUpdate): ParsedUpdate | null {
  if (update.callback_query) {
    const cb = update.callback_query;
    return {
      userId: cb.from.id,
      chatId: cb.message?.chat.id || cb.from.id,
      firstName: cb.from.first_name,
      lastName: cb.from.last_name,
      username: cb.from.username,
      isCallback: true,
      callbackData: cb.data,
      callbackQueryId: cb.id,
      messageId: cb.message?.message_id,
    };
  }

  if (update.message) {
    const msg = update.message;
    const from = msg.from;
    if (!from) return null;

    let command: string | undefined;
    let commandArgs: string | undefined;

    if (msg.text && msg.text.startsWith('/')) {
      const parts = msg.text.trim().split(/\s+/);
      command = parts[0].toLowerCase();
      commandArgs = parts.slice(1).join(' ');
    }

    // Telegram sends one Photo message per image; each message has multiple size
    // variants — always take the last (largest).  Also capture file_unique_id so
    // we can de-duplicate and store it per spec §18.4 (#22).
    const largestPhoto =
      msg.photo && msg.photo.length > 0
        ? msg.photo[msg.photo.length - 1]
        : undefined;

    return {
      userId: from.id,
      chatId: msg.chat.id,
      firstName: from.first_name,
      lastName: from.last_name,
      username: from.username,
      isCallback: false,
      text: msg.text,
      command,
      commandArgs,
      location: msg.location
        ? { latitude: msg.location.latitude, longitude: msg.location.longitude }
        : undefined,
      contact: msg.contact
        ? { phoneNumber: msg.contact.phone_number, firstName: msg.contact.first_name, userId: msg.contact.user_id }
        : undefined,
      photoFileId: largestPhoto?.file_id,
      photoFileUniqueId: largestPhoto?.file_unique_id,
      photoFileSize: largestPhoto?.file_size,
      otherMedia: !!((msg as any).document || (msg as any).video || (msg as any).voice || (msg as any).audio || (msg as any).sticker),
    };
  }

  return null;
}
