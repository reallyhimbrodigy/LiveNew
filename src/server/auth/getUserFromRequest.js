import { supabaseForUser } from "../supabase/client.js";

function extractBearerToken(req) {
  const header = req?.headers?.authorization;
  if (!header || typeof header !== "string") return "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

function extractCookieToken(req) {
  const header = req?.headers?.cookie;
  if (!header) return "";
  const parts = header.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === "ln_token") return decodeURIComponent(part.slice(idx + 1));
  }
  return "";
}

export async function getUserFromRequest(req) {
  const jwt = extractBearerToken(req) || extractCookieToken(req);
  if (!jwt) return { userId: null, jwt: null, error: "missing_token" };
  const supabase = supabaseForUser(jwt);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    return { userId: null, jwt: null, error: error?.message || "invalid_token" };
  }
  return { userId: data.user.id, jwt };
}
