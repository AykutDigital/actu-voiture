// Relevé quotidien des annonces voitures Leboncoin, lancé par GitHub Actions une fois par jour.
// Ce robot ne contourne rien : il s'annonce avec son propre User-Agent et ne fonctionne que si
// Leboncoin l'a mis en liste blanche (DataDome). S'il est bloqué, il s'arrête et l'écrit dans deals.json.
import { writeFile } from "node:fs/promises";
import { parseListing, analyze } from "../analyzer.js";

const BUDGET = +process.env.BUDGET || 20000;
const KM_MAX = +process.env.KM_MAX || 150000;
const PAGES = Math.min(+process.env.PAGES || 2, 5);
const UA = process.env.LBC_USER_AGENT || "BonPlanAuto/1.0 (+https://github.com/AykutDigital/actu-voiture)";
const OUT = new URL("../deals.json", import.meta.url);

const searchUrl = (page) => {
  const u = new URL("https://www.leboncoin.fr/recherche");
  u.search = new URLSearchParams({ category: "2", price: `min-${BUDGET}`, mileage: `min-${KM_MAX}`, sort: "time", order: "desc", ...(page > 1 && { page }) });
  return u.href;
};

// Même texte que le bouton « Analyser » : l'analyse locale le lit comme une annonce collée.
function adText(ad) {
  const a = {};
  for (const x of ad.attributes || []) a[x.key] = x.value_label || x.value;
  return [
    [a.brand, a.model].filter(Boolean).join(" "),
    a.regdate && "Année " + a.regdate,
    a.mileage && String(a.mileage).replace(/\D/g, "") + " km",
    ad.price?.[0] && ad.price[0] + " €",
    a.fuel, a.gearbox,
    ad.owner?.type === "pro" ? "Professionnel" : "Particulier",
    ad.subject,
    (ad.body || "").slice(0, 1500),
    ad.url,
  ].filter(Boolean).join("\n");
}

async function fetchPage(page) {
  const res = await fetch(searchUrl(page), { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" } });
  if (res.status === 403)
    throw Object.assign(new Error(`Leboncoin a bloqué le robot (HTTP ${res.status}). Il n'est pas encore en liste blanche.`), { blocked: true });
  if (!res.ok) throw new Error(`Leboncoin a répondu HTTP ${res.status}.`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw Object.assign(new Error("Page reçue sans annonces (probablement une page de vérification anti-robot)."), { blocked: true });
  return JSON.parse(m[1]).props?.pageProps?.searchData?.ads || [];
}

async function main() {
  const out = { updated: new Date().toISOString(), budget: BUDGET, kmMax: KM_MAX, status: "ok", message: "", seen: 0, deals: [] };
  const ads = [];
  try {
    for (let p = 1; p <= PAGES; p++) {
      if (p > 1) await new Promise((r) => setTimeout(r, 5000)); // pas de rafale
      const got = await fetchPage(p);
      ads.push(...got);
      if (!got.length) break;
    }
  } catch (e) {
    out.status = e.blocked ? "bloque" : "erreur";
    out.message = e.message;
    console.log(`::warning::${e.message}`);
  }

  out.seen = ads.length;
  for (const ad of ads) {
    const text = adText(ad);
    const r = analyze(parseListing(text), BUDGET);
    if (!r.verdict || !["top", "good", "suspect"].includes(r.verdict.key) || r.listing.price > BUDGET) continue;
    out.deals.push({
      id: ad.list_id, url: ad.url, title: ad.subject, city: ad.location?.city || null,
      thumb: ad.images?.thumb_url || ad.images?.small_url || null, date: ad.first_publication_date || null,
      price: r.listing.price, year: r.listing.year ?? null, km: r.listing.km ?? null,
      cote: r.est.value, gap: Math.round(r.gap * 100), saving: r.saving,
      verdict: r.verdict.label, tone: r.verdict.tone, scam: r.scamLevel, reasons: r.reasons.slice(0, 2), text,
    });
  }
  out.deals.sort((a, b) => a.gap - b.gap);
  if (out.status === "ok") out.message = `${out.seen} annonces relevées, ${out.deals.length} bonnes affaires.`;
  await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
  console.log(out.message);
}

main();
