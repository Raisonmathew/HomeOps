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

export const PRIVACY_TERMS_VERSION = 'v1.0';

export const BOT_TEXTS = {
  WELCOME_CUSTOMER: `👋 *Welcome to HomeOps!*\n\nConnect directly with verified local technicians for plumbing, electrical, and AC repair.\n\n*Important:* Pricing, payment, and work scope are agreed directly between you and the technician. HomeOps does not collect service payments.`,
  WELCOME_TECHNICIAN: `🔧 *HomeOps Technician Portal*\n\nReceive nearby service requests matching your skills, accept jobs on your schedule, and agree on pricing directly with customers.`,
  SAFETY_HEADER: `⚠️ *SAFETY WARNING*`,
  ESTIMATE_DISCLAIMER: `_Note: This estimate is a shared record between customer and technician. HomeOps does not collect payments._`,
};
