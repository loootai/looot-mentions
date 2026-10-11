/** fetch for admin API calls. Adds the CSRF token the layout put in <meta name="mentions-csrf">. */
export function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = typeof document === "undefined" ? "" : (document.querySelector('meta[name="mentions-csrf"]')?.getAttribute("content") ?? "");
  const headers = new Headers(init.headers);
  if (token) headers.set("x-mentions-csrf", token);
  return fetch(url, { ...init, headers, credentials: "same-origin" });
}
