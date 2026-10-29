import { MODELS } from "./data.js";
import { estimateValue } from "./analyzer.js";

const YEAR_NOW = new Date().getFullYear();
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Liens de recherche pré-remplis : c'est ton navigateur qui ouvre le site, comme si tu cherchais toi-même.
export function searchLinks({ budget, kmMax, make, model }) {
  const q = make ? `${make} ${model}` : "";
  const lbc = new URL("https://www.leboncoin.fr/recherche");
  lbc.search = new URLSearchParams({ category: "2", price: `min-${budget}`, mileage: `min-${kmMax}`, sort: "time", order: "desc", ...(q && { text: q }) });
  const as24 = new URL(`https://www.autoscout24.fr/lst${make ? `/${slug(make)}/${slug(model)}` : ""}`);
  as24.search = new URLSearchParams({ atype: "C", cy: "F", priceto: budget, kmto: kmMax, sort: "age", desc: "1" });
  const lc = new URL("https://www.lacentrale.fr/listing");
  lc.search = new URLSearchParams({ priceMax: budget, mileageMax: kmMax, ...(make && { makesModelsCommercialNames: `${make.toUpperCase()}:${model.toUpperCase()}` }) });
  return [
    ["Leboncoin", lbc.href],
    ["La Centrale", lc.href],
    ["AutoScout24", as24.href],
  ];
}

// Pour chaque modèle : l'année la plus récente qu'on peut viser avec le budget, au kilométrage moyen.
export function smartPicks({ budget, seg, fuel }) {
  const seen = new Set();
  return MODELS
    .filter((m) => (seg === "Tous" || m.seg === seg) && (fuel !== "Électrique" || m.ev) && !seen.has(m.make + m.model) && seen.add(m.make + m.model))
    .map((m) => {
      for (let year = YEAR_NOW - 1; year >= YEAR_NOW - 15; year--) {
        const age = YEAR_NOW - year;
        const est = estimateValue({ modelId: MODELS.indexOf(m), year, km: age * 15000, fuel });
        if (est && est.value <= budget) return { m, year, km: age * 15000, price: est.value, score: m.fiab * 2 + m.ret * 2 - age * 0.4 };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}
