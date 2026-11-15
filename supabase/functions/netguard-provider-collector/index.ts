const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";

const PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare", group: "infrastructure", description: "شبکهٔ جهانی لبه و مراکز حضور.", api: "https://www.cloudflarestatus.com/api/v2/summary.json", url: "https://www.cloudflarestatus.com/" },
  { id: "digitalocean", name: "DigitalOcean", group: "infrastructure", description: "زیرساخت ابری و ماشین‌های مجازی.", api: "https://status.digitalocean.com/api/v2/summary.json", url: "https://status.digitalocean.com/" },
  { id: "render", name: "Render", group: "infrastructure", description: "میزبانی برنامه‌ها و سرویس‌های وب.", api: "https://status.render.com/api/v2/summary.json", url: "https://status.render.com/" },
  { id: "supabase", name: "Supabase", group: "infrastructure", description: "پایگاه داده و خدمات پشتیبان برنامه‌ها.", api: "https://status.supabase.com/api/v2/summary.json", url: "https://status.supabase.com/" },
  { id: "openai", name: "OpenAI", group: "ai", description: "سرویس‌های هوش مصنوعی و API.", api: "https://status.openai.com/api/v2/summary.json", url: "https://status.openai.com/" },
  { id: "anthropic", name: "Anthropic", group: "ai", description: "سرویس‌های Claude و API.", api: "https://status.anthropic.com/api/v2/summary.json", url: "https://status.anthropic.com/" },
  { id: "huggingface", name: "Hugging Face", group: "ai", description: "میزبانی مدل‌ها و مجموعه‌داده‌ها.", api: "https://status.huggingface.co/api/v2/summary.json", url: "https://status.huggingface.co/" },
  { id: "github", name: "GitHub", group: "developer", description: "مخزن کد و سرویس‌های توسعه.", api: "https://www.githubstatus.com/api/v2/summary.json", url: "https://www.githubstatus.com/" },
];

function getServiceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) throw new Error("service_key_unavailable");
  const keys = JSON.parse(raw);
  if (typeof keys.default !== "string" || !keys.default) throw new Error("service_key_unavailable");
  return keys.default;
}
function headers(key: string) {
  const result: Record<string,string> = { apikey: key, Accept: "application/json", "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) result.Authorization = `Bearer ${key}`;
  return result;
}
async function db(key: string, method: string, body?: unknown, query = "") {
  const response = await fetch(`${PROJECT_URL}/rest/v1/netguard_snapshots${query}`, {
    method, headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { const detail = (await response.text()).slice(0, 400); throw new Error(`snapshot_db_http_${response.status}_${detail}`); }
  return response;
}
async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2,"0")).join("");
}
function equal(a: string,b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const labels: Record<string,string> = {
  operational:"عادی", under_maintenance:"تعمیرات برنامه‌ریزی‌شده",
  degraded_performance:"کندی یا افت کیفیت", partial_outage:"اختلال بخشی",
  major_outage:"اختلال گسترده", unknown:"نامشخص",
};
const severity: Record<string,number> = {
  operational:0, under_maintenance:1, degraded_performance:2, partial_outage:3, major_outage:4,
};
async function fetchProvider(p: typeof PROVIDERS[number]) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(p.api, {
      headers: { Accept:"application/json", "User-Agent":"NetGuard/1.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error(`status_http_${response.status}`);
    const raw = await response.json();
    const indicator = String(raw.status?.indicator ?? "unknown").toLowerCase();
    const indicatorMap: Record<string,string> = {
      none:"operational", minor:"degraded_performance", major:"major_outage",
      critical:"major_outage", maintenance:"under_maintenance",
    };
    let status = indicatorMap[indicator] ?? "unknown";
    const components = (Array.isArray(raw.components) ? raw.components : [])
      .filter((c: any) => c && typeof c.name === "string")
      .map((c: any) => ({
        name:c.name, status:String(c.status ?? "unknown"),
        status_label:labels[String(c.status ?? "unknown")] ?? "نامشخص",
        updated_at:c.updated_at ?? null,
      }));
    for (const component of components) {
      if ((severity[component.status] ?? 0) > (severity[status] ?? 0)) status = component.status;
    }
    const incidents = (Array.isArray(raw.incidents) ? raw.incidents : []).slice(0,8).map((incident: any) => {
      const update = incident.incident_updates?.[0] ?? {};
      return {
        name:incident.name ?? "رخداد اعلام‌شده", status:incident.status ?? "unknown",
        impact:incident.impact ?? "نامشخص", updated_at:update.updated_at ?? incident.updated_at ?? null,
        body:String(update.body ?? "").slice(0,360),
        url:incident.shortlink ?? p.url,
      };
    });
    const affected = components.filter((c: any) => c.name.includes(" - (") && c.status !== "operational");
    return {
      ...p, status, status_label:labels[status] ?? "نامشخص",
      summary:String(raw.status?.description ?? "").slice(0,240),
      provider_updated_at:raw.page?.updated_at ?? null, checked_at:checkedAt,
      component_count:components.length,
      components_attention:components.filter((c: any) => c.status !== "operational").length,
      data_center_count:components.filter((c: any) => c.name.includes(" - (")).length,
      affected_locations:affected.slice(0,30), incidents,
      technical_components:components.slice(0,80), available:true,
    };
  } catch (_error) {
    return {
      ...p, status:"unknown", status_label:"نامشخص",
      summary:"وضعیت از صفحهٔ رسمی دریافت نشد.", provider_updated_at:null,
      checked_at:checkedAt, component_count:0, components_attention:0,
      data_center_count:0, affected_locations:[], incidents:[],
      technical_components:[], available:false,
    };
  }
}
async function fetchGoogleCloud() {
  const p = { id:"google-cloud", name:"Google Cloud و Vertex AI", group:"infrastructure",
    description:"زیرساخت ابری گوگل و بخشی از سرویس‌های هوش مصنوعی آن.",
    url:"https://status.cloud.google.com/" };
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch("https://status.cloud.google.com/incidents.json", {
      headers:{Accept:"application/json"}, signal:AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("google_status_http");
    const raw = await response.json();
    const active = (Array.isArray(raw) ? raw : []).filter((x:any)=>!x.end);
    const incidents = active.slice(0,8).map((x:any)=>({
      name:x.external_desc ?? x.service_name ?? "رخداد اعلام‌شده",
      status:"active", impact:"در حال بررسی",
      updated_at:x.updates?.at(-1)?.created ?? x.modified ?? null,
      body:String(x.updates?.at(-1)?.text ?? "").slice(0,360), url:p.url,
    }));
    return {...p,status:active.length?"degraded_performance":"operational",
      status_label:active.length?"اختلال اعلام‌شده":"بدون رخداد فعال اعلام‌شده",
      summary:active.length?`${active.length} رخداد فعال`:"در فهرست رسمی رخداد فعالی اعلام نشده است.",
      provider_updated_at:null,checked_at:checkedAt,component_count:0,
      components_attention:active.length,data_center_count:0,affected_locations:[],
      incidents,technical_components:[],available:true};
  } catch (_error) {
    return {...p,status:"unknown",status_label:"نامشخص",
      summary:"وضعیت از فهرست رسمی رخدادها دریافت نشد.",provider_updated_at:null,
      checked_at:checkedAt,component_count:0,components_attention:0,
      data_center_count:0,affected_locations:[],incidents:[],technical_components:[],available:false};
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return Response.json({error:"method_not_allowed"},{status:405});
  const started = new Date();
  try {
    if (!PROJECT_URL.startsWith("https://")) throw new Error("project_url_unavailable");
    const supplied = request.headers.get("x-netguard-token") ?? "";
    if (supplied.length < 40) return Response.json({error:"unauthorized"},{status:401});
    const key = getServiceKey();
    const credResponse = await db(key,"GET",undefined,"?select=token_hash&name=eq.ioda_collector&limit=1");
    const credentials = await credResponse.json();
    const expected = Array.isArray(credentials) ? credentials[0]?.token_hash : null;
    if (typeof expected !== "string" || !equal(await sha256(supplied),expected)) {
      return Response.json({error:"unauthorized"},{status:401});
    }
    const results = await Promise.all([...PROVIDERS.map(fetchProvider),fetchGoogleCloud()]);
    results.sort((a:any,b:any)=>a.name.localeCompare(b.name));
    const failed = results.filter((p:any)=>!p.available).length;
    const payload = {
      providers:results, checked_at:new Date().toISOString(),
      scope_note:"این اطلاعات از صفحه‌های رسمی جهانی شرکت‌ها گرفته شده و دسترسی از داخل ایران را ثابت نمی‌کند. تعداد مراکز فقط برای شرکت‌هایی نمایش داده می‌شود که اجزای مکانی را منتشر می‌کنند.",
      cache_seconds:600,
    };
    await db(key,"POST",{
      dataset_key:"providers_status",payload,collected_at:new Date().toISOString(),
      status:failed===0?"success":failed===results.length?"error":"partial",
      source_count:results.length,error_code:failed? `${failed}_provider_sources_unavailable`:null,
    },"?on_conflict=dataset_key");
    return Response.json({status:failed===0?"success":"partial",provider_count:results.length,
      unavailable_count:failed,started_at:started.toISOString(),finished_at:new Date().toISOString()});
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0,160) : "collector_error";
    console.error(code);
    return Response.json({error:"provider_collection_failed",code},{status:500});
  }
});
