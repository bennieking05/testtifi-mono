import axios, { AxiosRequestConfig, AxiosError, AxiosHeaders } from "axios";

// Extend Axios config for retry flag
interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: new AxiosHeaders({
    "Content-Type": "application/json",
  }),
});

const rawAxios = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
  headers: new AxiosHeaders({
    "Content-Type": "application/json",
  }),
});

// Add access token to headers
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");

  if (token) {
    if (!config.headers) {
      config.headers = new AxiosHeaders();
    }

    if (config.headers instanceof AxiosHeaders) {
      config.headers.set("Authorization", `Bearer ${token}`);
    } else if (typeof config.headers === "object") {
      (config.headers as Record<string, string>)[
        "Authorization"
      ] = `Bearer ${token}`;
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as CustomAxiosRequestConfig;

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      localStorage.getItem("refreshToken") &&
      !originalRequest.url?.includes("/auth/refresh-token")
    ) {
      originalRequest._retry = true;

      try {
        // Ensure we call the correct refresh path for both prod (baseURL '/api') and staging (baseURL '/staging')
        const base = (rawAxios.defaults.baseURL || "").toString();
        const needsApiPrefix = !/\b\/api\/?$/.test(base);
        const refreshPath = `${needsApiPrefix ? "/api" : ""}/auth/refresh-token`;
        const res = await rawAxios.post(refreshPath, {
          refreshToken: localStorage.getItem("refreshToken"),
        });

        const newToken = res.data.accessToken;
        localStorage.setItem("token", newToken);

        // Update default Authorization header
        (api.defaults.headers.common as any)[
          "Authorization"
        ] = `Bearer ${newToken}`;

        // Update request-specific Authorization header
        if (originalRequest.headers instanceof AxiosHeaders) {
          originalRequest.headers.set("Authorization", `Bearer ${newToken}`);
        } else if (typeof originalRequest.headers === "object") {
          (originalRequest.headers as Record<string, string>)[
            "Authorization"
          ] = `Bearer ${newToken}`;
        }

        return api(originalRequest);
      } catch (err) {
        console.error("Token refresh failed", err);
        localStorage.clear();
        const basePath = (import.meta as any).env?.VITE_BASE_PATH || "/";
        const normalizedBase = String(basePath).replace(/\/$/, "");
        window.location.href = `${normalizedBase}/login`;
        return Promise.reject(err);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
