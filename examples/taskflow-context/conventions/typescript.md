---
title: Conventions TypeScript
tags: [typescript, conventions, naming, errors, async]
owner: tech lead
updated: 2026-10-13
---

# Conventions TypeScript

S'appliquent à tout le monorepo (`apps/api`, `apps/web`, `packages/*`). Les règles propres au back et au front sont dans les conventions [NestJS](nestjs.md) et [React](react.md).

## Compilation

- `strict: true` et `noUncheckedIndexedAccess: true` dans tous les `tsconfig`.
- Aucune erreur de typecheck tolérée en CI, pas de `// @ts-ignore`. Si une exception est vraiment nécessaire : `// @ts-expect-error` suivi de la raison.

## Types

- **Pas de `any`.** Utiliser `unknown`, puis affiner (type guard, schéma Zod, `instanceof`).
- `type` par défaut ; `interface` seulement pour un contrat destiné à être implémenté ou étendu.
- Pas d'`enum` TypeScript : des unions de littéraux dérivées d'un tableau `as const`, partagées dans `@taskflow/shared`.
- Pas d'assertion non-null (`value!`) : traiter explicitement le cas `undefined`. Seule exception : les propriétés des DTO et des entités, renseignées par class-transformer ou TypeORM (`title!: string`).
- `readonly` pour les propriétés qui ne changent pas après construction.

```ts
// ✅ Union dérivée d'une constante : sert à la fois au typage et à la validation à l'exécution
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// ❌ enum : génère du code et se compare mal aux valeurs reçues de l'API
enum Status {
  Todo = 'TODO',
}
```

## Nommage

| Élément                          | Convention                           | Exemple                                  |
| -------------------------------- | ------------------------------------ | ---------------------------------------- |
| Variables, fonctions             | `camelCase`                          | `dueDate`, `findOverdueTasks()`          |
| Types, classes, composants React | `PascalCase`                         | `TaskStatus`, `TasksService`, `TaskCard` |
| Constantes globales              | `UPPER_SNAKE_CASE`                   | `MAX_PAGE_SIZE`                          |
| Fichiers et dossiers             | `kebab-case`                         | `task-card.tsx`, `create-task.dto.ts`    |
| Booléens                         | préfixe `is`, `has`, `can`, `should` | `isOverdue`, `canEdit`                   |

- Une fonction commence par un verbe : `getTask`, `archiveTask`, `computeNextPosition`.
- Pas d'abréviation obscure : `workspaceMember` plutôt que `wsMbr`.

## Fonctions

- Courtes (repère : moins de 30 lignes), un seul niveau d'abstraction.
- Retours anticipés plutôt que des `if` imbriqués.
- Au-delà de 3 paramètres, passer un objet nommé.
- Pas de paramètre booléen qui change le comportement (`archive(task, true)`) : deux fonctions explicites.

## Erreurs

- Ne jamais lancer une chaîne (`throw 'oops'`) : toujours une instance d'`Error`.
- Les erreurs métier ont leur propre classe. Elle étend l'une des classes de base de `packages/shared/src/errors.ts` (`NotFoundError`, `ForbiddenError`, `ConflictError`, `BusinessRuleError`), toutes dérivées de `DomainError`. Côté API, ces classes fixent le code HTTP renvoyé, et chaque module range ses erreurs dans `<module>.errors.ts` : voir les [conventions NestJS](nestjs.md#erreurs).

```ts
export class TaskNotFoundError extends NotFoundError {
  constructor(taskId: string) {
    super(`Task ${taskId} not found`);
  }
}
```

- Dans un `catch`, l'erreur est de type `unknown` : la tester avant de l'utiliser.
- Ne jamais avaler une erreur (`catch {}`) sans la journaliser ou expliquer pourquoi en commentaire.

## Asynchrone

- `async`/`await` plutôt que `.then()`.
- Aucune promesse flottante (règle ESLint `@typescript-eslint/no-floating-promises`) : `await`, `return`, ou `void` assumé.
- Les opérations indépendantes s'exécutent en parallèle avec `Promise.all` :

```ts
const [task, members] = await Promise.all([
  this.tasksRepository.findOneByOrFail({ id: taskId, workspaceId }),
  this.membersService.listMembers(workspaceId),
]);
```

## Imports et modules

- Exports nommés uniquement (pas d'`export default`), sauf si un outil l'impose.
- `import type` pour ce qui n'est utilisé que comme type.
- Alias de chemins : `@api/*`, `@web/*`, `@taskflow/shared`. Pas de `../../../`.
- Pas de fichier `index.ts` de réexport (barrel) dans les applications : il crée des imports circulaires.

## Commentaires

- Expliquer le **pourquoi**, pas le quoi.
- Un `TODO` référence toujours un ticket : `// TODO(TF-142): remove once positions are migrated`.

## Tests

- Fichier de test à côté du code testé : `tasks.service.spec.ts`.
- Structure Arrange / Act / Assert, un comportement par test.
- Le nom du test décrit le comportement attendu : `it('rejects an assignee who is not a workspace member')`.
