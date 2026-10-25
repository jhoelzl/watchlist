// Preview for the "Add URL" form: fetches the page and shows the detected area.
// Authorized accounts only (watchlist_admins). JavaScript is not rendered (pages with js: true may differ).
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseHTML } from "npm:linkedom@0.18";
import { analyze, type Doc } from "./analyze.ts";

const ALLOWED_ORIGINS = ["https://jhoelzl.github.io", "http://localhost:5173"];
const corsFor = (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
};
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;
const UA = "Mozilla/5.0 (compatible; watchlist-preview/1.0)";

function privateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || /^(fc|fd|fe[89ab])/.test(v) || v.startsWith("::ffff:");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

// SSRF protection: only http(s) on standard ports; no internal hosts, including through DNS or redirects.
async function assertPublic(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Only the standard ports 80 and 443 are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Internal hosts are not allowed.");
  }
  const isIp = /^[\d.]+$/.test(host) || host.includes(":");
  const ips: string[] = [];
  if (isIp) ips.push(host);
  else {
    for (const type of ["A", "AAAA"] as const) {
      try {
        ips.push(...(await Deno.resolveDns(host, type)));
      } catch { /* No record of this type. */ }
    }
    if (!ips.length) throw new Error("Host could not be resolved.");
  }
  if (ips.some(privateIp)) throw new Error("Internal addresses are not allowed.");
  return url;
}

async function fetchPage(start: string): Promise<{ body: string; type: string; url: string }> {
  let url = await assertPublic(start);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": UA, "Accept-Language": "en" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertPublic(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const body = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
    return { body, type: res.headers.get("content-type") ?? "", url: url.toString() };
  }
  throw new Error("Too many redirects.");
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const reply = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  const origin = req.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Only POST is allowed." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: user } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user.user) return reply({ error: "Not signed in." }, 401);
  const { data: admin } = await supabase.from("watchlist_admins").select("user_id").maybeSingle();
  if (!admin) return reply({ error: "Account not authorized." }, 403);

  let input: { url?: unknown; selector?: unknown };
  try {
    input = await req.json();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  if (typeof input.url !== "string" || input.url.length > 2000) return reply({ error: "URL is required." }, 400);
  const selector = typeof input.selector === "string" ? input.selector.slice(0, 200) : "auto";

  try {
    const page = await fetchPage(input.url);
    if (/xml|rss|atom/i.test(page.type) || /^\s*<(\?xml|rss|feed)/i.test(page.body)) {
      return reply({ feed: true, finalUrl: page.url });
    }
    const { document } = parseHTML(page.body);
    return reply({ ...analyze(document as unknown as Doc, selector), finalUrl: page.url });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "Fetch failed." });
  }
});
