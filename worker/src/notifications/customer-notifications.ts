import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';
import { escapeMd } from '../telegram/format';

export const CustomerNotifications = {
  async notifyTechnicianMatched(
    messageSender: MessageSender,
    chatId: number,
    techDetails: {
      requestId: string;
      fullName: string;
      categoryName: string;
      rating: number;
      completedJobs: number;
      phoneNumber?: string | null;
      telegramUsername?: string | null;
      telegramUserId?: number | null;
      distanceKm: number | null;
      /** Customer gives this to the technician on arrival; it's needed to start work */
      startPin: string;
    }
  ): Promise<boolean> {
    // Contact fallback order (spec §18.2); the bot relay always works as the last resort.
    let contactInfo = '💬 Send your messages here in this chat and the bot will forward them.';
    if (techDetails.phoneNumber) {
      contactInfo = `📞 [${techDetails.phoneNumber}](tel:${techDetails.phoneNumber})`;
    } else if (techDetails.telegramUsername) {
      contactInfo = `✈️ [@${escapeMd(techDetails.telegramUsername)}](https://t.me/${techDetails.telegramUsername})`;
    }

    const text =
      `🎉 *Technician Found!*\n\n` +
      `👤 *Name:* ${escapeMd(techDetails.fullName)}\n` +
      `🛠 *Approved skill:* ${escapeMd(techDetails.categoryName)}\n` +
      `⭐ *Rating:* ${techDetails.completedJobs > 0 ? `${techDetails.rating.toFixed(1)}/5` : 'New technician (verified)'}\n` +
      `📦 *Completed through HomeOps:* ${techDetails.completedJobs}\n` +
      (techDetails.distanceKm !== null ? `📏 *Approx. starting distance:* ${techDetails.distanceKm} km\n` : '') +
      `📱 *Contact:* ${contactInfo}\n\n` +
      `🔑 *Your start code: ${techDetails.startPin}*\nGive it to the technician only when they arrive. They need it to start work.\n\n` +
      `_Discuss scope, price, payment, and warranty directly before work begins. You can also message the technician through this chat._`;

    return messageSender.sendMessage({
      chatId,
      text,
      replyMarkup: {
        inline_keyboard: [
          [{ text: '🔁 Request another technician', callback_data: `req_reassign:${techDetails.requestId}` }],
          [{ text: '❌ Cancel request', callback_data: `req_cancel:${techDetails.requestId}` }],
        ],
      },
    });
  },

  async notifyWorkMarkedComplete(
    messageSender: MessageSender,
    chatId: number,
    requestId: string,
    requestNumber: string,
    notes: string[] = []
  ): Promise<boolean> {
    return messageSender.sendMessage({
      chatId,
      text:
        `🏁 *The technician marked \`${requestNumber}\` as complete.*\n\n` +
        (notes.length ? `${notes.join('\n')}\n\n` : '') +
        `Was the work actually completed? Only confirm if it was.`,
      replyMarkup: KeyboardBuilder.customerConfirmCompletion(requestId),
    });
  },

  async notifyNoTechnicianFound(messageSender: MessageSender, chatId: number): Promise<boolean> {
    return messageSender.sendMessage({
      chatId,
      text:
        `⚠️ *No technician is available right now.*\n\n` +
        `Nearby technicians are busy, offline, or didn't respond. Our team has been alerted and may contact you. ` +
        `You can also try again later.`,
      replyMarkup: KeyboardBuilder.customerMainMenu(),
    });
  },
};
