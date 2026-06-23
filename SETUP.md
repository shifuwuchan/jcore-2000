# SETUP — Comptes & Classement (Supabase)

L'app fonctionne **sans rien configurer** : tout reste en local
(`localStorage`), exactement comme avant. Les comptes et le classement
sont une couche optionnelle. Voici comment l'activer.

## 1. Créer le projet Supabase

1. Va sur https://supabase.com → **New project** (gratuit).
2. Choisis un nom, un mot de passe DB (à garder de côté, pas besoin pour la suite), une région proche de toi.
3. Attends ~2 minutes que le projet soit prêt.

## 2. Exécuter le schéma SQL

1. Dans le menu de gauche : **SQL Editor** → **New query**.
2. Ouvre le fichier `schema.sql` (fourni avec le projet), copie tout son contenu.
3. Colle-le dans l'éditeur SQL et clique **Run**.
4. Tu dois voir "Success. No rows returned" — les tables `profiles`, `progress`, `points_log` et les fonctions de classement sont créées.

## 3. Récupérer les clés API

1. **Project Settings** (icône engrenage) → **API**.
2. Copie le **Project URL** et la clé **anon public**.
3. Ouvre `config.js` dans le projet et remplace les deux valeurs :

```js
window.JCORE_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
};
```

## 4. Réglage recommandé : confirmation email

Par défaut, Supabase peut exiger qu'un utilisateur clique un lien reçu
par email avant de pouvoir se connecter. Deux options :

- **Pour tester vite** : Authentication → Providers → Email → désactive
  "Confirm email". Les comptes sont actifs immédiatement.
- **Pour une vraie mise en ligne** : laisse la confirmation activée —
  l'app affiche déjà le message "Vérifie ta boîte mail" après
  l'inscription.

## 5. C'est tout

Recharge la page. Le bandeau "Joueur invité" dans le menu devient un
vrai écran de connexion/inscription. Une fois connecté :

- Ta progression (rang, SRS, high scores) se synchronise entre tous
  tes appareils (best-effort : à la connexion, on fusionne le local et
  le cloud en gardant le meilleur des deux, puis on repousse le
  résultat — pas de résolution de conflit en temps réel si tu joues
  sur deux appareils *en même temps*).
- Tes points gagnés en mode QCM alimentent le classement **Quotidien**,
  **Hebdo** et **Général** (visible par tous, même les invités).

## Limites connues

- Pas de récupération de mot de passe intégrée (à ajouter via
  `client.auth.resetPasswordForEmail()` côté Supabase si besoin).
- Le classement affiche le top 50 ; pas d'affichage "ta position si
  tu n'es pas dans le top 50" pour l'instant.
- Si tu veux repartir de zéro : `Table Editor` → vide les 3 tables, ou
  supprime simplement le projet Supabase (l'app retombe en mode local).
