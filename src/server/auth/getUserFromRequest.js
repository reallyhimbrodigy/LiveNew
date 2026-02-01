import { supabaseForUser } from "../supabase/client.js";

function extractBearerToken(req) {
  const header = req?.headers?.authorization;
  if (!header || typeof header !== "string") return "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

export async function getUserFromRequest(req) {
  const jwt = extractBearerToken(req);
  if (!jwt) return { userId: null, jwt: null, error: "missing_token" };
  const supabase = supabaseForUser(jwt);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    return { userId: null, jwt: null, error: error?.message || "invalid_token" };
  }
  return { userId: data.user.id, jwt };
}
