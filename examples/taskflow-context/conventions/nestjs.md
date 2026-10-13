---
title: Conventions NestJS
tags: [nestjs, backend, dto, validation, config, logger, typeorm]
owner: équipe back
updated: 2026-10-13
---

# Conventions NestJS (`apps/api`)

Complètent les [conventions TypeScript](typescript.md).

## Structure

Un module par domaine métier : `auth`, `users`, `workspaces`, `tasks`. Le code transverse va dans `common/`, la configuration dans `config/`.

```
apps/api/src/
├── app.module.ts
├── main.ts
├── config/
│   └── env.schema.ts         # Validation des variables d'environnement
├── common/
│   ├── decorators/           # @Public(), @CurrentUser(), @CurrentMember(), @Roles()
│   ├── filters/              # DomainExceptionFilter : erreurs métier → réponses HTTP
│   └── guards/               # JwtAuthGuard, WorkspaceMemberGuard, RolesGuard
├── database/
│   └── migrations/
└── tasks/
    ├── tasks.module.ts
    ├── tasks.controller.ts
    ├── tasks.service.ts
    ├── tasks.service.spec.ts
    ├── tasks.errors.ts       # Erreurs métier du module
    ├── dto/
    │   ├── create-task.dto.ts
    │   ├── update-task.dto.ts
    │   └── task-response.dto.ts
    └── entities/
        └── task.entity.ts
```

- Un module n'utilise jamais directement le repository d'un autre module : il passe par le service que ce module exporte.

## Contrôleurs

- Minces : validation (par les DTO), appel du service, mise en forme de la réponse. Aucune règle métier.
- Les identifiants de route sont validés avec `ParseUUIDPipe`.
- Ils renvoient toujours un DTO de réponse, **jamais une entité** : une entité peut contenir des champs sensibles (`passwordHash`).

```ts
@Controller('workspaces/:workspaceId/tasks')
@UseGuards(WorkspaceMemberGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    const task = await this.tasksService.create(workspaceId, user.id, dto);
    return TaskResponseDto.fromEntity(task);
  }
}
```

## DTO et validation

- Un DTO par cas d'usage : `CreateTaskDto`, `UpdateTaskDto` (dérivé avec `PartialType`), `TaskResponseDto`.
- Validation par `class-validator` : chaque chaîne a une longueur maximale, chaque nombre des bornes.
- Les valeurs autorisées (statuts, priorités) viennent de `@taskflow/shared`, pour rester alignées avec le front.

```ts
export class CreateTaskDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsIn(TASK_PRIORITIES)
  priority!: TaskPriority;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}
```

Le `ValidationPipe` est global, configuré une seule fois dans `main.ts` :

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true, // retire les champs absents du DTO…
    forbidNonWhitelisted: true, // …et rejette la requête s'il y en a
    transform: true,
  }),
);
```

## Configuration

- Toutes les variables d'environnement sont déclarées et validées au démarrage dans `config/env.schema.ts` (Zod) : l'API refuse de démarrer si une variable manque ou est invalide.
- Dans le code, la configuration se lit **uniquement** via `ConfigService`, typé. `process.env` est interdit en dehors de `config/`.
- Aucun secret dans le code ni dans le dépôt : `.env` est ignoré par git, `.env.example` liste les variables sans valeur réelle (règle `no-hardcoded-secret`).

```ts
// ✅
constructor(private readonly config: ConfigService<Env, true>) {}

getAccessSecret(): string {
  return this.config.get('JWT_ACCESS_SECRET', { infer: true });
}
```

```ts
// ❌ secret codé en dur
const secret = 'dev-secret-do-not-use';

// ❌ lecture directe de l'environnement hors du module de configuration
const ttl = process.env.JWT_ACCESS_TTL;
```

## Logs

- Logger de NestJS uniquement : `private readonly logger = new Logger(TasksService.name)`. **Jamais de `console.log`** (règle `no-console-log`).
- Niveaux : `error` (action requise), `warn` (anormal mais géré), `log` (événement métier notable), `debug` (diagnostic, désactivé en production).
- Ne jamais journaliser de mot de passe, de token, de hash, ni de donnée personnelle complète (e-mail masqué : `c***@exemple.fr`).
- Chaque message porte les identifiants utiles au diagnostic : `taskId`, `userId`, `workspaceId`. Le `requestId` est ajouté automatiquement par l'intercepteur de logs.

```ts
this.logger.warn(`Task ${taskId} archived by a non-creator (user ${userId})`);
```

## Erreurs

- Un service ne connaît pas HTTP : il ne lève jamais d'exception de Nest (`NotFoundException`…), seulement des **erreurs métier**. Le filtre global `DomainExceptionFilter` les traduit en réponses HTTP.
- Les exceptions intégrées de Nest restent réservées aux contrôleurs, guards et pipes.
- Chaque erreur métier étend l'une des classes de base de `packages/shared/src/errors.ts`, toutes dérivées de `DomainError`. C'est cette classe qui fixe le code HTTP :

| Classe de base      | HTTP | Quand                                                               | Exemples                                            |
| ------------------- | ---- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `NotFoundError`     | 404  | La ressource n'existe pas, ou appartient à un autre workspace       | `TaskNotFoundError`                                 |
| `ForbiddenError`    | 403  | Le membre n'a pas le droit de faire cette action                    | `TaskActionForbiddenError`                          |
| `ConflictError`     | 409  | L'état a changé entre-temps, ou une valeur unique est déjà utilisée | `TaskVersionConflictError`, `EmailAlreadyUsedError` |
| `BusinessRuleError` | 422  | Règle métier non respectée                                          | `AssigneeNotMemberError`                            |

- Toute autre erreur devient une `500` : le filtre la journalise (niveau `error`, avec le `requestId`) et ne renvoie qu'un message générique.
- Les erreurs d'un module sont rangées dans `<module>/<module>.errors.ts` : `tasks/tasks.errors.ts`. Leur message est renvoyé au client : en anglais, sans donnée sensible.

```ts
// tasks/tasks.errors.ts
export class TaskActionForbiddenError extends ForbiddenError {
  constructor(taskId: string, action: 'edit' | 'archive' | 'restore') {
    super(`Not allowed to ${action} task ${taskId}`);
  }
}
```

- Format de réponse unique : `{ statusCode, error, message, requestId }`. Jamais de stack trace renvoyée au client.

## Accès aux données (TypeORM)

- Repositories injectés avec `@InjectRepository(Task)`.
- Requêtes complexes : `QueryBuilder` avec **paramètres nommés**. Jamais de SQL construit par concaténation (règle `no-sql-concat`).

```ts
// ✅ paramètres liés : la valeur ne peut pas modifier la requête
const tasks = await this.tasksRepository
  .createQueryBuilder('task')
  .where('task.workspaceId = :workspaceId', { workspaceId })
  .andWhere('task.title ILIKE :search', { search: `%${escapeLike(q)}%` })
  .getMany();
```

```ts
// ❌ injection SQL
const tasks = await this.dataSource.query("SELECT * FROM tasks WHERE title LIKE '%" + q + "%'");
```

- Transactions avec `this.dataSource.transaction(async (manager) => { … })` dès que plusieurs écritures doivent réussir ou échouer ensemble.
- Migrations générées, puis relues avant merge ; `synchronize: true` est interdit en dehors des tests.
- Colonnes en `snake_case` (naming strategy), propriétés en `camelCase`.
- Charger les relations nécessaires dans la même requête : pas de requêtes N+1.

## Authentification et autorisation

- `JwtAuthGuard` est global : toute route est protégée par défaut, les routes publiques portent `@Public()`.
- L'utilisateur courant s'obtient avec `@CurrentUser()`, jamais en lisant un identifiant dans le body. Il ne porte que son `id` (`AuthenticatedUser`) : le token ne contient aucun rôle.
- `WorkspaceMemberGuard` vérifie que l'utilisateur est membre du workspace de la route. Il charge pour cela, en base et à chaque requête, son appartenance au workspace, que les contrôleurs obtiennent avec `@CurrentMember()` : `WorkspaceMember`, soit `{ userId, workspaceId, role }`.
- **Le rôle se lit dans `@CurrentMember()`, jamais dans le token** : un même utilisateur peut être admin d'un workspace et simple member d'un autre, et son rôle peut changer à tout moment.
- Un droit qui ne dépend que du rôle (gérer les membres) se déclare sur la route : `@Roles('admin', 'owner')`, vérifié par `RolesGuard`.
- Un droit qui dépend aussi de la ressource (« si auteur ») se vérifie dans le service, une fois la ressource chargée : le contrôleur lui passe le `WorkspaceMember`.

```ts
// ✅ le service reçoit l'appartenance chargée par le guard : workspace et rôle compris
@Delete(':taskId')
@HttpCode(204)
async archive(
  @Param('taskId', ParseUUIDPipe) taskId: string,
  @CurrentMember() member: WorkspaceMember,
): Promise<void> {
  await this.tasksService.archive(member, taskId);
}
```

```ts
// ❌ rôle lu sur l'utilisateur du token : il n'en a pas, et un rôle dépend du workspace
await this.tasksService.archive(workspaceId, taskId, user.id, user.role);
```

- Détails : [authentification](../features/authentication.md).

## Tests

- Unitaires (Jest) pour les services, avec repositories et services externes mockés.
- e2e (Supertest) pour chaque endpoint : cas nominal, validation, `401`, `403` ou `404`.
- Base PostgreSQL dédiée aux tests e2e, recréée à chaque exécution.
