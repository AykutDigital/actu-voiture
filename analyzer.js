import { MODELS, KNOWN_ISSUES, EV_ISSUE, REASON_HINTS, SCAM_HINTS } from "./data.js";

const YEAR_NOW = new Date().getFullYear();
const norm = (s) => " " + s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + " ";
const toInt = (s) => parseInt(String(s).replace(/[^\d]/g, ""), 10);

// Lit une annonce collée (texte brut) et en extrait les champs principaux.
export function parseListing(raw) {
  const text = raw || "";
  const n = norm(text);
  const out = { raw: text };

  // Le modèle dont le mot-clé est le plus long l'emporte (« c3 aircross » avant « c3 »).
  let best = null;
  for (const m of MODELS) {
    for (const k of m.keys) {
      const kk = norm(k).trim();
      if (kk && n.includes(kk) && (!best || kk.length > best.len)) best = { m, len: kk.length };
    }
  }
  if (best) out.modelId = MODELS.indexOf(best.m);

  const prices = [...text.matchAll(/(?<!\d)(\d{1,3}(?:[\s .]\d{3})+|\d{4,6})\s?(?:€|eur|euros)/gi)]
    .map((x) => toInt(x[1])).filter((p) => p >= 500 && p <= 200000);
  if (prices.length) out.price = prices[0];

  const km = text.match(/(?<!\d)(\d{1,3}(?:[\s .]\d{3})+|\d{3,7})\s?km/i);
  if (km) out.km = toInt(km[1]);

  const years = [...text.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((x) => +x[1]).filter((y) => y <= YEAR_NOW);
  // Une année précédée de « Année » ou « mise en circulation » est plus fiable que la première trouvée.
  const labelled = text.match(/(?:ann[ée]e(?:[\s-]mod[èe]le)?|mise en circulation)[^\d]{0,25}(?:\d{2}\/)?(19[89]\d|20[0-3]\d)\b/i);
  if (labelled && +labelled[1] <= YEAR_NOW) out.year = +labelled[1];
  else if (years.length) out.year = years[0];

  if (/[ée]lectrique|100 ?% ?[ée]lec|\bev\b/i.test(text)) out.fuel = "Électrique";
  else if (/hybride|hybrid/i.test(text)) out.fuel = "Hybride";
  else if (/diesel|gazole|hdi|dci|tdi|crdi|multijet|bluehdi/i.test(text)) out.fuel = "Diesel";
  else if (/essence|tce|puretech|tsi|vti|ecoboost/i.test(text)) out.fuel = "Essence";
  else if (/gpl/i.test(text)) out.fuel = "GPL";

  if (/automatique|\bauto\b|\bbva\b|\beat ?\d|\bedc\b|\bdsg\b|cvt/i.test(text)) out.gearbox = "Automatique";
  else if (/manuelle|\bbvm\b/i.test(text)) out.gearbox = "Manuelle";

  if (/particulier/i.test(text)) out.seller = "Particulier";
  else if (/professionnel|garage|concession|\bpro\b/i.test(text)) out.seller = "Professionnel";

  const url = text.match(/https?:\/\/\S+/);
  if (url) out.url = url[0];
  return out;
}

// Cote indicative : prix neuf × dépréciation par âge × correction kilométrage.
export function estimateValue({ modelId, year, km, fuel, raw = "" }) {
  const m = MODELS[modelId];
  if (!m || !year) return null;
  const age = Math.max(0, YEAR_NOW - year);
  // Année 1 : -15 %, puis environ -8 %/an jusqu'à 8 ans, -10 %/an ensuite (marché français 2024-2026).
  let v = m.neuf * (age === 0 ? 0.9 : 0.85 * Math.pow(0.92, Math.min(age - 1, 7)) * Math.pow(0.9, Math.max(0, age - 8)));
  v *= m.ret;
  if (m.ev) v *= 0.92; // les VE se déprécient plus vite (progrès des batteries)
  if (/batterie (en )?location|location (de la )?batterie/i.test(raw)) v *= 0.7; // loyer batterie en plus

  const expected = Math.max(1, age) * 15000;
  if (km != null) {
    const diff = (km - expected) / 10000; // par tranche de 10 000 km d'écart
    v *= Math.min(1.15, Math.max(0.6, 1 - diff * 0.025));
    if (km > 200000) v *= 0.85;
  }
  if (fuel === "Diesel" && year < 2011) v *= 0.85; // Crit'Air 3+, interdits en ZFE
  v = Math.max(v, m.neuf * 0.06, 800);
  return { value: Math.round(v / 50) * 50, low: Math.round(v * 0.87 / 50) * 50, high: Math.round(v * 1.13 / 50) * 50, expectedKm: expected };
}

const VERDICTS = [
  { max: -0.35, key: "suspect", label: "Trop beau pour être vrai", tone: "warn" },
  { max: -0.15, key: "top", label: "Excellente affaire", tone: "great" },
  { max: -0.07, key: "good", label: "Bonne affaire", tone: "good" },
  { max: 0.07, key: "fair", label: "Prix du marché", tone: "neutral" },
  { max: Infinity, key: "high", label: "Trop cher", tone: "bad" },
];

export function analyze(listing, budget = 20000) {
  const m = MODELS[listing.modelId];
  const est = estimateValue(listing);
  const txt = (listing.raw || "") + " " + (listing.engine || "");
  const res = { listing, model: m, est, reasons: [], risks: [], checks: [], scam: [], repair: [0, 0] };

  if (est && listing.price) {
    res.gap = (listing.price - est.value) / est.value;
    res.saving = est.value - listing.price;
    res.verdict = VERDICTS.find((v) => res.gap <= v.max);
  }

  // Pourquoi c'est moins cher ?
  for (const h of REASON_HINTS) if (h.re.test(txt)) res.reasons.push(h.txt);
  if (est && listing.km != null && listing.km > est.expectedKm * 1.3)
    res.reasons.push(`Kilométrage élevé pour l'âge (${fmtKm(listing.km)} contre ≈ ${fmtKm(est.expectedKm)} attendus).`);
  if (m && m.ret < 0.92) res.reasons.push(`Le modèle ${m.make} ${m.model} se revend mal en général : décote normale, pas forcément un piège.`);
  if (listing.gearbox === "Manuelle" && ["SUV", "Berline"].includes(m?.seg)) res.reasons.push("Boîte manuelle sur un modèle surtout recherché en automatique : moins de demande.");
  if (listing.seller === "Particulier") res.reasons.push("Vente entre particuliers : pas de marge de garage, mais pas de garantie légale de 12 mois.");
  if (!res.reasons.length && res.gap < -0.07) res.reasons.push("Aucune raison claire dans l'annonce : demande au vendeur pourquoi il vend et pourquoi ce prix.");

  // Problèmes connus et coût probable
  for (const k of KNOWN_ISSUES) if (k.re.test(txt)) addRisk(res, k);
  if (m?.ev || listing.fuel === "Électrique") addRisk(res, EV_ISSUE);
  if (m && m.fiab <= 2) res.risks.push({ title: `Fiabilité moyenne du ${m.model} : prévoir une garantie panne mécanique.`, check: "", cost: null });

  // Arnaque ?
  for (const re of SCAM_HINTS) if (re.test(txt)) res.scam.push(re.source);
  res.scamLevel = res.scam.length >= 2 || (res.verdict?.key === "suspect" && res.scam.length) ? "élevé" : res.scam.length || res.verdict?.key === "suspect" ? "moyen" : "faible";

  // Négociation
  if (listing.price) {
    const repairMid = (res.repair[0] + res.repair[1]) / 2;
    let target = listing.price - repairMid * 0.7;
    if (res.verdict?.key === "fair" || res.verdict?.key === "high") target = Math.min(target, (est?.value ?? listing.price) * 0.95);
    target = Math.min(target, listing.price * 0.97);
    res.target = Math.round(target / 100) * 100;
    res.overBudget = listing.price > budget;
  }

  // Plan d'achat, avec la durée de chaque étape
  res.plan = [
    ["5 min", "Histovec (via le vendeur) : propriétaires, sinistres, gages, statut VGE. Refuse si le vendeur refuse."],
    ["10 min", "Appel : raison de la vente, factures, carnet d'entretien, double des clés, CT de moins de 6 mois."],
    ["1 h", "Essai à froid : démarrage, voyants, fumée, embrayage, freins, clim, pneus. Compare le numéro VIN avec la carte grise."],
    ...(res.risks.length ? [["1 jour", "Contrôle par un mécanicien ou expert indépendant (≈ 100-200 €) sur les points à risque ci-dessous."]] : []),
    ["30 min", "Paiement sécurisé : virement instantané ou chèque de banque vérifié auprès de la banque émettrice. Jamais d'acompte à distance."],
    ["2-7 jours", "Certificat de cession + déclaration de cession sur ANTS, puis carte grise à ton nom (1 mois maximum)."],
  ];
  return res;
}

function addRisk(res, k) {
  res.risks.push(k);
  if (k.cost) { res.repair[0] += k.cost[0] * 0.3; res.repair[1] += k.cost[1] * 0.6; }
  res.repair = res.repair.map((x) => Math.round(x / 50) * 50);
}

export const fmtEur = (n) => (n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("fr-FR") + " €");
export const fmtKm = (n) => (n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("fr-FR") + " km");

// Résumé en une phrase
export function oneLiner(r) {
  const l = r.listing, m = r.model;
  const name = m ? `${m.make} ${m.model}` : "Ce véhicule";
  if (!r.est || !l.price) return `${name} : renseigne le modèle, l'année, le kilométrage et le prix pour obtenir la cote.`;
  const pct = Math.abs(Math.round(r.gap * 100));
  const dir = r.gap < 0 ? `${pct} % sous la cote` : `${pct} % au-dessus de la cote`;
  return `${name} ${l.year}${l.km != null ? `, ${fmtKm(l.km)}` : ""} à ${fmtEur(l.price)}, soit ${dir} (≈ ${fmtEur(r.est.value)}).`;
}
