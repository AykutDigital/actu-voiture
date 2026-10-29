// Bouton « Installer l'application » : Chrome/Edge proposent l'installation via
// beforeinstallprompt ; sur iPhone il faut passer par le menu Partager de Safari.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; notify(); });
window.addEventListener("appinstalled", () => { deferred = null; notify(); });

export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

// Met à jour le bouton et le texte d'aide selon ce que permet le navigateur.
export function setupInstall(button, hint) {
  const render = () => {
    if (isInstalled()) {
      button.hidden = true;
      hint.innerHTML = "✓ L'application est installée sur cet appareil.";
    } else if (deferred) {
      button.hidden = false;
      hint.textContent = "";
    } else if (isIOS()) {
      button.hidden = true;
      hint.innerHTML = "Sur iPhone : dans Safari, touche <b>Partager</b> ⬆️ puis <b>Sur l'écran d'accueil</b>.";
    } else {
      button.hidden = true;
      hint.innerHTML = "Ouvre cette page dans <b>Chrome</b> sur ton téléphone, puis menu <b>⋮</b> → <b>Installer l'application</b> (ou « Ajouter à l'écran d'accueil »).";
    }
  };
  button.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    render();
  });
  listeners.add(render);
  render();
}
