import {
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from '../types/telegram';

export class MessageSender {
  private botToken: string;
  private baseUrl: string;

  constructor(botToken: string) {
    this.botToken = botToken;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  async sendMessage(params: {
    chatId: number;
    text: string;
    parseMode?: 'Markdown' | 'HTML';
    replyMarkup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove;
  }): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          parse_mode: params.parseMode || 'Markdown',
          reply_markup: params.replyMarkup,
        }),
      });
      if (!response.ok) {
        // e.g. 401 bad bot token, 400 Markdown parse error, 403 user blocked the bot
        console.error(`Telegram sendMessage failed (${response.status}):`, await response.text());
      }
      return response.ok;
    } catch (err) {
      console.error('Failed to send Telegram message:', err);
      return false;
    }
  }

  /**
   * Downloads a file the user sent. Telegram download URLs contain the bot token and expire,
   * so the URL is used once here and never stored (spec §18.4).
   */
  async downloadFile(fileId: string): Promise<ArrayBuffer | null> {
    const meta = (await (await fetch(`${this.baseUrl}/getFile?file_id=${encodeURIComponent(fileId)}`)).json()) as any;
    if (!meta.ok || !meta.result?.file_path) {
      console.error('Telegram getFile failed:', meta.description);
      return null;
    }
    const res = await fetch(`https://api.telegram.org/file/bot${this.botToken}/${meta.result.file_path}`);
    return res.ok ? res.arrayBuffer() : null;
  }

  /** Re-sends a photo by Telegram file_id (photos stay on Telegram, spec §18.4). */
  async sendPhoto(chatId: number, fileId: string, caption?: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: fileId, caption }),
    });
    if (!response.ok) console.error(`Telegram sendPhoto failed (${response.status}):`, await response.text());
    return response.ok;
  }

  /** Replaces the inline keyboard of a message the bot already sent. */
  async editReplyMarkup(chatId: number, messageId: number, replyMarkup: InlineKeyboardMarkup): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup }),
    });
    if (!response.ok) console.error(`Telegram editMessageReplyMarkup failed (${response.status}):`, await response.text());
    return response.ok;
  }

  async answerCallbackQuery(params: {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
  }): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: params.callbackQueryId,
          text: params.text,
          show_alert: params.showAlert,
        }),
      });
      return response.ok;
    } catch (err) {
      console.error('Failed to answer Telegram callback query:', err);
      return false;
    }
  }
}
