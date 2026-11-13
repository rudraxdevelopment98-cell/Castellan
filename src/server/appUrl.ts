/**
 * The public base URL used in links we send by email.
 *
 * Deliberately never derived from the incoming request: a forged Host header
 * would otherwise let an attacker receive a victim's password-reset link
 * (reset poisoning). Order: APP_URL, then Vercel's production domain, then
 * localhost for development.
 */
export function appUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is not set; it is required to build links in emails.");
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function absoluteUrl(path: string): string {
  return `${appUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
