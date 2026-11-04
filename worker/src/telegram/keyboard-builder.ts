import {
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from '../types/telegram';

export const KeyboardBuilder = {
  customerMainMenu(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '🔍 Find a Technician', callback_data: 'cmd_new_request' }],
        [{ text: '📋 My Requests', callback_data: 'cmd_my_requests' }],
        [{ text: '📍 Saved Addresses', callback_data: 'cmd_saved_addresses' }],
        [{ text: '🛠 Switch / Apply as Technician', callback_data: 'cmd_tech_portal' }],
      ],
    };
  },

  technicianMainMenu(isOnline: boolean): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          isOnline
            ? { text: '🔴 Go Offline', callback_data: 'tech_go_offline' }
            : { text: '🟢 Go Online', callback_data: 'tech_go_online' },
        ],
        [{ text: '📋 Active Jobs', callback_data: 'tech_active_jobs' }],
        [{ text: '⚙️ My Work Profile & Skills', callback_data: 'tech_profile' }],
        [{ text: '👤 Switch to Customer Menu', callback_data: 'cmd_customer_portal' }],
      ],
    };
  },

  requestLocationKeyboard(buttonText = '📍 Share Location'): ReplyKeyboardMarkup {
    return {
      keyboard: [[{ text: buttonText, request_location: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  },

  requestContactKeyboard(buttonText = '📱 Share Phone Number'): ReplyKeyboardMarkup {
    return {
      keyboard: [[{ text: buttonText, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    };
  },

  removeKeyboard(): ReplyKeyboardRemove {
    return { remove_keyboard: true };
  },

  radiusSelection(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '3 km', callback_data: 'rad_3' },
          { text: '5 km', callback_data: 'rad_5' },
          { text: '8 km', callback_data: 'rad_8' },
        ],
        [
          { text: '10 km', callback_data: 'rad_10' },
          { text: '15 km', callback_data: 'rad_15' },
          { text: '20 km', callback_data: 'rad_20' },
        ],
      ],
    };
  },

  offerActionButtons(requestId: string, offerId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '✅ Accept Offer', callback_data: `offer_accept:${requestId}:${offerId}` },
          { text: '❌ Decline', callback_data: `offer_decline:${requestId}:${offerId}` },
        ],
      ],
    };
  },

  technicianJobStatusButtons(requestId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '📞 Customer Contacted', callback_data: `job_status:CONTACTED:${requestId}` }],
        [{ text: '🔨 Work Started', callback_data: `job_status:IN_PROGRESS:${requestId}` }],
        [{ text: '✅ Work Complete', callback_data: `job_status:TECH_COMPLETE:${requestId}` }],
        [{ text: '⚠️ Unable to Complete', callback_data: `job_status:UNABLE:${requestId}` }],
      ],
    };
  },

  ratingButtons(requestId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '⭐ 1', callback_data: `rate:1:${requestId}` },
          { text: '⭐ 2', callback_data: `rate:2:${requestId}` },
          { text: '⭐ 3', callback_data: `rate:3:${requestId}` },
          { text: '⭐ 4', callback_data: `rate:4:${requestId}` },
          { text: '⭐ 5', callback_data: `rate:5:${requestId}` },
        ],
      ],
    };
  },
};
