import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';
import { escapeMd } from '../telegram/format';

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
    // A tg://user link isn't guaranteed to work (privacy settings), so the relay is the fallback (spec §18.2).
    let contactInfo = '💬 Send your messages here in this chat and the bot will forward them.';

    if (assignmentDetails.customerPhone) {
      contactInfo = `📞 [${assignmentDetails.customerPhone}](tel:${assignmentDetails.customerPhone})`;
    } else if (assignmentDetails.customerUsername) {
      contactInfo = `✈️ [@${escapeMd(assignmentDetails.customerUsername)}](https://t.me/${assignmentDetails.customerUsername})`;
    }

    const text =
      `🎯 *Assignment Confirmed! (${assignmentDetails.requestNumber})*\n\n` +
      `👤 *Customer:* ${escapeMd(assignmentDetails.customerName)}\n` +
      `📱 *Contact:* ${contactInfo}\n` +
      `📍 *Address:* ${escapeMd(assignmentDetails.serviceAddress || 'See map')}\n` +
      `📝 *Problem:* ${escapeMd(assignmentDetails.description || 'No description')}\n` +
      `🗺 [Open in Google Maps](${mapUrl})\n\n` +
      `Contact the customer to agree on visit charge, scope and timing, then update the job below.`;

    return messageSender.sendMessage({
      chatId,
      text,
      replyMarkup: KeyboardBuilder.technicianJobStatusButtons(assignmentDetails.requestId, 'ASSIGNED'),
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
