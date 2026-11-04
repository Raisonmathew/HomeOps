import { MessageSender } from '../telegram/message-sender';
import { KeyboardBuilder } from '../telegram/keyboard-builder';

export const CustomerNotifications = {
  async notifyTechnicianMatched(
    messageSender: MessageSender,
    chatId: number,
    techDetails: {
      fullName: string;
      categoryName: string;
      rating: number;
      completedJobs: number;
      phoneNumber?: string | null;
      telegramUsername?: string | null;
      telegramUserId?: number | null;
      distanceKm: number;
    }
  ): Promise<boolean> {
    let contactInfo = '💬 _Direct messaging enabled in this chat (Bot Relay)_';

    if (techDetails.phoneNumber) {
      contactInfo = `📞 [${techDetails.phoneNumber}](tel:${techDetails.phoneNumber})`;
    } else if (techDetails.telegramUsername) {
      contactInfo = `✈️ [@${techDetails.telegramUsername}](https://t.me/${techDetails.telegramUsername})`;
    } else if (techDetails.telegramUserId) {
      contactInfo = `👤 [Technician Profile](tg://user?id=${techDetails.telegramUserId})`;
    }

    const text =
      `🎉 *Technician Found!*\n\n` +
      `👤 *Name:* ${techDetails.fullName}\n` +
      `🛠 *Approved Skill:* ${techDetails.categoryName}\n` +
      `⭐ *Rating:* ${techDetails.rating > 0 ? techDetails.rating.toFixed(1) : 'New (Verified)'}\n` +
      `📦 *Completed Jobs:* ${techDetails.completedJobs}\n` +
      `📱 *Contact:* ${contactInfo}\n` +
      `📏 *Initial Distance:* ~${techDetails.distanceKm} km\n\n` +
      `_Pricing, scope of work, and payment are agreed directly with the technician._`;

    return messageSender.sendMessage({
      chatId,
      text,
    });
  },

  async notifyWorkMarkedComplete(
    messageSender: MessageSender,
    chatId: number,
    requestId: string
  ): Promise<boolean> {
    const text =
      `🏁 *Technician marked your service request as complete!*\n\n` +
      `Please confirm whether the work was completed satisfactorily. How was your experience?`;

    return messageSender.sendMessage({
      chatId,
      text,
      replyMarkup: KeyboardBuilder.ratingButtons(requestId),
    });
  },

  async notifyNoTechnicianFound(
    messageSender: MessageSender,
    chatId: number
  ): Promise<boolean> {
    const text =
      `⚠️ *No nearby technician available right now.*\n\n` +
      `All eligible technicians in your area are currently busy or offline. We have escalated this to operator review.`;

    return messageSender.sendMessage({
      chatId,
      text,
    });
  },
};
