import {
  InlineKeyboardMarkup,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
} from '../types/telegram';
import { RequestStatus } from '../types/database';

// Telegram rejects the whole message if any callback_data exceeds 64 bytes,
// so callbacks carry at most one UUID (36 chars) plus a short prefix.

export const KeyboardBuilder = {
  customerMainMenu(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '🔍 Find a Technician', callback_data: 'cmd_new_request' }],
        [{ text: '📋 My Requests', callback_data: 'cmd_my_requests' }],
        [{ text: '📍 Saved Addresses', callback_data: 'cmd_saved_addresses' }],
        [{ text: '🛠 Switch / Apply as Technician', callback_data: 'cmd_tech_portal' }],
        [
          { text: '🆘 Support', callback_data: 'cmd_support' },
          { text: '🔒 Privacy', callback_data: 'cmd_privacy' },
          { text: '📄 Terms', callback_data: 'cmd_terms' },
        ],
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
        [{ text: '📊 Performance & History', callback_data: 'tech_history' }],
        [
          { text: '🆘 Support', callback_data: 'cmd_support' },
          { text: '👤 Customer Menu', callback_data: 'cmd_customer_portal' },
        ],
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

  offerActionButtons(offerId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '✅ Accept', callback_data: `offer_accept:${offerId}` },
          { text: '❌ Decline', callback_data: `offer_decline:${offerId}` },
        ],
      ],
    };
  },

  /** Only the next valid step(s) for the job's current status (spec §6.8). */
  technicianJobStatusButtons(requestId: string, status: RequestStatus): InlineKeyboardMarkup {
    const b = (text: string, action: string) => [{ text, callback_data: `job:${action}:${requestId}` }];
    const rows: Partial<Record<RequestStatus, { text: string; callback_data: string }[][]>> = {
      ASSIGNED: [b('📞 I Contacted the Customer', 'CONTACTED'), b('❌ Cancel Job', 'CANCEL')],
      CONTACTED: [b('🤝 Scope & Price Agreed', 'AGREE'), b('⚠️ Unable to Do This Job', 'UNABLE'), b('❌ Cancel Job', 'CANCEL')],
      DISCUSSING_SCOPE: [b('🤝 Scope & Price Agreed', 'AGREE'), b('❌ Cancel Job', 'CANCEL')],
      AGREED: [b('🔨 Work Started (needs customer code)', 'START'), b('❌ Cancel Job', 'CANCEL')],
      IN_PROGRESS: [b('✅ Work Complete', 'DONE'), b('⚠️ Unable to Complete', 'UNABLE')],
    };
    const safetyRow = [
      { text: '🚨 Safety', callback_data: `safety:${requestId}` },
      { text: '🚩 Report customer', callback_data: `rep:${requestId}` },
    ];
    return { inline_keyboard: rows[status] ? [...rows[status]!, safetyRow] : [] };
  },

  customerConfirmCompletion(requestId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '✅ Yes, all done', callback_data: `done:FULL:${requestId}` }],
        [{ text: '◐ Partly done', callback_data: `done:PARTIAL:${requestId}` }],
        [{ text: '⚠️ Report a problem', callback_data: `done:PROBLEM:${requestId}` }],
      ],
    };
  },

  cancelRequestButton(requestId: string): InlineKeyboardMarkup {
    return { inline_keyboard: [[{ text: '❌ Cancel request', callback_data: `req_cancel:${requestId}` }]] };
  },

  /** Direct-payment declaration (spec §6.7); used by both customer and technician. */
  paymentButtons(requestId: string, asCustomer: boolean): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: asCustomer ? '✅ Yes, I paid' : '✅ Yes, I was paid', callback_data: `pay:PAID:${requestId}` }],
        [{ text: '⏳ Not yet', callback_data: `pay:LATER:${requestId}` }],
        [{ text: "⚠️ There's a payment problem", callback_data: `pay:DISPUTE:${requestId}` }],
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
