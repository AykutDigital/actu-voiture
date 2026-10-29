// Bouton « Analyser » à placer dans les favoris du navigateur. Sur la page d'une
// annonce que tu as ouverte toi-même, il lit les infos affichées et les envoie à l'appli.
// Rien n'est téléchargé en arrière-plan : il ne lit que la page que tu as sous les yeux.
function grab(APP) {
  const t = [];
  let ad = null;
  try { ad = JSON.parse(document.getElementById("__NEXT_DATA__").textContent).props.pageProps.ad; } catch (e) {}
  if (ad && ad.subject) {
    // Leboncoin : données structurées de l'annonce
    const a = {};
    (ad.attributes || []).forEach((x) => { a[x.key] = x.value_label || x.value; });
    t.push(
      [a.brand, a.model].filter(Boolean).join(" "),
      a.regdate && "Année " + a.regdate,
      a.mileage && String(a.mileage).replace(/\D/g, "") + " km",
      ad.price && ad.price[0] && ad.price[0] + " €",
      a.fuel, a.gearbox,
      ad.owner && ad.owner.type === "pro" ? "Professionnel" : "Particulier",
      ad.subject,
      (ad.body || "").slice(0, 1500)
    );
  } else {
    // Autres sites : texte visible de la page
    const main = document.querySelector("main") || document.body;
    t.push(document.title, main.innerText.replace(/\n{2,}/g, "\n").slice(0, 3000));
  }
  t.push(location.href);
  window.open(APP + "?auto=1&text=" + encodeURIComponent(t.filter(Boolean).join("\n")), "_blank") || (location.href = APP + "?auto=1&text=" + encodeURIComponent(t.filter(Boolean).join("\n")));
}

export const bookmarkletHref = (appUrl) =>
  "javascript:(" + grab.toString().replace(/\s*\/\/.*$/gm, "").replace(/\s+/g, " ") + ")(" + JSON.stringify(appUrl) + ")";
