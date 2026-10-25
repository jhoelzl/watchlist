// Startet den GitHub-Workflow "check" für freigeschaltete Konten (watchlist_admins).
// Secrets: GH_DISPATCH_TOKEN (Fine-grained PAT, Repo jhoelzl/watchlist, Actions: Read and write).
import { createClient } from "npm:@supabase/supabase-js@2";

const REPO = "jhoelzl/watchlist";
const WORKFLOW = "check.yml";
const ALLOWED_ORIGINS = ["https://jhoelzl.github.io", "http://localhost:5173"];
const corsFor = (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
};
const MIN_INTERVAL_MS = 60_000; // höchstens ein Start pro Minute

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

  const token = Deno.env.get("GH_DISPATCH_TOKEN");
  if (!token) return reply({ error: "GH_DISPATCH_TOKEN ist nicht gesetzt." }, 500);
  const gh = (path: string, init?: RequestInit) =>
    fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/${path}`, {
      ...init,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

  const body = await req.json().catch(() => ({}));
  const runs = await gh("runs?per_page=1");
  if (!runs.ok && body?.action === "status") return reply({ error: `GitHub antwortet mit ${runs.status}.` }, 502);
  const last = runs.ok ? (await runs.json()).workflow_runs?.[0] : undefined;
  const run = last && { id: last.id, status: last.status, conclusion: last.conclusion, url: last.html_url };

  // Nur lesen: aktueller Stand des letzten Laufs (für die Live-Anzeige im Dashboard)
  if (body?.action === "status") return reply({ run: run ?? null });

  if (last && ["queued", "in_progress", "waiting", "requested", "pending"].includes(last.status)) {
    return reply({ status: "running", baseline: last.id - 1, run });
  }
  if (last && Date.now() - new Date(last.created_at).getTime() < MIN_INTERVAL_MS) {
    return reply({ error: "Zu viele Starts: höchstens ein Lauf pro Minute." }, 429);
  }
  // Optional: nur eine URL prüfen. Sie muss in der Konfiguration stehen (RLS: nur für freigeschaltete Konten lesbar).
  const only = typeof body?.url === "string" ? body.url : "";
  if (only) {
    const { data: row } = await supabase.from("watchlist_urls").select("url").eq("url", only).maybeSingle();
    if (!row) return reply({ error: "URL nicht gefunden." }, 404);
  }
  const res = await gh("dispatches", { method: "POST", body: JSON.stringify({ ref: "main", ...(only ? { inputs: { url: only } } : {}) }) });
  if (res.status !== 204) return reply({ error: `GitHub antwortet mit ${res.status}.` }, 502);
  return reply({ status: "started", baseline: last?.id ?? 0 });
});
