export function validateWebhookSecret(
  request: Request,
  configuredSecret: string
): boolean {
  // An absent or empty secret must never silently allow all requests through.
  if (!configuredSecret) return false;
  const headerSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return headerSecret === configuredSecret;
}
