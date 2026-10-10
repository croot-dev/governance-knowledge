import { setTimeout as sleep } from "node:timers/promises";

export function positiveInt(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name}은 양의 정수여야 합니다.`);
  return value;
}

// One in-flight request per process. Separate workers still share the account quota.
let pending: Promise<unknown> = Promise.resolve();
export class NvidiaClient {
  constructor(
    private apiKey = process.env.NVIDIA_API_KEY ?? "",
    private baseUrl = process.env.NVIDIA_BASE_URL ??
      "https://integrate.api.nvidia.com/v1",
    private timeoutMs = positiveInt("NVIDIA_TIMEOUT_MS", 90000),
    private intervalMs = positiveInt("NVIDIA_REQUEST_INTERVAL_MS", 2000),
  ) {}

  async post<T>(path: string, body: unknown): Promise<T> {
    if (!this.apiKey.trim()) throw new Error("NVIDIA_API_KEY를 설정해주세요.");
    const task = pending.then(async () => {
      const deadline = AbortSignal.timeout(
        Math.min(this.timeoutMs * 2, 180000),
      );
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await fetch(
            `${this.baseUrl.replace(/\/$/, "")}/${path}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify(body),
              signal: AbortSignal.any([
                deadline,
                AbortSignal.timeout(this.timeoutMs),
              ]),
            },
          );
          if (response.ok) return (await response.json()) as T;
          await response.body?.cancel();
          if (![429, 502, 503, 504].includes(response.status) || attempt === 2)
            throw new Error(`NVIDIA API HTTP ${response.status}`);
          const retryAfter = response.headers.get("retry-after");
          const seconds = retryAfter === null ? NaN : Number(retryAfter);
          const delay = Number.isFinite(seconds)
            ? seconds * 1000
            : retryAfter
              ? Date.parse(retryAfter) - Date.now()
              : NaN;
          // Do not retry earlier than a long provider cooldown; let the job fail visibly.
          if (delay > 60000)
            throw new Error(
              "NVIDIA API 대기 시간이 60초를 초과했습니다. 이후 작업을 재시도해주세요.",
            );
          await sleep(
            Math.max(Number.isFinite(delay) ? delay : 0, 1000 * 2 ** attempt) +
              Math.random() * 250,
            undefined,
            { signal: deadline },
          );
        }
        throw new Error("NVIDIA API 재시도 한도를 초과했습니다.");
      } finally {
        await sleep(this.intervalMs);
      }
    });
    pending = task.catch(() => undefined);
    return task;
  }
}
