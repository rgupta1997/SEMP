const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api';
const TOKEN_KEY = 'semp_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

// 429/503 mean the request never reached the app - API Gateway/Lambda rejected
// it at the concurrency limit before our code ran. The app itself never
// returns these codes for anything else, so retrying on them can't mask a
// real application error. Backoff is exponential + jittered so a burst of
// retrying tabs doesn't just recreate the same thundering herd.
const RETRYABLE_STATUS = new Set([429, 503]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ApiOptions {
  // Defaults to true for GET/HEAD (safe to replay) and false otherwise, since
  // blindly retrying a POST/DELETE risks double-submitting something like a
  // login or an order. Pass explicitly to override either way.
  retry?: boolean;
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  opts?: ApiOptions,
): Promise<T> {
  const token = tokenStore.get();
  const shouldRetry = opts?.retry ?? (method === 'GET' || method === 'HEAD');

  let attempt = 0;
  for (;;) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (shouldRetry && RETRYABLE_STATUS.has(res.status) && attempt < MAX_RETRIES) {
      attempt += 1;
      const backoff = BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(backoff + Math.random() * backoff * 0.3);
      continue;
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = data?.error ?? {};
      throw new ApiError(res.status, err.message ?? res.statusText, err.details);
    }
    return data as T;
  }
}
