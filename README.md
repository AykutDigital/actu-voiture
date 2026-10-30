# Bon Plan Auto

Application web installable sur téléphone (PWA) pour repérer les voitures d'occasion vendues bien en dessous de leur cote, avec un budget de 20 000 € (modifiable).

## Ce qu'elle fait

- **Analyser** : colle le texte d'une annonce (ou partage-la depuis l'appli Leboncoin ou La Centrale vers *Bon Plan Auto*). L'appli lit le modèle, l'année, le kilométrage et le prix, puis affiche une fiche courte :
  - le verdict (Excellente affaire / Bonne affaire / Prix du marché / Trop cher / Trop beau pour être vrai) ;
  - le prix comparé à la cote estimée ;
  - **pourquoi c'est moins cher** (vendeur pressé, kilométrage, panne annoncée, import, Crit'Air…) ;
  - les **risques mécaniques connus** du moteur ou de la boîte, avec le budget réparations ;
  - le **risque d'arnaque** (mandat cash, vendeur « à l'étranger », transporteur…) ;
  - le **prix à proposer** ;
  - un **plan d'achat sécurisé**, avec la durée de chaque étape.
- **Bouton « Analyser »** (favori du navigateur, à installer une fois depuis l'onglet Analyser) : sur la page d'une annonce ouverte, un geste suffit et la fiche s'ouvre directement. Sur Leboncoin, il lit les données de l'annonce (prix, année, km, carburant, boîte, vendeur, description). Sur les autres sites, il lit le texte visible de la page. Il ne lit que la page que tu as ouverte toi-même.
- **Analyse automatique** : dès que le texte collé contient le modèle, l'année et le prix, la fiche s'affiche sans appuyer sur le bouton.
- **Lien seul → analyse** (avec une clé API Claude) : colle ou partage juste le lien. Pour une annonce Leboncoin de voiture (`/ad/voitures/…`), Claude lit directement la page : le robots.txt de Leboncoin autorise les robots d’IA qui agissent pour un utilisateur (`Claude-User`, `ChatGPT-User`…) sur cette catégorie. Si la lecture échoue, ou pour les autres sites, il retrouve l’annonce via un moteur de recherche. Les champs non trouvés sont signalés et ne sont jamais inventés.
- **Radar** : les modèles les plus fiables que tu peux viser avec ton budget (année et kilométrage visés, seuil « bonne affaire »), avec des recherches déjà filtrées sur Leboncoin, La Centrale et AutoScout24.
- **Mes affaires** : les annonces gardées, enregistrées sur le téléphone.
- **Avis détaillé IA** (facultatif) : avec une clé API Claude saisie dans Réglages, Claude rédige un avis complet. La clé reste sur le téléphone.

- **Affaires du jour** (Radar) : chaque matin vers 6 h, GitHub Actions relève les dernières annonces voitures Leboncoin sous le budget (`scripts/crawl.mjs`), les analyse et publie les bonnes affaires dans `deals.json`. Le rappel quotidien annonce le nombre trouvé. Le robot ne contourne aucune protection. Il s'annonce avec son User-Agent et ne passe que si Leboncoin l'a mis en liste blanche dans DataDome. Sinon, l'appli affiche « bloqué ».
  - Réglage : Settings → Secrets and variables → Actions. Le secret `LBC_USER_AGENT` contient le User-Agent communiqué à Leboncoin pour la liste blanche (par défaut `BonPlanAuto/1.0 (+https://github.com/AykutDigital/actu-voiture)`). Les variables `BUDGET` et `KM_MAX` sont facultatives.
  - Lancer à la main : Actions → *Publier sur GitHub Pages* → *Run workflow*.

> Sans liste blanche, l'appli ne parcourt pas les sites d'annonces toute seule. Leboncoin et La Centrale bloquent les robots, et AutoScout24 et ParuVendu interdisent l'aspiration de leurs pages de recherche. C'est donc toi qui ouvres les annonces (le Radar t'y amène) et l'appli qui les analyse.

La cote est une **estimation à ±15 %** (prix neuf moyen, âge, kilométrage, réputation du modèle). Vérifie toujours avec la cote La Centrale ou L'argus avant de faire une offre.

- **Rappel quotidien** (Réglages → Rappel quotidien) : une notification par jour, entre 8 h et 21 h, pour aller voir les nouvelles annonces. Toucher la notification ouvre le Radar. Ça fonctionne quand l'appli est installée depuis Chrome sur Android, et c'est Android qui choisit l'heure exacte.
- **Page de téléchargement** (`telecharger.html`) : bouton « Installer l'application » et QR code à scanner depuis un ordinateur.

## En ligne

Une fois GitHub Pages activé (Settings → Pages → *Deploy from a branch* → `main` / `root`) :
- appli : https://aykutdigital.github.io/actu-voiture/
- téléchargement : https://aykutdigital.github.io/actu-voiture/telecharger.html

## Lancer en local

```bash
npx http-server@14.1.1 -p 8765 -c-1 .
```
Puis ouvre http://localhost:8765.

## Installer sur le téléphone

Une PWA doit être servie en **HTTPS** pour être installable. Deux possibilités :

### 1. PWA (le plus simple)
1. Héberge le dossier gratuitement : GitHub Pages (Settings → Pages → branche `main`) ou Vercel (`npx vercel`).
2. Sur Android, ouvre l'URL dans Chrome, puis menu ⋮ → **Installer l'application**.
3. L'icône apparaît sur l'écran d'accueil et *Bon Plan Auto* apparaît dans le menu **Partager** des autres applis.

Sur iPhone : Safari → Partager → **Sur l'écran d'accueil** (le partage depuis d'autres applis n'est pas disponible sur iOS).

### 2. APK Android (installation en mode développeur)
1. Une fois le site en ligne, va sur https://www.pwabuilder.com, colle l'URL, puis **Package for stores → Android**. Télécharge l'APK.
2. Sur le téléphone : Paramètres → À propos → appuie 7 fois sur **Numéro de build** pour activer le mode développeur, puis autorise l'**installation d'applis inconnues** pour ton gestionnaire de fichiers.
3. Copie l'APK sur le téléphone et ouvre-le. Tu peux aussi l'installer en USB avec `adb install app.apk`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `data.js` | Base des modèles (prix neuf, fiabilité, revente), problèmes connus, signaux d'arnaque |
| `analyzer.js` | Lecture de l'annonce, cote estimée, verdict, raisons, risques, négociation |
| `radar.js` | Modèles malins pour le budget et liens de recherche |
| `ai.js` | Avis IA facultatif (Claude, `claude-opus-5-5`) |
| `app.js` / `index.html` / `styles.css` | Interface |
| `manifest.webmanifest` / `sw.js` | Installation sur le téléphone et fonctionnement hors ligne |
