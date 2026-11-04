import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';

export const TechnicianNotifications = {
  async notifyAssignmentWon(
    messageSender: MessageSender,
    chatId: number,
    assignmentDetails: {
      requestId: string;
      requestNumber: string;
      customerName: string;
      customerPhone?: string | null;
      customerUsername?: string | null;
      customerTelegramUserId?: number | null;
      serviceAddress?: string | null;
      serviceLat: number;
      serviceLon: number;
      description?: string | null;
    }
  ): Promise<boolean> {
    const mapUrl = `https://www.google.com/maps/search/?api=1&query=${assignmentDetails.serviceLat},${assignmentDetails.serviceLon}`;

    // Contact fallback priority (Spec v1.1 Section 18.2):
    // 1. Phone link (tel:)
    // 2. Telegram username (https://t.me/username)
    // 3. User ID mention link
    // 4. Bot-mediated relay
    let contactInfo = '💬 _Direct messaging enabled in this chat (Bot Relay)_';

    if (assignmentDetails.customerPhone) {
      contactInfo = `📞 [${assignmentDetails.customerPhone}](tel:${assignmentDetails.customerPhone})`;
    } else if (assignmentDetails.customerUsername) {
      contactInfo = `✈️ [@${assignmentDetails.customerUsername}](https://t.me/${assignmentDetails.customerUsername})`;
    } else if (assignmentDetails.customerTelegramUserId) {
      contactInfo = `👤 [Customer Profile](tg://user?id=${assignmentDetails.customerTelegramUserId})`;
    }

    const text =
      `🎯 *Assignment Confirmed! (${assignmentDetails.requestNumber})*\n\n` +
      `👤 *Customer:* ${assignmentDetails.customerName}\n` +
      `📱 *Contact:* ${contactInfo}\n` +
      `📍 *Exact Address:* ${assignmentDetails.serviceAddress || 'Coordinates on Map'}\n` +
      `📝 *Issue Details:* ${assignmentDetails.description || 'No description'}\n` +
      `🗺 *Map Navigation:* [Open in Google Maps](${mapUrl})\n\n` +
      `Please contact the customer promptly to agree on visiting charges and schedule.`;

    return messageSender.sendMessage({
      chatId,
      text,
      replyMarkup: KeyboardBuilder.technicianJobStatusButtons(assignmentDetails.requestId),
    });
  },

  async notifyOfferLost(
    messageSender: MessageSender,
    chatId: number
  ): Promise<boolean> {
    const text = `ℹ️ _This request has been accepted by another technician._`;
    return messageSender.sendMessage({
      chatId,
      text,
    });
  },
};
