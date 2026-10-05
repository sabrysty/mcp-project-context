---
title: TaskFlow — Contexte du projet
tags: [overview, architecture, stack, nestjs, react, postgresql]
owner: tech lead
updated: 2026-09-30
---

# TaskFlow — Contexte du projet

> Projet fictif : ce dossier sert de jeu de données de démonstration pour `mcp-project-context`.

## En bref

TaskFlow est une application web de gestion de tâches pour les petites équipes (5 à 50 personnes). Chaque équipe travaille dans un **workspace** où elle crée, assigne et suit ses tâches, en vue liste ou en tableau kanban.

## Métier

### Utilisateurs

- **Member** : crée des tâches, se les assigne, fait avancer leur statut.
- **Admin** : gère les membres du workspace et peut modifier ou archiver n'importe quelle tâche.
- **Owner** : créateur du workspace ; seul à pouvoir le supprimer ou en transférer la propriété.

### Glossaire

| Terme     | Définition                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Workspace | Espace de travail d'une équipe. Toutes les données (tâches, membres) sont cloisonnées par workspace. |
| Membre    | Utilisateur rattaché à un workspace avec un rôle : `owner`, `admin` ou `member`.                     |
| Tâche     | Unité de travail : titre, description, statut, priorité, assigné, échéance.                          |
| Statut    | `TODO`, `IN_PROGRESS`, `IN_REVIEW` ou `DONE`.                                                        |
| Archivage | Suppression logique d'une tâche, restaurable pendant 90 jours.                                       |

### Règles métier transverses

- Un utilisateur ne voit **que** les données des workspaces dont il est membre.
- L'API ne supprime rien physiquement : elle archive (`archivedAt`). Un job planifié purge les tâches archivées depuis plus de 90 jours.
- Toutes les dates sont stockées en UTC ; l'affichage se fait dans le fuseau du navigateur.

## Architecture

Monorepo **pnpm workspaces** + **Turborepo** :

```
taskflow/
├── apps/
│   ├── api/              # API REST NestJS
│   └── web/              # SPA React (Vite)
├── packages/
│   ├── shared/           # Types et constantes partagés (statuts, priorités, contrats d'API)
│   └── eslint-config/    # Configuration ESLint commune
├── docker-compose.yml    # PostgreSQL + Mailpit pour le développement local
└── turbo.json
```

### Parcours d'une requête

1. La SPA appelle l'API REST (`/api/v1/...`) avec l'access token JWT dans l'en-tête `Authorization: Bearer`.
2. Le `JwtAuthGuard` global valide le token ; les routes publiques sont marquées `@Public()`.
3. Le `WorkspaceMemberGuard` vérifie que l'utilisateur appartient au workspace de la route.
4. Le contrôleur valide l'entrée (DTO + `ValidationPipe`) et délègue au service.
5. Le service applique les règles métier et accède à PostgreSQL via TypeORM.
6. La réponse est un DTO de sortie, jamais une entité brute.

### API

- REST, JSON, préfixe `/api/v1`.
- Documentation OpenAPI générée par `@nestjs/swagger`, servie sur `/api/docs` (hors production).
- Format d'erreur unique : `{ statusCode, error, message, requestId }`.
- Pagination : `?page=1&limit=20` (limite maximale : 100), réponse `{ items, total, page, limit }`.

## Stack

| Couche          | Choix                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| Langage         | TypeScript en mode strict, partout                                           |
| Back            | NestJS 11, TypeORM, class-validator, Passport JWT                            |
| Base de données | PostgreSQL 17                                                                |
| Front           | React 19, Vite, TanStack Query, Zustand, React Hook Form + Zod, React Router |
| Styles          | CSS Modules                                                                  |
| Tests back      | Jest (unitaires), Supertest (e2e) sur une base PostgreSQL de test            |
| Tests front     | Vitest, Testing Library, MSW                                                 |
| Qualité         | ESLint, Prettier, Husky + lint-staged                                        |
| CI/CD           | GitHub Actions (lint, typecheck, tests, build), déploiement par image Docker |

## Environnements

| Environnement | Usage                                      | Données                  |
| ------------- | ------------------------------------------ | ------------------------ |
| `local`       | Développement (Docker Compose)             | Jeu de données de seed   |
| `staging`     | Recette, déployé à chaque merge sur `main` | Données anonymisées      |
| `production`  | Clients                                    | Réelles, accès restreint |

La configuration passe exclusivement par des variables d'environnement, validées au démarrage de l'API (voir les [conventions NestJS](conventions/nestjs.md#configuration)).

## Commandes utiles

```bash
pnpm install
docker compose up -d        # PostgreSQL + Mailpit
pnpm dev                    # API (port 3000) + web (port 5173)
pnpm test                   # tous les tests
pnpm lint && pnpm typecheck
pnpm --filter api migration:generate src/database/migrations/<NomDeLaMigration>
pnpm --filter api migration:run
```

## Organisation

- **Équipe back** : `apps/api`, base de données, authentification.
- **Équipe front** : `apps/web`, design system.
- **Tech lead** : architecture, conventions transverses, revue des PR sensibles.
- Code, identifiants, noms de tests et messages de commit en anglais ; documentation en français.
- Branches `feat/TF-123-description-courte`, commits au format Conventional Commits, squash merge sur `main`.
- Toute PR passe par une revue ; celles qui touchent `auth/` ou la sécurité demandent aussi l'accord du référent sécurité.

## Travailler avec un agent IA

1. Lire ce document, puis la documentation de la feature concernée (`features/`).
2. Appliquer les conventions du domaine touché (`conventions/`).
3. Faire vérifier tout code généré avec l'outil `check_code` avant d'ouvrir une PR.

## Pour aller plus loin

- Conventions : [TypeScript](conventions/typescript.md), [NestJS](conventions/nestjs.md), [React](conventions/react.md)
- Sécurité : [règles de sécurité](security/guidelines.md)
- Features : [authentification](features/authentication.md), [gestion des tâches](features/task-management.md)
