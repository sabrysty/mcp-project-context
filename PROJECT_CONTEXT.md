# PROJECT_CONTEXT.md — `mcp-project-context`

> Ce fichier est le **contexte de référence** du projet. Tout agent IA (Claude, Cursor, Copilot) qui travaille sur ce dépôt doit le lire en entier avant d'écrire du code, et le respecter.
> Pour Claude Code, copier ce fichier en `CLAUDE.md` à la racine. Pour Cursor, le référencer depuis `.cursor/rules/`. Pour Copilot, le copier dans `.github/copilot-instructions.md`.

---

## 1. Pitch

**`mcp-project-context`** est un serveur **MCP (Model Context Protocol)** en TypeScript qui donne aux agents IA de code (Claude, Cursor, Copilot…) un accès structuré au **contexte d'un projet logiciel** :

- la documentation de contexte (architecture, métier, stack) ;
- les **conventions de code** de l'équipe ;
- les **règles de sécurité** ;
- l'**explication de chaque feature**.

Il fournit aussi un outil **`check_code`** qui vérifie un extrait de code contre les garde-fous de sécurité et les conventions du projet.

**Problème résolu :** dans une équipe, chaque développeur utilise l'IA à sa façon, sans contexte commun. Résultat : du code généré incohérent, des conventions ignorées et des failles de sécurité. Ce serveur centralise le contexte une fois pour toutes, et chaque agent connecté y a accès automatiquement.

**Origine :** industrialisation d'une pratique réelle (rules, skills et documentation Markdown partagées mises en place pour une équipe de développement).

---

## 2. Objectif du dépôt (portfolio)

Ce projet est un **projet portfolio public**. Il doit démontrer :

- la maîtrise du **protocole MCP** (tools, resources, prompts) ;
- la **conception d'outils pour agents IA** (descriptions claires, schémas d'entrée stricts, sorties exploitables) ;
- la **sécurité appliquée à l'IA** (lecture seule, validation des entrées, anti path traversal) ;
- des **fondamentaux de génie logiciel solides** : TypeScript strict, architecture claire, tests, CI, README de qualité.

La qualité du code et du README compte autant que les fonctionnalités : un recruteur doit comprendre le projet en 2 minutes.

---

## 3. Stack technique

| Élément          | Choix                                               | Notes                                                    |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------- |
| Runtime          | **Node.js 22+**                                     |                                                          |
| Langage          | **TypeScript** en mode `strict`                     | ESM (`"type": "module"`)                                 |
| SDK MCP          | **`@modelcontextprotocol/server` (v2)**             | ⚠️ voir section 4                                        |
| Validation       | **Zod v4** (`import * as z from 'zod/v4'`)          | Le SDK v2 accepte tout schéma compatible Standard Schema |
| Parsing Markdown | `gray-matter` (front-matter)                        | Ajouter une dépendance seulement si nécessaire           |
| Tests            | **Vitest**                                          |                                                          |
| Dev              | `tsx` pour lancer en dev, `tsc` pour builder        |                                                          |
| Qualité          | ESLint + Prettier                                   |                                                          |
| CI               | GitHub Actions : lint + typecheck + tests           | + format, couverture, build ; Linux/Windows, Node 22/24  |
| Transport        | **stdio** (V1). Streamable HTTP en option plus tard |                                                          |

---

## 4. ⚠️ Point critique : utiliser le SDK MCP **v2**

Le SDK TypeScript officiel est passé en **v2** (packages séparés), aligné sur la spec MCP **2026-07-28**.

- ✅ Installer : `npm install @modelcontextprotocol/server zod`
- ❌ **Ne pas utiliser** l'ancien package `@modelcontextprotocol/sdk` (v1) ni ses imports, même si beaucoup de tutoriels en ligne le montrent encore.
- Doc v2 : https://ts.sdk.modelcontextprotocol.io/v2/
- Dépôt : https://github.com/modelcontextprotocol/typescript-sdk

Exemple minimal officiel (v2) :

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'greeting-server', version: '1.0.0' });

server.registerTool(
  'greet',
  {
    description: 'Greet someone by name',
    inputSchema: z.object({ name: z.string() }),
  },
  async ({ name }) => ({
    content: [{ type: 'text', text: `Hello, ${name}!` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

**Règle pour l'agent :** avant d'implémenter les _resources_ et les _prompts_, consulter la doc v2 pour la signature exacte de `registerResource` et `registerPrompt`. Ne jamais deviner une API.

**Règle stdio :** en transport stdio, `stdout` est réservé au protocole. **Aucun `console.log`** : tous les logs passent par `console.error` (stderr), via un petit module `logger`.

---

## 5. Fonctionnalités (V1)

### 5.1 Source des données

Le serveur lit un dossier de contexte dont le chemin est passé en argument ou par variable d'environnement :

```
node dist/index.js --context-dir ./examples/taskflow-context
# ou
PROJECT_CONTEXT_DIR=./examples/taskflow-context node dist/index.js
```

Structure attendue du dossier de contexte :

```
context/
├── project.md              # Contexte global : métier, architecture, stack
├── conventions/
│   ├── typescript.md
│   ├── nestjs.md
│   └── react.md
├── security/
│   ├── guidelines.md       # Règles de sécurité expliquées
│   └── rules.json          # Règles vérifiables par check_code
└── features/
    ├── authentication.md
    └── task-management.md
```

Chaque fichier `.md` peut avoir un front-matter :

```md
---
title: Authentification
tags: [auth, jwt, nestjs]
owner: équipe back
updated: 2026-10-01
---
```

### 5.2 Tools

| Tool                  | Entrée                                                     | Sortie                                                                          | Rôle                                         |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `get_project_context` | —                                                          | Contenu de `project.md`                                                         | Donner à l'agent la vue d'ensemble du projet |
| `list_features`       | —                                                          | Liste des features (nom, titre, tags)                                           | Découvrir ce qui est documenté               |
| `get_feature_doc`     | `name: string`                                             | Doc complète d'une feature                                                      | Comprendre une feature avant de la modifier  |
| `get_conventions`     | `topic?: string` (ex. `nestjs`)                            | Conventions demandées, ou liste des sujets                                      | Appliquer les conventions de l'équipe        |
| `search_docs`         | `query: string`, `limit?: number` (défaut 5, max 20)       | Extraits pertinents avec fichier source                                         | Recherche plein texte dans tout le contexte  |
| `check_code`          | `code: string`, `language: "ts" \| "js" \| "tsx" \| "jsx"` | Liste des violations (règle, sévérité, ligne, explication, correction suggérée) | Vérifier un extrait contre les garde-fous    |

Exigences pour **chaque tool** :

- une **description précise**, écrite pour un LLM (quand l'utiliser, ce qu'il renvoie) ;
- un **schéma Zod strict** (`.max()` sur les chaînes, bornes sur les nombres) ;
- des **erreurs explicites** (`isError: true` + message clair) plutôt que des exceptions non gérées ;
- une sortie texte lisible, et structurée quand c'est utile.

### 5.3 `check_code` : règles de sécurité

Les règles sont définies dans `security/rules.json` (le code ne doit **pas** les coder en dur) :

```json
[
  {
    "id": "no-eval",
    "severity": "error",
    "pattern": "\\beval\\s*\\(",
    "message": "Usage de eval() interdit",
    "fix": "Utiliser JSON.parse ou une logique explicite"
  },
  {
    "id": "no-hardcoded-secret",
    "severity": "error",
    "pattern": "(api[_-]?key|secret|password|token)\\s*[:=]\\s*['\"][^'\"]{8,}['\"]",
    "flags": "i",
    "message": "Secret potentiellement codé en dur",
    "fix": "Passer par une variable d'environnement (ConfigService)"
  },
  {
    "id": "no-sql-concat",
    "severity": "error",
    "pattern": "(SELECT|INSERT|UPDATE|DELETE)[^;]*['\"]\\s*\\+",
    "flags": "i",
    "message": "Requête SQL construite par concaténation (risque d'injection)",
    "fix": "Utiliser des requêtes paramétrées ou l'ORM"
  },
  {
    "id": "no-console-log",
    "severity": "warning",
    "pattern": "console\\.log\\(",
    "message": "console.log interdit en production",
    "fix": "Utiliser le Logger de NestJS"
  },
  {
    "id": "no-dangerously-set-html",
    "severity": "warning",
    "pattern": "dangerouslySetInnerHTML",
    "message": "Risque XSS",
    "fix": "Assainir le HTML (DOMPurify) ou éviter cette API"
  }
]
```

V1 : moteur de règles basé sur des **regex**, avec le numéro de ligne de chaque violation. Rendre explicite dans le README que c'est un premier niveau de garde-fou, qui ne remplace pas un linter ou un SAST. Piste V2 : analyse AST.

**Sécurité du moteur :** valider `rules.json` au démarrage avec Zod. Si une regex est invalide, le serveur refuse de démarrer avec un message clair. Limiter la taille du `code` reçu (ex. 50 000 caractères) pour éviter les abus.

### 5.4 Resources

Exposer chaque fichier Markdown du contexte comme **resource** MCP, par exemple :

- `context://project`
- `context://conventions/{topic}`
- `context://features/{name}`
- `context://security/guidelines`

Vérifier dans la doc v2 la façon de déclarer des resources à URI dynamique (templates).

### 5.5 Prompts

- `review-with-conventions` (argument facultatif : `files`, chemins séparés par des virgules) : construit un prompt de revue de code qui injecte les conventions et règles de sécurité, et demande à l'agent de relire les fichiers indiqués (à défaut, le code donné dans la conversation ou les modifications non commitées) en commençant par `check_code`.
  _Le code n'est pas passé en argument : les clients transmettent les arguments de prompt comme de courtes chaînes, et Claude Code les découpe même sur les espaces (constaté à l'étape 8). Un agent lit lui-même le code ; le serveur, lui, ne lit que le dossier de contexte._
- `explain-feature` (argument : `name`) : construit un prompt qui explique une feature à un nouveau développeur à partir de sa doc.

---

## 6. Sécurité du serveur (non négociable)

1. **Lecture seule** : le serveur ne crée, ne modifie et ne supprime **aucun** fichier.
2. **Anti path traversal** : tout chemin dérivé d'une entrée (`name`, `topic`) est résolu puis vérifié **à l'intérieur** du dossier de contexte (`path.resolve` + vérification du préfixe). Refuser `..`, les chemins absolus et les liens symboliques sortants. Tester ces cas.
3. **Liste blanche d'extensions** : uniquement `.md` et `rules.json`.
4. **Limites** : taille max par fichier lu (ex. 1 Mo), nombre max de résultats de recherche, taille max des entrées.
5. **Aucun accès réseau** et aucune exécution du code reçu dans `check_code` : il est analysé comme du texte, **jamais exécuté**.
6. **Pas de secrets** dans le dépôt. `.env` dans `.gitignore`, avec un `.env.example` fourni.

---

## 7. Architecture du code

```
mcp-project-context/
├── src/
│   ├── index.ts                 # Point d'entrée : lecture config, création serveur, transport stdio
│   ├── server.ts                # createServer(config) : enregistre tools/resources/prompts (testable)
│   ├── config.ts                # Lecture des args/env + validation Zod
│   ├── logger.ts                # Logs vers stderr uniquement
│   ├── context/
│   │   ├── loader.ts            # Chargement et indexation des fichiers Markdown (+ front-matter)
│   │   ├── safe-path.ts         # Résolution sécurisée des chemins (anti path traversal)
│   │   └── search.ts            # Recherche plein texte simple (score par occurrences)
│   ├── security/
│   │   ├── rules.ts             # Chargement + validation de rules.json
│   │   └── checker.ts           # Moteur check_code
│   ├── tools/                   # Un fichier par tool
│   ├── resources/
│   └── prompts/
├── tests/                       # Vitest : un fichier de test par module
├── examples/
│   └── taskflow-context/        # Contexte de démo complet (projet fictif NestJS + React)
├── .github/workflows/ci.yml
├── PROJECT_CONTEXT.md           # Ce fichier
├── README.md
├── package.json
└── tsconfig.json
```

Principes :

- **Logique métier séparée du SDK** : `context/` et `security/` ne dépendent pas de MCP et sont testables seuls. Les fichiers `tools/` font l'adaptation entre MCP et la logique.
- **`createServer(config)` exporté** pour pouvoir tester le serveur sans transport.
- Fonctions courtes, nommage explicite, pas de `any`.

---

## 8. Conventions de code

- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- ESM, imports avec extension `.js` dans le code compilé si nécessaire, selon la config `tsconfig`.
- Nommage : `camelCase` pour les variables et fonctions, `PascalCase` pour les types, `kebab-case` pour les fichiers.
- Pas de `any`. Utiliser `unknown` puis affiner.
- Erreurs métier typées (`ContextNotFoundError`, `PathTraversalError`…).
- Commentaires seulement pour expliquer le **pourquoi**, pas le quoi.
- Commits au format **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

---

## 9. Données de démo : projet fictif « TaskFlow »

Créer `examples/taskflow-context/` avec un contexte réaliste pour une application de gestion de tâches **NestJS + React + PostgreSQL** :

- `project.md` : métier, architecture (monorepo, API REST, auth JWT), stack ;
- conventions TypeScript, NestJS (modules, DTO, validation, `ConfigService`, Logger) et React (hooks, composants, gestion d'état) ;
- `security/guidelines.md` + `security/rules.json` (section 5.3) ;
- features `authentication.md` et `task-management.md` (but, flux, endpoints, points d'attention).

Ces données servent aux tests, à la démo dans le README et aux captures d'écran.

---

## 10. Tests (Vitest)

Couvrir au minimum :

- `safe-path` : chemins valides, `../`, chemins absolus, encodages détournés ;
- `loader` : parsing du front-matter, fichiers absents, fichiers trop gros ;
- `search` : pertinence, limite de résultats, requête vide ;
- `checker` : chaque règle de `rules.json` (cas positif + négatif), numéros de ligne, code trop long, `rules.json` invalide ;
- `server` : chaque tool appelé via `createServer` renvoie le bon format, et les erreurs renvoient `isError: true`.

Objectif : **couverture > 80 %** sur `context/` et `security/`.

---

## 11. Étapes de développement

Réaliser **une étape à la fois**, selon ce flux de travail (GitHub Flow) :

1. une **issue** GitHub par étape ;
2. une **branche** par étape, partie de `master` : `feat/<sujet>`, `fix/<sujet>` ou `docs/<sujet>` ;
3. des **commits réguliers et atomiques** (Conventional Commits) sur cette branche, chacun vérifié (lint, typecheck, tests) ;
4. en fin d'étape : explication de chaque fonctionnalité, instructions de test manuel, puis **validation humaine** ;
5. après validation seulement : push et **pull request** vers `master` qui ferme l'issue (`Closes #N`) ; le développeur relit et fusionne la PR.

Étapes :

1. **Init** : `package.json`, `tsconfig`, ESLint, Prettier, Vitest, `.gitignore`, structure des dossiers, logger, config. Le serveur démarre avec un tool `ping` (retiré à l'étape 10).
2. **Données de démo** : créer `examples/taskflow-context/` complet.
3. **Lecture du contexte** : `safe-path`, `loader` + tests.
4. **Tools de lecture** : `get_project_context`, `list_features`, `get_feature_doc`, `get_conventions` + tests.
5. **Recherche** : `search_docs` + tests.
6. **Sécurité** : `rules.ts`, `checker.ts`, tool `check_code` + tests.
7. **Resources et prompts** (vérifier l'API v2 avant d'implémenter).
8. **Test manuel** avec MCP Inspector + connexion à Claude Code, Cursor et VS Code.
9. **CI** GitHub Actions (lint, typecheck, tests).
10. **README final** (section 12) + captures ou GIF de démo.

---

## 12. README attendu

Le README est la vitrine du projet. Il doit contenir :

1. Titre + **pitch en une phrase** + badges (CI, licence).
2. **Le problème** et **la solution** (3–4 lignes chacun).
3. **Démo** : GIF ou capture d'un agent qui appelle `check_code` ou `get_feature_doc`.
4. **Schéma d'architecture** en Mermaid (agent IA ↔ client MCP ↔ serveur ↔ dossier de contexte).
5. **Liste des tools, resources et prompts** (tableau).
6. **Installation et configuration** pour Claude Code, Cursor et VS Code (vérifier le format de config actuel dans la doc de chaque client).
7. **Comment écrire son propre dossier de contexte** (structure + exemple).
8. **Sécurité** : choix de conception (lecture seule, anti path traversal, limites).
9. **Limites et roadmap** : analyse AST pour `check_code`, transport HTTP, recherche sémantique par embeddings (lien avec le futur projet RAG).
10. Auteur + lien LinkedIn.

---

## 13. Definition of Done (V1)

- [x] `npm run build`, `npm run lint`, `npm run typecheck` et `npm test` passent sans erreur
- [x] Les 6 tools, les resources et les 2 prompts fonctionnent dans MCP Inspector
- [x] Le serveur est testé en conditions réelles depuis au moins un client (Claude Code ou Cursor)
- [x] Les tests de sécurité (path traversal, limites) passent
- [x] CI verte sur GitHub
- [x] README complet avec schéma et démo
- [x] Aucun secret ni `console.log` dans le code

---

## 14. Instructions pour l'agent IA

- Lire ce fichier en entier avant toute action.
- Travailler **étape par étape** (section 11) et **s'arrêter après chaque étape** pour validation humaine, avant tout push.
- Ne jamais commiter sur `master` : chaque changement passe par une branche et une pull request (section 11).
- **Ne jamais deviner une API** : vérifier la doc du SDK MCP v2 en cas de doute.
- Demander avant d'ajouter une dépendance non listée en section 3.
- Écrire les tests **en même temps** que le code, pas après.
- Expliquer brièvement chaque choix technique non trivial, pour que le développeur puisse le défendre en entretien.
