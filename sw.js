// Met l'appli en cache pour qu'elle s'ouvre même sans réseau.
const CACHE = "bonplanauto-v5";
const FILES = ["./", "index.html", "telecharger.html", "styles.css", "app.js", "analyzer.js", "data.js", "radar.js", "bookmarklet.js", "install.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== STATE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord (pour avoir la dernière version), cache en secours.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

// ---------- Rappel quotidien ----------
// Chrome réveille l'appli installée environ une fois par jour (« periodic background sync ») :
// on affiche alors le rappel, au plus une fois par jour et seulement entre 8 h et 21 h.
const STATE = "bonplanauto-state";
const TIPS = [
  "Les bonnes affaires partent en quelques heures : jette un œil aux nouvelles annonces.",
  "Nouvelles annonces du jour : ouvre le radar et analyse celles qui te tentent.",
  "Le matin, c'est le meilleur moment pour tomber sur une affaire avant les autres.",
  "Un vendeur pressé baisse souvent son prix : regarde les annonces récentes.",
];

async function lastShown() {
  const res = await (await caches.open(STATE)).match("last-reminder");
  return res ? res.text() : "";
}
async function markShown(day) {
  await (await caches.open(STATE)).put("last-reminder", new Response(day));
}

async function remind({ force = false } = {}) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (!force && (now.getHours() < 8 || now.getHours() >= 21 || (await lastShown()) === day)) return;
  await self.registration.showNotification("Bon Plan Auto 🚗", {
    body: TIPS[now.getDate() % TIPS.length],
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: "rappel-annonces",
    data: { url: "./?tab=radar" },
  });
  if (!force) await markShown(day);
}

self.addEventListener("periodicsync", (e) => {
  if (e.tag === "rappel-annonces") e.waitUntil(remind());
});

self.addEventListener("message", (e) => {
  if (e.data === "test-reminder") e.waitUntil(remind({ force: true }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => w.url.startsWith(self.registration.scope));
      return win ? win.navigate(url).then((w) => (w || win).focus()) : self.clients.openWindow(url);
    })
  );
});
