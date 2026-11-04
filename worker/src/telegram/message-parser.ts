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
  text?: string;
  command?: string;
  commandArgs?: string;
  location?: { latitude: number; longitude: number };
  contact?: { phoneNumber: string; firstName: string };
  /** file_id of the largest photo variant (for sending/displaying) */
  photoFileId?: string;
  /** file_unique_id — stable across bot tokens, used for de-duplication (spec §18.4) */
  photoFileUniqueId?: string;
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
        ? { phoneNumber: msg.contact.phone_number, firstName: msg.contact.first_name }
        : undefined,
      photoFileId: largestPhoto?.file_id,
      photoFileUniqueId: largestPhoto?.file_unique_id,
    };
  }

  return null;
}
