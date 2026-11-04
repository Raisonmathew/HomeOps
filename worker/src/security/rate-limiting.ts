// NOTE: This in-memory store is scoped to a single Cloudflare Worker isolate.
// Under real traffic the Worker may run in many isolates simultaneously, so
// this counter is NOT shared across instances and therefore does not enforce a
// true global rate limit.  For production hardening, replace this Map with
// Cloudflare KV or a Durable Object so the count is shared across isolates.
const requestCounts = new Map<number, { count: number; resetAt: number }>();

export function checkRateLimit(
  userId: number,
  limit = 20,
  windowMs = 60000
): boolean {
  const now = Date.now();
  const userRate = requestCounts.get(userId);

  if (!userRate || now > userRate.resetAt) {
    requestCounts.set(userId, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (userRate.count >= limit) {
    return false;
  }

  userRate.count += 1;
  return true;
}
