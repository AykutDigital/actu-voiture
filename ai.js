// Analyse IA optionnelle : la clé API reste sur le téléphone (localStorage) et
// part directement vers api.anthropic.com, sans serveur intermédiaire.
import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.134.0/+esm";

const list = { type: "array", items: { type: "string" } };
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resume", "pourquoi_moins_cher", "points_a_verifier", "risques_mecaniques", "cout_reparations_probable", "prix_cible", "verdict", "risque_arnaque"],
  properties: {
    resume: { type: "string" },
    pourquoi_moins_cher: list,
    points_a_verifier: list,
    risques_mecaniques: list,
    cout_reparations_probable: { type: "string" },
    prix_cible: { type: "integer" },
    verdict: { type: "string", enum: ["Excellente affaire", "Bonne affaire", "Prix du marché", "Trop cher", "Suspect"] },
    risque_arnaque: { type: "string", enum: ["faible", "moyen", "élevé"] },
  },
};

const SYSTEM = `Tu es un expert automobile français qui aide un acheteur avec un budget de 20 000 € à repérer les vraies bonnes affaires d'occasion.
On te donne le texte d'une annonce et une cote estimée calculée localement (indicative, ±15 %).
Réponds en français simple et concis : phrases courtes, compréhensibles par quelqu'un qui n'est pas mécanicien.
- resume : 2 phrases maximum (le véhicule, son prix par rapport au marché, ton avis).
- pourquoi_moins_cher : les raisons probables du prix (vendeur pressé, défaut, kilométrage, modèle qui se revend mal…). Distingue ce qui est écrit dans l'annonce de ce que tu supposes.
- points_a_verifier : actions concrètes avant d'acheter, du plus important au moins important.
- risques_mecaniques : problèmes connus pour ce modèle et ce moteur à ces années.
- cout_reparations_probable : une fourchette en € avec ce qu'elle couvre.
- prix_cible : le prix à proposer au vendeur, en €.
Si l'annonce ne contient pas assez d'informations, dis-le plutôt que d'inventer.`;

const LOOKUP_SYSTEM = `Tu retrouves les informations d'une annonce de voiture d'occasion à partir de son lien.
Si l'outil web_fetch est disponible, lis d'abord directement la page du lien. Si la lecture échoue ou si l'outil n'est pas disponible, utilise la recherche web (ce que les moteurs de recherche ont indexé : titre, prix, extrait).
Règles :
- Ne devine jamais : un champ que tu n'as pas trouvé dans les résultats vaut null.
- Ne confonds pas avec une autre annonce : ne garde que les résultats qui correspondent à ce lien (même identifiant d'annonce ou même titre sur la même page).
- Termine ta réponse par un unique bloc \`\`\`json contenant exactement :
{"trouve": bool, "titre": string|null, "marque": string|null, "modele": string|null, "prix": int|null, "annee": int|null, "km": int|null, "carburant": string|null, "boite": string|null, "vendeur": "Particulier"|"Professionnel"|null, "ville": string|null, "extrait": string|null}`;

// Retrouve une annonce à partir de son lien. Le robots.txt de Leboncoin autorise les robots
// d'IA agissant pour un utilisateur (Claude-User) sur /ad/voitures/ uniquement : dans ce cas
// Claude lit la page directement ; sinon il se contente de la recherche web.
export async function aiLookupLink(apiKey, url) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let host = "", path = "";
  try { ({ hostname: host, pathname: path } = new URL(url)); host = host.replace(/^www\./, ""); } catch {}
  const canFetch = host === "leboncoin.fr" && path.startsWith("/ad/voitures/");
  const domains = host ? { allowed_domains: [host] } : {};
  const tools = [
    ...(canFetch ? [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 2, max_content_tokens: 20000, ...domains }] : []),
    { type: "web_search_20260209", name: "web_search", max_uses: 4, ...domains },
  ];
  const messages = [{ role: "user", content: `Lien de l'annonce : ${url}` }];

  let msg;
  for (let i = 0; i < 4; i++) {
    msg = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: LOOKUP_SYSTEM,
      tools,
      messages,
    });
    if (msg.stop_reason !== "pause_turn") break;
    // La recherche n'est pas finie : on renvoie la réponse partielle, le serveur reprend où il en était.
    messages.splice(1, 1, { role: "assistant", content: msg.content });
  }
  if (msg.stop_reason === "refusal") throw new Error("L'IA a refusé cette recherche.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const m = text.match(/```json\s*([\s\S]*?)```(?![\s\S]*```json)/);
  if (!m) throw new Error("L'IA n'a pas renvoyé de résultat exploitable.");
  return JSON.parse(m[1]);
}

export async function aiAnalyze(apiKey, listingText, localSummary) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const msg = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Annonce :\n${listingText}\n\nAnalyse locale :\n${localSummary}` }],
  });
  if (msg.stop_reason === "refusal") throw new Error("L'IA a refusé d'analyser cette annonce.");
  if (msg.stop_reason === "max_tokens") throw new Error("Réponse de l'IA tronquée, réessaie.");
  const block = msg.content.find((b) => b.type === "text");
  if (!block) throw new Error("Réponse vide de l'IA.");
  return JSON.parse(block.text);
}
