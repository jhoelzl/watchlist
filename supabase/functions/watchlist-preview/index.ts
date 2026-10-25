// Vorschau fürs Formular "URL hinzufügen": ruft die Seite ab und zeigt, welcher Bereich erkannt wird.
// Nur für freigeschaltete Konten (watchlist_admins). Kein JavaScript-Rendering (Seiten mit js: true können abweichen).
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

// Schutz vor SSRF: nur http(s) auf Standardports, keine internen Hosts (auch nicht per DNS oder Weiterleitung).
async function assertPublic(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Nur http(s)-URLs sind erlaubt.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Nur die Standardports 80 und 443 sind erlaubt.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Interne Hosts sind nicht erlaubt.");
  }
  const isIp = /^[\d.]+$/.test(host) || host.includes(":");
  const ips: string[] = [];
  if (isIp) ips.push(host);
  else {
    for (const type of ["A", "AAAA"] as const) {
      try {
        ips.push(...(await Deno.resolveDns(host, type)));
      } catch { /* kein Eintrag dieses Typs */ }
    }
    if (!ips.length) throw new Error("Host nicht auflösbar.");
  }
  if (ips.some(privateIp)) throw new Error("Interne Adressen sind nicht erlaubt.");
  return url;
}

async function fetchPage(start: string): Promise<{ body: string; type: string; url: string }> {
  let url = await assertPublic(start);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": UA, "Accept-Language": "de,en;q=0.8" },
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
  throw new Error("Zu viele Weiterleitungen.");
}

Deno.serve(async (req) => {
  const CORS = corsFor(req);
  const reply = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  const origin = req.headers.get("Origin");
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return reply({ error: "Herkunft nicht erlaubt." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ error: "Nur POST erlaubt." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: user } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user.user) return reply({ error: "Nicht angemeldet." }, 401);
  const { data: admin } = await supabase.from("watchlist_admins").select("user_id").maybeSingle();
  if (!admin) return reply({ error: "Konto nicht freigeschaltet." }, 403);

  let input: { url?: unknown; selector?: unknown };
  try {
    input = await req.json();
  } catch {
    return reply({ error: "Ungültige Anfrage." }, 400);
  }
  if (typeof input.url !== "string" || input.url.length > 2000) return reply({ error: "URL fehlt." }, 400);
  const selector = typeof input.selector === "string" ? input.selector.slice(0, 200) : "auto";

  try {
    const page = await fetchPage(input.url);
    if (/xml|rss|atom/i.test(page.type) || /^\s*<(\?xml|rss|feed)/i.test(page.body)) {
      return reply({ feed: true, finalUrl: page.url });
    }
    const { document } = parseHTML(page.body);
    return reply({ ...analyze(document as unknown as Doc, selector), finalUrl: page.url });
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : "Abruf fehlgeschlagen." });
  }
});
