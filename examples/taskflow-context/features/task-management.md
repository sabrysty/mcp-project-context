---
title: Gestion des tâches
tags: [tasks, kanban, workspace, nestjs, react, typeorm]
owner: équipe produit
updated: 2026-10-13
---

# Gestion des tâches

## But

Permettre aux membres d'un workspace de créer, d'assigner et de suivre leurs tâches, en vue liste (filtrable) ou en tableau kanban (glisser-déposer d'un statut à l'autre).

## Modèle

| Champ         | Type                    | Règles                                                              |
| ------------- | ----------------------- | ------------------------------------------------------------------- |
| `id`          | uuid                    | Généré par la base                                                  |
| `workspaceId` | uuid                    | Workspace propriétaire, jamais modifiable                           |
| `title`       | texte                   | 1 à 200 caractères                                                  |
| `description` | texte Markdown          | Optionnelle, 10 000 caractères au plus                              |
| `status`      | statut                  | `TODO`, `IN_PROGRESS`, `IN_REVIEW` ou `DONE` ; `TODO` à la création |
| `priority`    | priorité                | `LOW`, `MEDIUM`, `HIGH` ou `URGENT` ; `MEDIUM` par défaut           |
| `assigneeId`  | uuid, optionnel         | Doit être membre du workspace                                       |
| `dueDate`     | date, optionnelle       | Date sans heure                                                     |
| `position`    | nombre décimal          | Ordre dans la colonne du kanban                                     |
| `createdById` | uuid                    | Auteur de la tâche                                                  |
| `completedAt` | date-heure, optionnelle | Renseignée au passage à `DONE`, effacée si la tâche est rouverte    |
| `archivedAt`  | date-heure, optionnelle | Archivage (suppression logique)                                     |
| `version`     | entier                  | Verrouillage optimiste                                              |

Statuts et priorités sont définis une seule fois, dans `@taskflow/shared` (`TASK_STATUSES`, `TASK_PRIORITIES`), et partagés par le back et le front.

## Règles métier

| Action                          | member               | admin | owner |
| ------------------------------- | -------------------- | ----- | ----- |
| Voir, créer, changer le statut  | ✅                   | ✅    | ✅    |
| Modifier le contenu d'une tâche | si auteur ou assigné | ✅    | ✅    |
| Archiver, restaurer             | si auteur            | ✅    | ✅    |

- Le statut avance ou recule librement, sans workflow imposé. Passer à `DONE` renseigne `completedAt` ; quitter `DONE` l'efface.
- Une tâche archivée disparaît des listes et ne peut plus être modifiée, sauf restauration. Elle reste restaurable 90 jours, puis un job planifié la purge.
- L'assigné doit être membre du workspace de la tâche.

## Endpoints

Préfixe : `/api/v1/workspaces/:workspaceId`. Toutes les routes exigent d'être authentifié **et** membre du workspace (`WorkspaceMemberGuard`).

| Méthode | Route                    | Rôle                                 | Réponses                     |
| ------- | ------------------------ | ------------------------------------ | ---------------------------- |
| GET     | `/tasks`                 | Liste paginée et filtrable           | 200, 400                     |
| POST    | `/tasks`                 | Créer une tâche                      | 201, 400, 422                |
| GET     | `/tasks/:taskId`         | Détail d'une tâche                   | 200, 404                     |
| PATCH   | `/tasks/:taskId`         | Modifier le contenu (avec `version`) | 200, 400, 403, 404, 409, 422 |
| PATCH   | `/tasks/:taskId/move`    | Changer statut et position (kanban)  | 200, 400, 404, 409           |
| DELETE  | `/tasks/:taskId`         | Archiver                             | 204, 403, 404                |
| POST    | `/tasks/:taskId/restore` | Restaurer une tâche archivée         | 200, 403, 404                |

Filtres de `GET /tasks` : `status`, `priority`, `assigneeId`, `q` (recherche dans le titre), `dueBefore`, `page` (1 par défaut), `limit` (20 par défaut, 100 au plus), `sort` (`position`, `dueDate`, `-createdAt`…).

Codes d'erreur propres à la feature. Le service lève l'erreur métier indiquée, définie dans `tasks/tasks.errors.ts`, et le filtre global la traduit en code HTTP (voir les [conventions NestJS](../conventions/nestjs.md#erreurs)) :

- `403` (`TaskActionForbiddenError`) : le membre n'a pas le droit de faire cette action, d'après les règles métier.
- `404` (`TaskNotFoundError`) : la tâche n'existe pas **ou** appartient à un autre workspace (son existence n'est pas révélée).
- `409` (`TaskVersionConflictError`) : la `version` envoyée ne correspond plus, la tâche a été modifiée entre-temps.
- `422` (`AssigneeNotMemberError`…) : règle métier non respectée, par exemple un assigné qui n'est pas membre du workspace.

Exemple de création :

```http
POST /api/v1/workspaces/9b2e4c71-…/tasks
Authorization: Bearer <access token>
Content-Type: application/json

{
  "title": "Préparer la démo client",
  "priority": "HIGH",
  "assigneeId": "4c1d8f02-…",
  "dueDate": "2026-10-15"
}
```

## Côté front

### Liste et filtres

- Les filtres vivent dans l'URL (`?status=TODO&assigneeId=…`) : une vue filtrée se partage par simple lien.
- `useTasks(workspaceId, filters)` appelle `GET /tasks` avec la clé `taskKeys.list(workspaceId, filters)`.

### Kanban

1. À la dépose d'une carte, sa nouvelle position est la moyenne des positions de ses deux voisines.
2. Le cache TanStack Query est mis à jour de façon **optimiste** (`onMutate`), puis `PATCH /tasks/:taskId/move` est envoyé.
3. En cas d'erreur, le cache revient à l'état précédent (`onError`) et un message s'affiche ; en cas de `409`, la colonne est rechargée.
4. Dans tous les cas, la liste est invalidée à la fin (`onSettled`).

### Création et édition

- Formulaire React Hook Form, avec un schéma Zod aligné sur le DTO du back (mêmes longueurs maximales).
- La description est rendue avec `react-markdown`, sans HTML brut.

## Points d'attention

- **IDOR** : toujours charger une tâche avec son workspace (`where: { id: taskId, workspaceId }`). Le `workspaceId` vient de la route, validée par le guard, jamais du body.
- **Rôle du membre** : lu dans `@CurrentMember()`, que `WorkspaceMemberGuard` charge en base à chaque requête, jamais dans le token (`@CurrentUser()` ne porte que l'`id`). Les droits « si auteur » ou « si assigné » des règles métier se vérifient dans le service, une fois la tâche chargée.
- **Assigné** : vérifier qu'il est membre du même workspace, sinon `422`.
- **Recherche `q`** : `ILIKE` paramétré via le QueryBuilder, en échappant les `%` et `_` saisis par l'utilisateur (`escapeLike`).
- **Pagination** : `limit` plafonné à 100 dans le DTO.
- **Requêtes N+1** : charger l'assigné par une jointure qui ne sélectionne que `id` et `displayName`.
- **Concurrence** : colonne `@VersionColumn()`. Le client renvoie la `version` qu'il a lue ; si elle a changé, l'API répond `409`.
- **Positions** : nombres décimaux. Quand l'écart entre deux voisines devient trop faible (moins de 0,000001), la colonne est renumérotée en arrière-plan.
- **Dates** : `completedAt` et `archivedAt` en `timestamptz` (UTC), `dueDate` en `date`.

## Tests à maintenir

- e2e : création, lecture, modification et archivage ; filtres et pagination ; tâche d'un autre workspace → `404` ; assigné non membre → `422` ; conflit de version → `409` ; archivage puis restauration.
- Unitaires : calcul des positions, gestion de `completedAt` lors des changements de statut.
- Front : glisser-déposer avec mise à jour optimiste et retour arrière en cas d'erreur (API simulée avec MSW).

## Hors périmètre (V1)

Commentaires, pièces jointes, sous-tâches et notifications sont prévus dans une version ultérieure.
