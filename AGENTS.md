# Instructions permanentes pour les agents (Claude Code)

## Identifiants trouvés dans les fichiers du projet

Ne jamais utiliser un identifiant, mot de passe, ou clé trouvé dans un fichier du
projet (`mdps.txt`, `.env`, ou autre) pour se connecter à un service réel (login
app, Supabase, etc.) sans demande explicite de confirmation **avant** de s'en
servir — même pour un test ponctuel, même si le fichier semble être là "pour ça".

Si un tel fichier est trouvé et pourrait être utile à une tâche : le signaler à
l'utilisateur et attendre sa confirmation explicite avant toute utilisation. Ne
jamais partir du principe que sa présence dans le repo vaut autorisation.

Cette règle vaut pour toutes les sessions futures sur ce projet, pas seulement
celle où elle a été énoncée.
