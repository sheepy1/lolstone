// 带重试的 HTTP 请求。只用 Node 内置的 fetch。

const TIMEOUT_MS = 30_000;

export class HttpError extends Error {
  status: number;
  url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status} ${url}`);
    this.status = status;
    this.url = url;
  }
}

/** 404 这类客户端错误重试也没用，直接抛出；408、429 和 5xx 才重试。 */
function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  return true; // 网络错误、超时
}

export type RetryOptions = {
  /** 第一次失败之后再试几次。 */
  retries?: number;
};

async function withRetry<T>(fn: () => Promise<T>, { retries = 2 }: RetryOptions = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(res.status, url);
  }
  return res;
}

export function fetchBytes(url: string, opts?: RetryOptions): Promise<Uint8Array> {
  return withRetry(async () => new Uint8Array(await (await get(url)).arrayBuffer()), opts);
}

export function fetchJson<T>(url: string, opts?: RetryOptions): Promise<T> {
  return withRetry(async () => (await (await get(url)).json()) as T, opts);
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? `（${err.cause.message}）` : '';
    return err.message + cause;
  }
  return String(err);
}
