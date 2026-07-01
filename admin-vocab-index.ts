// supabase/functions/admin-vocab/index.ts
//
// Edge Function — modifie les fichiers data/mots_X.json sur GitHub
// (ajout / modification / suppression d'un mot), appelée depuis le
// panneau admin (wordlist-editor.html).
//
// Sécurité :
// - Le token GitHub (droits d'écriture) vit UNIQUEMENT comme secret
//   Supabase (GITHUB_TOKEN), jamais exposé au navigateur.
// - Cette fonction revérifie elle-même que l'appelant est admin
//   (lecture de profiles.is_admin via son JWT) — ne fait jamais
//   confiance à un flag envoyé par le client.
// - verify_jwt reste activé (réglage par défaut) : la plateforme
//   rejette toute requête sans JWT Supabase valide avant que ce code
//   ne s'exécute.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const GITHUB_OWNER = 'shifuwuchan';
const GITHUB_REPO  = 'jcore-2000';
const GITHUB_BRANCH = 'main';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function levelToFile(level: number): string {
  return `data/mots_${level}.json`;
}

/** Lit le fichier mots_X.json depuis le repo, renvoie {words, sha}. */
async function fetchWordsFile(level: number, ghHeaders: Record<string, string>) {
  const path = levelToFile(level);
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders });
  if (!res.ok) throw new Error(`Lecture GitHub échouée (${res.status}) pour ${path}`);
  const json = await res.json();
  const raw = atob(json.content.replace(/\n/g, ''));
  const decoded = new TextDecoder('utf-8').decode(
    Uint8Array.from(raw, c => c.charCodeAt(0))
  );
  // Le fichier est "const mots_N = [ ... ];" — on extrait juste le tableau.
  const start = decoded.indexOf('[');
  const end = decoded.lastIndexOf(']') + 1;
  const words = JSON.parse(decoded.slice(start, end));
  return { words, sha: json.sha, varName: decoded.slice(0, start).match(/const\s+(\w+)/)?.[1] || `mots_${level}` };
}

/** Encode une chaîne UTF-8 en base64, sans spread operator (évite tout
 *  risque de dépasser la limite d'arguments sur un gros payload). */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Recommit le fichier mots_X.json avec la nouvelle liste de mots. */
async function commitWordsFile(level: number, words: unknown[], sha: string, varName: string, ghHeaders: Record<string, string>, message: string) {
  const path = levelToFile(level);
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
  const body = `const ${varName} = ${JSON.stringify(words, null, 2)};\n`;
  const encoded = utf8ToBase64(body);

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encoded,
      sha,
      branch: GITHUB_BRANCH,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Écriture GitHub échouée (${res.status}): ${errText}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1) Authentifie l'appelant via son JWT et revérifie is_admin côté DB.
    const authHeader = req.headers.get('Authorization') || '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Non authentifié.' }), { status: 401, headers: corsHeaders });
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle();
    if (profErr || !profile || !profile.is_admin) {
      return new Response(JSON.stringify({ error: 'Accès refusé : réservé aux administrateurs.' }), { status: 403, headers: corsHeaders });
    }

    // 2) Lit la requête.
    const { action, level, word, id } = await req.json();
    if (!level || level < 1 || level > 4) {
      return new Response(JSON.stringify({ error: 'level invalide (1 à 4 attendu).' }), { status: 400, headers: corsHeaders });
    }

    const githubToken = Deno.env.get('GITHUB_TOKEN');
    if (!githubToken) {
      return new Response(JSON.stringify({ error: 'GITHUB_TOKEN non configuré côté serveur.' }), { status: 500, headers: corsHeaders });
    }
    const ghHeaders = {
      'Authorization': `Bearer ${githubToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'jcore-2000-admin-vocab',
    };

    // 3) Charge le fichier concerné, applique l'action, recommit.
    const { words, sha, varName } = await fetchWordsFile(level, ghHeaders);

    let newWords = words;
    let commitMessage = '';

    if (action === 'update') {
      const idx = words.findIndex((w: any) => w.id === id);
      if (idx === -1) return new Response(JSON.stringify({ error: `Mot ${id} introuvable.` }), { status: 404, headers: corsHeaders });
      newWords = [...words];
      newWords[idx] = { ...words[idx], ...word, id }; // id jamais modifiable (clé SRS)
      commitMessage = `Admin: modifie le mot ${id}`;
    } else if (action === 'add') {
      if (words.some((w: any) => w.id === word.id)) {
        return new Response(JSON.stringify({ error: `Un mot avec l'id ${word.id} existe déjà.` }), { status: 409, headers: corsHeaders });
      }
      newWords = [...words, word];
      commitMessage = `Admin: ajoute le mot ${word.id}`;
    } else if (action === 'delete') {
      if (!words.some((w: any) => w.id === id)) {
        return new Response(JSON.stringify({ error: `Mot ${id} introuvable.` }), { status: 404, headers: corsHeaders });
      }
      newWords = words.filter((w: any) => w.id !== id);
      commitMessage = `Admin: supprime le mot ${id}`;
    } else {
      return new Response(JSON.stringify({ error: 'action invalide (update | add | delete attendu).' }), { status: 400, headers: corsHeaders });
    }

    await commitWordsFile(level, newWords, sha, varName, ghHeaders, commitMessage);

    // Journalise l'action via une RPC dédiée (admin_log n'autorise pas
    // l'insert direct depuis le client — même avec ce JWT scoped, il
    // faut passer par une fonction security definer qui revérifie
    // is_admin elle-même, cohérent avec le reste du journal).
    await supabase.rpc('admin_log_vocab_action', {
      p_action: `vocab_${action}`,
      p_level: level,
      p_word_id: id || word?.id || null,
    });

    return new Response(JSON.stringify({ success: true, count: newWords.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[admin-vocab]', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Erreur inconnue.' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
