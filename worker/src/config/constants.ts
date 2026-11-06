export const MATCHING_WEIGHTS = {
  SKILL_FIT: 30,
  PROXIMITY: 25,
  TIME_AVAILABILITY: 15,
  RELIABILITY: 15,
  RATING: 10,
  FAIRNESS: 5,
};

export const BATCH_CONFIG = {
  BATCH_1_SIZE: 3,
  BATCH_1_TIMEOUT_SECONDS: 90,
  BATCH_2_SIZE: 3,
  BATCH_2_TIMEOUT_SECONDS: 90,
  BATCH_3_TIMEOUT_SECONDS: 180,
  MAX_ACTIVE_ASSIGNMENTS: 2,
};

// Defaults; overridden at runtime from the marketplace_config table (services/config.ts).
export const SEARCH_CONFIG = {
  /** Scheduled requests start searching this many hours before the preferred slot */
  LEAD_TIME_HOURS: 2,
};

export const SAFETY_CONFIG = { MIN_WORK_MINUTES: 10, MAX_PIN_ATTEMPTS: 5, HARASSMENT_RESTRICT_COUNT: 2 };

/** Report categories offered in the bot (index is used in callback_data). URGENT ones alert operators at once. */
export const REPORT_CATEGORIES = [
  { code: 'HARASSMENT', label: '😠 Harassment, threats or abuse', urgent: true },
  { code: 'UNSAFE', label: '⚠️ Unsafe or inappropriate behaviour', urgent: true },
  { code: 'FRAUD', label: '💸 Fraud or scam', urgent: false },
  { code: 'OTHER', label: '📝 Something else', urgent: false },
] as const;

/** Emergency number shown on the Safety screen (India: 112 for police/ambulance/fire). */
export const EMERGENCY_NUMBER = '112';

export const SLA_CONFIG = {
  NO_CONTACT_NUDGE_MINUTES: 30,
  NO_CONTACT_REASSIGN_MINUTES: 60,
  CONFIRM_REMIND_HOURS: 48,
  CONFIRM_ESCALATE_HOURS: 72,
  STALE_JOB_HOURS: 24,
};

export const LIMITS_CONFIG = { MAX_OPEN_REQUESTS: 2, LATE_CANCEL_FLAG_COUNT: 3, TECH_CANCEL_FLAG_COUNT: 3 };

/** Reason codes shown as buttons (callback_data carries the code). */
export const CANCEL_REASONS = {
  CUSTOMER: { FOUND_OTHER: 'Found someone else', NOT_NEEDED: 'No longer needed', TOO_SLOW: 'Technician too slow', PRICE: 'Price too high', OTHER: 'Other' },
  TECHNICIAN: { EMERGENCY: 'Personal emergency', TOO_FAR: 'Too far / can’t reach', CUSTOMER_UNREACHABLE: 'Customer not reachable', PRICE: 'Couldn’t agree on price', OTHER: 'Other' },
  UNABLE: { CUSTOMER_NOT_AVAILABLE: 'Customer not available', NEEDS_PARTS: 'Needs parts / another visit', BEYOND_SKILL: 'Beyond my skills', OTHER: 'Other' },
} as const;

// v1.0 was recorded without showing the terms; v1.1 makes every user accept them once (spec §6.1).
export const PRIVACY_TERMS_VERSION = 'v1.2'; // v1.2: chat storage for safety, harassment policy, technician ID

// Draft wording: have it reviewed against the final privacy policy before the pilot (spec §12).
export const TERMS_TEXT =
  `📄 *HomeOps Terms & Privacy (${PRIVACY_TERMS_VERSION})*\n\n` +
  `• HomeOps connects you with independent, verified technicians. It does not perform the work.\n` +
  `• Price, scope, payment and warranty are agreed and paid *directly* between customer and technician. HomeOps never collects or verifies payments.\n` +
  `• We store your Telegram name/ID, any phone number you share, service locations, photos and messages relayed through the bot, only to run and protect the service.\n` +
  `• Your exact address and contact are shared with a technician only after they accept your request.\n` +
  `• Both sides can rate each other after a job; ratings and complaints are reviewed by our team.\n` +
  `• Messages relayed between customer and technician through the bot are kept for up to 90 days so we can investigate harassment or disputes; only HomeOps staff can read them.\n` +
  `• Harassment, threats or unsafe behaviour by anyone leads to restriction or permanent removal. Use 🚨 Safety or 🚩 Report in the bot at any time.\n` +
  `• Technicians submit a government ID, seen only by HomeOps staff, for verification.\n` +
  `• Contact Support from the menu to ask about or delete your data.`;

export const SUPPORT_TEXT =
  `🆘 *HomeOps Support*\n\nFor safety emergencies (gas leak, sparking, fire) call your local emergency number first.\n\n` +
  `Tap *Message our team* to send us a note. We usually reply within a few hours.`;

/** Quick tags offered after a rating (Uber-style). Positive for 4-5 stars, improvement tags for 1-3. */
export const REVIEW_TAGS = {
  ABOUT_TECHNICIAN: {
    good: ['On time', 'Professional', 'Quality work', 'Fair price', 'Clean & tidy', 'Explained clearly'],
    bad: ['Late', 'Poor quality', 'Overcharged', 'Rude', 'Left a mess', 'Did not finish'],
  },
  ABOUT_CUSTOMER: {
    good: ['Clear instructions', 'Friendly', 'Paid promptly', 'Easy to find', 'Respectful'],
    bad: ['Not available', 'Unclear request', 'Payment issue', 'Rude', 'Hard to find'],
  },
};

export const BOT_TEXTS = {
  WELCOME_CUSTOMER: `👋 *Welcome to HomeOps!*\n\nConnect directly with verified local technicians for plumbing, electrical, and AC repair.\n\n*Important:* Pricing, payment, and work scope are agreed directly between you and the technician. HomeOps does not collect service payments.`,
  WELCOME_TECHNICIAN: `🔧 *HomeOps Technician Portal*\n\nReceive nearby service requests matching your skills, accept jobs on your schedule, and agree on pricing directly with customers.`,
  SAFETY_HEADER: `⚠️ *SAFETY WARNING*`,
  ESTIMATE_DISCLAIMER: `_Note: This estimate is a shared record between customer and technician. HomeOps does not collect payments._`,
};
