export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    // FormData bodies need the browser-generated multipart boundary.
    headers:
      init?.body instanceof FormData
        ? init.headers
        : { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const details = body?.error?.details
      ?.map(
        (d: { path: string[]; message: string }) =>
          `${d.path.join(".")}: ${d.message}`,
      )
      .join(" / ");
    throw new Error(
      details || body?.error?.message || `요청 실패 (${response.status})`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
