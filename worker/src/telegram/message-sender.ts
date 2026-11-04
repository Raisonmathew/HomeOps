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
      return response.ok;
    } catch (err) {
      console.error('Failed to send Telegram message:', err);
      return false;
    }
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
