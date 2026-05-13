# Étape 3 — Persistance SQLite

API de chat avec Ollama, persistance des conversations en SQLite et streaming SSE. Écrit en **TypeScript** avec Fastify et TypeBox.

## Stack

- **Fastify 5** + **TypeBox** — serveur HTTP, schémas typés
- **better-sqlite3** — persistance SQLite synchrone
- **tsx** — exécution TypeScript sans compilation
- **Ollama** — LLM local (llama3.2 par défaut)

## Installation

```bash
npm install
```

## Scripts

| Commande | Description |
|----------|-------------|
| `npm run dev` | Démarrage avec rechargement automatique |
| `npm run typecheck` | Vérification des types sans compilation |
| `npm run build` | Compilation TypeScript → `dist/` |
| `npm run start:dist` | Exécution du code compilé |

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port du serveur |
| `OLLAMA_URL` | `http://localhost:11434` | URL du service Ollama |
| `OLLAMA_MODEL` | `llama3.2` | Modèle de chat |
| `DB_PATH` | `./data.db` | Chemin vers la base SQLite |
| `LOG_LEVEL` | `info` | Niveau de log |

## Endpoints

### Conversations

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/conversations` | Créer une conversation |
| `GET` | `/conversations` | Lister toutes les conversations |
| `GET` | `/conversations/:id` | Détail + messages d'une conversation |
| `DELETE` | `/conversations/:id` | Supprimer une conversation |
| `POST` | `/conversations/:id/messages` | Envoyer un message (SSE streaming) |

### Chat (sans persistance)

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/chat` | Réponse complète |
| `POST` | `/chat/stream` | Réponse en streaming SSE |

### Santé

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/health` | Statut du serveur |

## Tests

```powershell
# Créer une conversation
curl.exe -s -X POST http://localhost:3000/conversations

# Envoyer un premier message
curl.exe -s -X POST http://localhost:3000/conversations/1/messages -H "Content-Type: application/json" -d '{\"message\": \"Je m appelle Alice.\"}'

# Tester le contexte multi-tours
curl.exe -s -X POST http://localhost:3000/conversations/1/messages -H "Content-Type: application/json" -d '{\"message\": \"Quel est mon prenom ?\"}'

# Lister les conversations
curl.exe -s http://localhost:3000/conversations

# Voir les messages d'une conversation
curl.exe -s http://localhost:3000/conversations/1

# Supprimer une conversation
curl.exe -s -X DELETE http://localhost:3000/conversations/1
```

## Structure

```
src/
├── server.ts          # Point d'entrée
├── app.ts             # Factory Fastify
├── plugins/
│   └── db.ts          # Plugin SQLite (app.db, app.stmts)
└── routes/
    ├── health.ts
    ├── chat.ts        # /chat et /chat/stream
    └── conversations.ts
```

## Base de données

Le fichier `data.db` est créé automatiquement au démarrage dans le répertoire courant.

```sql
conversations (id, title, createdAt)
messages      (id, conversationId, role, content, createdAt)
```

Les messages sont supprimés en cascade quand une conversation est supprimée (`ON DELETE CASCADE`).
