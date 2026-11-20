export type ApiRequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function createApiClient(
  baseUrl: string,
  getToken: () => string | null,
  fetchImplementation: typeof fetch = fetch,
  setToken: (token: string | null) => void = () => undefined,
) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  let refreshInFlight: Promise<string | null> | null = null;

  function requestUrl(path: string) {
    return `${normalizedBaseUrl}/${path.replace(/^\/+/, "")}`;
  }

  async function send(
    path: string,
    options: ApiRequestOptions,
    token: string | null,
  ) {
    const headers: Record<string, string> = { ...options.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData;
    if (options.body !== undefined && !isFormData)
      headers["Content-Type"] = "application/json";
    return fetchImplementation(requestUrl(path), {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      ...(options.body === undefined
        ? {}
        : {
            body: isFormData
              ? (options.body as FormData)
              : JSON.stringify(options.body),
          }),
    });
  }

  async function refreshAccessToken(): Promise<string | null> {
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const response = await send(
            "/internal/auth/refresh",
            { method: "POST" },
            null,
          );
          if (!response.ok) {
            setToken(null);
            return null;
          }
          const result = (await response.json()) as { accessToken?: unknown };
          if (typeof result.accessToken !== "string" || !result.accessToken) {
            setToken(null);
            return null;
          }
          setToken(result.accessToken);
          return result.accessToken;
        } catch {
          setToken(null);
          return null;
        } finally {
          refreshInFlight = null;
        }
      })();
    }
    return refreshInFlight;
  }

  return {
    async request<T>(
      path: string,
      options: ApiRequestOptions = {},
    ): Promise<T> {
      const response = await send(path, options, getToken());
      const isAuthEndpoint =
        /^\/?internal\/auth\/(login|bootstrap|refresh|logout)(?:\/|$)/.test(
          path,
        );
      let effectiveResponse = response;
      if (response.status === 401 && !isAuthEndpoint) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken)
          effectiveResponse = await send(path, options, refreshedToken);
      }

      const responseText =
        effectiveResponse.status === 204 ? "" : await effectiveResponse.text();
      let payload: unknown = null;
      if (responseText) {
        try {
          payload = JSON.parse(responseText);
        } catch {
          payload = responseText;
        }
      }

      if (!effectiveResponse.ok) {
        const body = payload as { message?: string | string[] } | null;
        const message = Array.isArray(body?.message)
          ? body.message.join(" · ")
          : body?.message ||
            (typeof payload === "string" && payload) ||
            `Request failed (${effectiveResponse.status})`;
        throw new ApiError(message, effectiveResponse.status);
      }

      return payload as T;
    },
    async download(
      path: string,
    ): Promise<{ blob: Blob; filename: string | null }> {
      let response = await send(path, {}, getToken());
      if (response.status === 401) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) response = await send(path, {}, refreshedToken);
      }
      if (!response.ok) {
        const text = await response.text();
        let payload: unknown = text;
        try {
          payload = JSON.parse(text);
        } catch {
          /* Keep the plain-text API error. */
        }
        const body = payload as { message?: string | string[] } | null;
        const message = Array.isArray(body?.message)
          ? body.message.join(" · ")
          : body?.message ||
            (typeof payload === "string" && payload) ||
            `Request failed (${response.status})`;
        throw new ApiError(message, response.status);
      }
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
      let filename = plain ?? null;
      if (encoded) {
        try {
          filename = decodeURIComponent(encoded);
        } catch {
          filename = encoded;
        }
      }
      return { blob: await response.blob(), filename };
    },
  };
}
