// Startet den GitHub-Workflow "check" für freigeschaltete Konten (watchlist_admins).
// Secrets: GH_DISPATCH_TOKEN (Fine-grained PAT, Repo jhoelzl/watchlist, Actions: Read and write).
import { createClient } from "npm:@supabase/supabase-js@2";

const REPO = "jhoelzl/watchlist";
const WORKFLOW = "check.yml";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
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

  const runs = await gh("runs?per_page=1");
  if (runs.ok) {
    const last = (await runs.json()).workflow_runs?.[0];
    if (last && ["queued", "in_progress", "waiting", "requested", "pending"].includes(last.status)) {
      return reply({ status: "running" });
    }
  }
  const res = await gh("dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });
  if (res.status !== 204) return reply({ error: `GitHub antwortet mit ${res.status}.` }, 502);
  return reply({ status: "started" });
});
