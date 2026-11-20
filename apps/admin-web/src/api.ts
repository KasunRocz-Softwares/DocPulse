import { createAdminApi } from "./admin-api";
import { createApiClient } from "./api-client";

export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV
    ? "http://localhost:13001/api/v1"
    : `${window.location.origin}/api/v1`);

export const api = createApiClient(
  apiBaseUrl,
  () => window.sessionStorage.getItem("rdps.accessToken"),
  fetch,
  (token) => {
    if (token) window.sessionStorage.setItem("rdps.accessToken", token);
    else window.sessionStorage.removeItem("rdps.accessToken");
  },
);

export const adminApi = createAdminApi(api);
