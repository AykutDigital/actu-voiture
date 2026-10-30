import { MODELS, SEGMENTS } from "./data.js";
import { parseListing, analyze, oneLiner, fmtEur, fmtKm } from "./analyzer.js";
import { searchLinks, smartPicks } from "./radar.js";
import { bookmarkletHref } from "./bookmarklet.js";
import { setupInstall } from "./install.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Stockage local : préférences et favoris de ce téléphone uniquement.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const settings = () => ({ budget: 20000, key: "", ...store.get("settings", {}) });

// ---------- Onglets ----------
function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${name}`));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "saved") renderSaved();
  if (name === "radar") { renderRadar(); renderDaily(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

// ---------- Formulaire ----------
const sorted = MODELS.map((m, i) => ({ m, i })).sort((a, b) => (a.m.make + a.m.model).localeCompare(b.m.make + b.m.model));
$("#f-model").innerHTML = `<option value="">— choisir —</option>` + sorted.map(({ m, i }) => `<option value="${i}">${esc(m.make)} ${esc(m.model)}</option>`).join("");

function fillForm(p) {
  if (p.modelId != null) $("#f-model").value = p.modelId;
  if (p.price) $("#f-price").value = p.price;
  if (p.year) $("#f-year").value = p.year;
  if (p.km != null) $("#f-km").value = p.km;
  if (p.fuel) $("#f-fuel").value = p.fuel;
}
// Dès qu'on a le modèle, l'année et le prix, l'analyse se lance sans appuyer sur le bouton.
let autoTimer, lastLookup;
function onRawChange() {
  const raw = $("#raw").value;
  const p = parseListing(raw);
  fillForm(p);
  clearTimeout(autoTimer);
  if (isBareLink(raw)) {
    $("#result").innerHTML = linkOnlyNotice(p.url);
    $("#result [data-lookup]")?.addEventListener("click", () => lookupLink(p.url));
    // Avec une clé, la recherche part toute seule (une seule fois par lien, après la fin de la saisie).
    if (p.url && settings().key && p.url !== lastLookup) autoTimer = setTimeout(() => { lastLookup = p.url; lookupLink(p.url); }, 700);
    return;
  }
  if (p.modelId != null && p.year && p.price) autoTimer = setTimeout(runAnalysis, 400);
}
$("#raw").addEventListener("input", onRawChange);
$("#pasteBtn").addEventListener("click", async () => {
  try { $("#raw").value = await navigator.clipboard.readText(); onRawChange(); }
  catch { $("#raw").focus(); }
});

// Un lien seul ne contient pas les infos : les sites d'annonces bloquent la lecture automatique.
const isBareLink = (raw) => /https?:\/\//.test(raw) && raw.trim().length < 300 && !/\d[\d\s.]*\s?(€|km)/i.test(raw);
function linkOnlyNotice(url) {
  const hasKey = !!settings().key;
  return `<article class="card"><h3>Lien détecté</h3>
    <p class="small">${hasKey
      ? "Claude va lire l'annonce pour toi…"
      : "Avec une clé API Claude (Réglages), Claude peut lire l'annonce à partir du lien."}</p>
    <div class="actions">
      ${hasKey ? "" : `<button class="btn small" data-lookup type="button">Chercher l'annonce</button>`}
      ${url ? `<a class="btn ghost small" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir l'annonce</a>` : ""}
    </div></article>`;
}

const LABELS = { annee: "année", km: "kilométrage", prix: "prix", modele: "modèle" };
async function lookupLink(url) {
  const { key } = settings();
  if (!key) { showTab("settings"); $("#settingsMsg").textContent = "Ajoute une clé API pour chercher une annonce à partir de son lien."; return; }
  $("#result").innerHTML = `<article class="card"><p class="small">🔎 Lecture de l'annonce… (10 à 30 s)</p></article>`;
  try {
    const { aiLookupLink } = await import("./ai.js");
    const ad = await aiLookupLink(key, url);
    if ($("#raw").value.trim() !== url && !$("#raw").value.includes(url)) return; // l'utilisateur a changé de saisie entre-temps
    if (!ad.trouve || !ad.prix) {
      $("#result").innerHTML = `<article class="card"><h3>Annonce introuvable dans les moteurs de recherche</h3>
        <p class="small">Elle est sans doute trop récente pour avoir été indexée. Ouvre-la et utilise le bouton <b>Analyser</b> (installation plus bas), ou copie son texte ici.</p>
        <a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir l'annonce</a></article>`;
      return;
    }
    const lines = [
      [ad.marque, ad.modele].filter(Boolean).join(" "),
      ad.annee && `Année ${ad.annee}`,
      ad.km != null && `${ad.km} km`,
      `${ad.prix} €`,
      ad.carburant, ad.boite, ad.vendeur, ad.ville, ad.titre, ad.extrait,
      url,
    ].filter(Boolean);
    $("#raw").value = lines.join("\n");
    fillForm(parseListing($("#raw").value));
    runAnalysis();
    const missing = ["modele", "annee", "km"].filter((k) => ad[k] == null).map((k) => LABELS[k]);
    $("#result").insertAdjacentHTML("afterbegin", `<p class="note small">Infos lues par l'IA à partir du lien${missing.length
      ? ` · <b>non trouvé : ${missing.join(", ")}</b>. Complète ces champs au-dessus puis touche « Analyser ».`
      : "."}</p>`);
  } catch (err) {
    const msg = err.status === 401 ? "clé API invalide (vérifie-la dans Réglages)" : err.status === 429 ? "trop de demandes, réessaie dans une minute" : err.message;
    $("#result").innerHTML = `<article class="card"><p class="alert">Recherche impossible : ${esc(msg)}</p>
      <a class="btn small" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir l'annonce</a></article>`;
  }
}

function readForm() {
  const raw = $("#raw").value;
  const p = parseListing(raw);
  const num = (id) => ($(id).value === "" ? undefined : +$(id).value);
  return {
    ...p,
    modelId: $("#f-model").value === "" ? p.modelId : +$("#f-model").value,
    price: num("#f-price") ?? p.price,
    year: num("#f-year") ?? p.year,
    km: num("#f-km") ?? p.km,
    fuel: $("#f-fuel").value || p.fuel,
    engine: $("#f-engine").value,
  };
}

let current = null;
function runAnalysis() {
  current = analyze(readForm(), settings().budget);
  $("#result").innerHTML = renderResult(current);
  bindResult();
  $("#result").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("#analyseBtn").addEventListener("click", runAnalysis);

// ---------- Fiche résultat ----------
function renderResult(r, { saved = false } = {}) {
  const v = r.verdict;
  const l = r.listing;
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  return `
  <article class="card result">
    <div class="verdict ${v ? v.tone : "neutral"}">${esc(v ? v.label : "Infos manquantes")}</div>
    <p class="lead">${esc(oneLiner(r))}</p>
    ${r.est && l.price ? `
    <div class="stats">
      <div><b>${fmtEur(l.price)}</b><span>Prix demandé</span></div>
      <div><b>${fmtEur(r.est.value)}</b><span>Cote estimée</span></div>
      <div><b class="${r.saving > 0 ? "pos" : "neg"}">${r.saving > 0 ? "−" : "+"}${fmtEur(Math.abs(r.saving))}</b><span>Écart</span></div>
    </div>
    <div class="gauge" role="img" aria-label="Position du prix dans la fourchette de cote">
      <div class="gauge-bar"></div>
      <div class="gauge-mark" style="left:${gaugePos(l.price, r.est)}%"></div>
      <div class="gauge-labels"><span>${fmtEur(r.est.low)}</span><span>${fmtEur(r.est.high)}</span></div>
    </div>` : ""}
    ${r.overBudget ? `<p class="alert">Au-dessus de ton budget de ${fmtEur(settings().budget)}.</p>` : ""}
    ${r.scamLevel !== "faible" ? `<p class="alert">Risque d'arnaque <b>${r.scamLevel}</b> : ne verse jamais d'acompte, ne paie pas par mandat cash ou coupon, ne te fais pas livrer sans avoir vu la voiture.</p>` : ""}

    <h3>Pourquoi c'est moins cher</h3>
    <ul>${li(r.reasons.length ? r.reasons : ["Rien d'anormal détecté dans l'annonce."])}</ul>

    <h3>Risques mécaniques</h3>
    ${r.risks.length ? `<ul>${r.risks.map((k) => `<li><b>${esc(k.title)}</b>${k.check ? `<br><span class="muted">À vérifier : ${esc(k.check)}</span>` : ""}</li>`).join("")}</ul>
      <p class="muted small">Budget réparations à garder de côté : ${fmtEur(r.repair[0])} à ${fmtEur(r.repair[1])}.</p>`
      : `<p class="muted">Aucun point faible connu pour ce qui est indiqué (précise le moteur pour affiner).</p>`}

    ${l.price ? `<h3>Négociation</h3><p>Propose <b>${fmtEur(r.target)}</b> en t'appuyant sur ${r.risks.length ? "les frais à prévoir et " : ""}la cote.</p>` : ""}

    <h3>Plan d'achat sécurisé</h3>
    <ol class="plan">${r.plan.map(([t, s]) => `<li><span class="time">${esc(t)}</span>${esc(s)}</li>`).join("")}</ol>

    <div class="ai" data-ai>${r.ai ? renderAi(r.ai) : ""}</div>
    <div class="actions">
      ${saved ? "" : `<button class="btn" data-save type="button">⭐ Garder</button>`}
      ${r.ai ? "" : `<button class="btn ghost" data-ai-btn type="button">Avis détaillé IA</button>`}
      ${l.url ? `<a class="btn ghost" href="${esc(l.url)}" target="_blank" rel="noopener">Voir l'annonce</a>` : ""}
    </div>
  </article>`;
}

function gaugePos(price, est) {
  const span = est.high - est.low;
  const lo = est.low - span, hi = est.high + span; // la jauge couvre la fourchette ± sa largeur
  return Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100)).toFixed(1);
}

function renderAi(a) {
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join("");
  return `<h3>Avis IA : ${esc(a.verdict)}</h3>
    <p>${esc(a.resume)}</p>
    <h4>Pourquoi ce prix</h4><ul>${li(a.pourquoi_moins_cher)}</ul>
    <h4>À vérifier</h4><ul>${li(a.points_a_verifier)}</ul>
    <h4>Risques mécaniques</h4><ul>${li(a.risques_mecaniques)}</ul>
    <p class="small"><b>Réparations probables :</b> ${esc(a.cout_reparations_probable)}<br><b>Prix à proposer :</b> ${fmtEur(a.prix_cible)} · <b>Risque d'arnaque :</b> ${esc(a.risque_arnaque)}</p>`;
}

function bindResult() {
  const root = $("#result");
  root.querySelector("[data-save]")?.addEventListener("click", (e) => {
    const list = store.get("saved", []);
    list.unshift({ id: Date.now(), at: new Date().toISOString(), listing: current.listing, ai: current.ai || null });
    store.set("saved", list.slice(0, 100));
    e.target.textContent = "✓ Gardée";
    e.target.disabled = true;
  });
  root.querySelector("[data-ai-btn]")?.addEventListener("click", (e) => runAi(e.target));
}

async function runAi(btn) {
  const { key } = settings();
  if (!key) { showTab("settings"); $("#settingsMsg").textContent = "Ajoute une clé API pour utiliser l'avis IA."; return; }
  btn.disabled = true;
  btn.textContent = "Analyse en cours…";
  try {
    const { aiAnalyze } = await import("./ai.js");
    const local = `${oneLiner(current)}\nRaisons détectées : ${current.reasons.join(" ")}\nRisques détectés : ${current.risks.map((r) => r.title).join(" ; ")}`;
    const text = current.listing.raw || JSON.stringify({ modele: current.model && `${current.model.make} ${current.model.model}`, ...current.listing });
    current.ai = await aiAnalyze(key, text, local);
    $("#result [data-ai]").innerHTML = renderAi(current.ai);
    btn.remove();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Réessayer l'avis IA";
    const msg = err.status === 401 ? "clé API invalide (vérifie-la dans Réglages)" : err.status === 429 ? "trop de demandes, réessaie dans une minute" : err.message;
    $("#result [data-ai]").innerHTML = `<p class="alert">Échec de l'avis IA : ${esc(msg)}</p>`;
  }
}

// ---------- Radar ----------
$("#r-seg").innerHTML = SEGMENTS.map((s) => `<option>${s}</option>`).join("");
$("#r-seg").addEventListener("change", renderRadar);
$("#r-km").addEventListener("change", renderRadar);

function renderRadar() {
  const budget = settings().budget;
  const kmMax = +$("#r-km").value || 150000;
  const seg = $("#r-seg").value || "Tous";
  $("#r-links").innerHTML = `<p class="small muted">Toutes les annonces de moins de ${fmtEur(budget)} et ${fmtKm(kmMax)} :</p>` +
    searchLinks({ budget, kmMax }).map(([n, u]) => `<a class="btn ghost small" href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join("");
  const picks = smartPicks({ budget, seg, fuel: "" }).slice(0, 25);
  $("#picks").innerHTML = `<h2 class="section-title">Modèles malins pour ${fmtEur(budget)}</h2>` + picks.map((p) => `
    <article class="card pick">
      <div class="pick-head">
        <div><b>${esc(p.m.make)} ${esc(p.m.model)}</b><span class="tag">${esc(p.m.seg)}</span></div>
        <span class="stars" aria-label="Fiabilité ${p.m.fiab} sur 5">${"★".repeat(p.m.fiab)}${"☆".repeat(5 - p.m.fiab)}</span>
      </div>
      <p class="small">Vise une <b>${p.year}</b> avec environ ${fmtKm(p.km)} : cote ≈ ${fmtEur(p.price)}. Une annonce sous <b>${fmtEur(Math.round((p.price * 0.88) / 100) * 100)}</b> est une bonne affaire.</p>
      <div class="links">${searchLinks({ budget, kmMax, make: p.m.make, model: p.m.model }).map(([n, u]) => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`).join("")}</div>
    </article>`).join("");
}

// ---------- Affaires du jour (relevé automatique fait chaque matin par GitHub Actions) ----------
async function renderDaily() {
  const box = $("#daily");
  let d;
  try { d = await (await fetch("deals.json", { cache: "no-cache" })).json(); } catch { box.innerHTML = ""; return; }
  const when = d.updated ? new Date(d.updated).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
  const head = `<div class="card"><h2>Affaires du jour</h2><p class="small muted">${esc(d.message)}${when ? ` · relevé du ${when}` : ""}</p></div>`;
  box.innerHTML = head + (d.deals || []).slice(0, 20).map((x, i) => `
    <article class="card pick">
      <div class="pick-head">
        <div><span class="dot ${x.tone}"></span> <b>${esc(x.title)}</b></div>
        <b>${fmtEur(x.price)}</b>
      </div>
      <p class="small">${esc(x.verdict)} : ${Math.abs(x.gap)} % sous la cote (≈ ${fmtEur(x.cote)}). ${[x.year, x.km != null && fmtKm(x.km), x.city].filter(Boolean).map(esc).join(" · ")}${x.scam !== "faible" ? ` · <b>risque d'arnaque ${esc(x.scam)}</b>` : ""}</p>
      ${x.reasons?.[0] ? `<p class="small muted">${esc(x.reasons[0])}</p>` : ""}
      <div class="links"><button class="chip" data-deal="${i}" type="button">Fiche complète</button><a class="chip" href="${esc(x.url)}" target="_blank" rel="noopener">Voir l'annonce</a></div>
    </article>`).join("");
  box.querySelectorAll("[data-deal]").forEach((b) => b.addEventListener("click", () => {
    $("#raw").value = d.deals[+b.dataset.deal].text;
    showTab("analyse");
    onRawChange();
    clearTimeout(autoTimer);
    runAnalysis();
  }));
}

// ---------- Favoris ----------
function renderSaved() {
  const list = store.get("saved", []);
  const box = $("#savedList");
  if (!list.length) { box.innerHTML = `<p class="muted center">Aucune annonce gardée pour l'instant.</p>`; return; }
  box.innerHTML = list.map((s) => {
    const r = analyze(s.listing, settings().budget);
    r.ai = s.ai;
    return `<details class="card saved"><summary><span class="dot ${r.verdict?.tone || "neutral"}"></span>${esc(oneLiner(r))}</summary>
      <div class="saved-body">${renderResult(r, { saved: true })}</div>
      <button class="btn ghost small" data-del="${s.id}" type="button">Supprimer</button></details>`;
  }).join("");
  box.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    store.set("saved", store.get("saved", []).filter((s) => String(s.id) !== b.dataset.del));
    renderSaved();
  }));
}

// ---------- Réglages ----------
function loadSettings() {
  const s = settings();
  $("#s-budget").value = s.budget;
  $("#s-key").value = s.key;
  $("#budgetPill").textContent = `Budget ${fmtEur(s.budget)}`;
}
$("#saveSettings").addEventListener("click", () => {
  store.set("settings", { budget: +$("#s-budget").value || 20000, key: $("#s-key").value.trim() });
  loadSettings();
  $("#settingsMsg").textContent = "Enregistré.";
});
loadSettings();

// ---------- Partage depuis une autre appli (Leboncoin → Partager → Bon Plan Auto) ----------
const params = new URLSearchParams(location.search);
const shared = ["title", "text", "url"].map((k) => params.get(k)).filter(Boolean).join("\n");
if (shared) {
  $("#raw").value = shared;
  history.replaceState(null, "", location.pathname);
  onRawChange();
  if (!isBareLink(shared)) { clearTimeout(autoTimer); runAnalysis(); }
}

// Bouton favori « Analyser », pointant vers l'adresse où l'appli est hébergée
const bm = bookmarkletHref(location.origin + location.pathname);
$("#bmLink").href = bm;
$("#bmLink").addEventListener("click", (e) => e.preventDefault());
$("#bmCopy").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText(bm); e.target.textContent = "✓ Code copié"; }
  catch { prompt("Copie ce code :", bm); }
});

if (params.get("tab")) showTab(params.get("tab")); // ouverture depuis la notification

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---------- Installation ----------
setupInstall($("#installBtn"), $("#installHint"));

// ---------- Rappel quotidien ----------
async function enableReminder() {
  const msg = $("#remindMsg");
  if (!("Notification" in window) || !("serviceWorker" in navigator)) { msg.textContent = "Ce navigateur ne gère pas les notifications."; return; }
  if ((await Notification.requestPermission()) !== "granted") { msg.textContent = "Notifications refusées : autorise-les dans les réglages du navigateur pour ce site."; return; }
  const reg = await navigator.serviceWorker.ready;
  if (!("periodicSync" in reg)) {
    msg.innerHTML = "Ce navigateur ne permet pas les rappels automatiques. Sur Android, <b>installe l'appli depuis Chrome</b> puis réactive le rappel.";
    return;
  }
  try {
    await reg.periodicSync.register("rappel-annonces", { minInterval: 24 * 60 * 60 * 1000 });
    msg.textContent = "✓ Rappel activé : environ une fois par jour, entre 8 h et 21 h (Android choisit l'heure exacte).";
    renderReminder();
  } catch {
    msg.innerHTML = "Le rappel n'a pas pu être activé : l'appli doit être <b>installée</b> (bouton Installer ci-dessus).";
  }
}
async function renderReminder() {
  let on = false;
  try { on = (await (await navigator.serviceWorker.ready).periodicSync?.getTags())?.includes("rappel-annonces"); } catch {}
  $("#remindOn").textContent = on ? "✓ Rappel activé" : "Activer le rappel";
  $("#remindOn").disabled = on;
}
$("#remindOn").addEventListener("click", enableReminder);
$("#remindTest").addEventListener("click", async () => {
  if ((await Notification.requestPermission()) !== "granted") { $("#remindMsg").textContent = "Autorise les notifications pour tester."; return; }
  (await navigator.serviceWorker.ready).active.postMessage("test-reminder");
  $("#remindMsg").textContent = "Notification de test envoyée.";
});
if ("serviceWorker" in navigator) renderReminder();
