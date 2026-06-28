# SETUP — Comptes & Classement (Supabase)

✅ **`config.js` est déjà rempli avec ton projet Supabase** — rien à faire de ce côté.

⚠️ **Étape obligatoire restante : exécuter `schema.sql`**

1. Va sur https://supabase.com/dashboard → ton projet → **SQL Editor** → **New query**.
2. Ouvre le fichier `schema.sql` (fourni avec le projet), copie tout son contenu.
3. Colle-le dans l'éditeur et clique **Run**.
4. Tu dois voir "Success. No rows returned".

Ce script est **idempotent** : tu peux le réexécuter sans risque à chaque fois que tu reçois une nouvelle version (il ajoute juste les colonnes/fonctions manquantes, sans toucher à tes données existantes).

## Réglage recommandé : confirmation email

Par défaut, Supabase peut exiger qu'un utilisateur clique un lien reçu
par email avant de pouvoir se connecter. Deux options :

- **Pour tester vite** : Authentication → Providers → Email → désactive
  "Confirm email". Les comptes sont actifs immédiatement.
- **Pour une vraie mise en ligne** : laisse la confirmation activée —
  l'app affiche déjà le message "Vérifie ta boîte mail" après
  l'inscription.

## C'est tout

Recharge la page. Le bandeau "Joueur invité" dans le menu devient un
vrai écran de connexion/inscription. Une fois connecté :

- Ta progression (rang, SRS par sens lecture/production, high scores,
  day streak) se synchronise entre tous tes appareils (best-effort : à
  la connexion, on fusionne le local et le cloud en gardant le meilleur
  des deux, puis on repousse le résultat — pas de résolution de
  conflit en temps réel si tu joues sur deux appareils *en même temps*).
- Tes points (QCM + mots acquis en Anki) alimentent le classement
  **Quotidien**, **Hebdo**, **Général** et **Streak** (visible par
  tous, même les invités).

## Limites connues

- Le quota de nouveaux mots/jour (10) reste **local à l'appareil**, pas
  synchronisé — chaque appareil a son propre compteur.
- Pas de récupération de mot de passe intégrée (à ajouter via
  `client.auth.resetPasswordForEmail()` côté Supabase si besoin).
- Le classement affiche le top 50 ; pas d'affichage "ta position si
  tu n'es pas dans le top 50" pour l'instant.
- Si tu veux repartir de zéro : `Table Editor` → vide les 3 tables, ou
  supprime simplement le projet Supabase (l'app retombe en mode local).
