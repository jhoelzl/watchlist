// Starts the GitHub "check" workflow for authorized accounts (watchlist_admins).
// Secret: GH_DISPATCH_TOKEN (fine-grained PAT, repository jhoelzl/watchlist, Actions: Read and write).
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
const MIN_INTERVAL_MS = 60_000; // at most one start per minute

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

  const token = Deno.env.get("GH_DISPATCH_TOKEN");
  if (!token) return reply({ error: "GH_DISPATCH_TOKEN is not set." }, 500);
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
  if (!runs.ok && body?.action === "status") return reply({ error: `GitHub responded with ${runs.status}.` }, 502);
  const last = runs.ok ? (await runs.json()).workflow_runs?.[0] : undefined;
  const run = last && { id: last.id, status: last.status, conclusion: last.conclusion, url: last.html_url };

  // Read-only: current status of the latest run (for the dashboard live view)
  if (body?.action === "status") return reply({ run: run ?? null });

  if (last && ["queued", "in_progress", "waiting", "requested", "pending"].includes(last.status)) {
    return reply({ status: "running", baseline: last.id - 1, run });
  }
  if (last && Date.now() - new Date(last.created_at).getTime() < MIN_INTERVAL_MS) {
    return reply({ error: "Too many starts: at most one run per minute." }, 429);
  }
  // Optional: check only one or several URLs (max. 100). All must be in the configuration (RLS: readable only by authorized accounts).
  const list: unknown[] = Array.isArray(body?.urls) ? body.urls : typeof body?.url === "string" && body.url ? [body.url] : [];
  const urls = [...new Set(list.filter((u): u is string => typeof u === "string" && u.length > 0 && !/[\r\n]/.test(u)))];
  if (list.length > 100 || urls.length !== list.length) return reply({ error: "Invalid URL list." }, 400);
  if (urls.length) {
    const { data: rows } = await supabase.from("watchlist_urls").select("url").in("url", urls);
    if ((rows ?? []).length !== urls.length) return reply({ error: "URL not found." }, 404);
  }
  const only = urls.join("\n");
  // Optional: check a whole group ("General" = URLs without a group).
  const onlyGroup = !only && typeof body?.group === "string" ? body.group : "";
  if (onlyGroup) {
    const { data: rows } = await supabase.from("watchlist_urls").select("grp");
    if (!(rows ?? []).some((r: { grp: string | null }) => (r.grp || "General") === onlyGroup)) {
      return reply({ error: "Group not found." }, 404);
    }
  }
  const inputs = only ? { url: only } : onlyGroup ? { group: onlyGroup } : undefined;
  const res = await gh("dispatches", { method: "POST", body: JSON.stringify({ ref: "main", ...(inputs ? { inputs } : {}) }) });
  if (res.status !== 204) return reply({ error: `GitHub responded with ${res.status}.` }, 502);
  return reply({ status: "started", baseline: last?.id ?? 0 });
});
