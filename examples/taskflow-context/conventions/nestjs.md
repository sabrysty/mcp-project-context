---
title: Conventions NestJS
tags: [nestjs, backend, dto, validation, config, logger, typeorm]
owner: équipe back
updated: 2026-09-24
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
│   ├── decorators/           # @Public(), @CurrentUser(), @Roles()
│   ├── filters/              # Filtre d'exceptions global
│   └── guards/               # JwtAuthGuard, WorkspaceMemberGuard, RolesGuard
├── database/
│   └── migrations/
└── tasks/
    ├── tasks.module.ts
    ├── tasks.controller.ts
    ├── tasks.service.ts
    ├── tasks.service.spec.ts
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

- Côté HTTP : les exceptions intégrées de Nest (`NotFoundException`, `ConflictException`, `ForbiddenException`…).
- Les services lèvent des erreurs métier (`TaskNotFoundError`…) ; le filtre global `DomainExceptionFilter` les traduit en réponses HTTP.
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
- L'utilisateur courant s'obtient avec `@CurrentUser()`, jamais en lisant un identifiant dans le body.
- L'appartenance au workspace est vérifiée par `WorkspaceMemberGuard`, les rôles par `@Roles('admin', 'owner')`.
- Détails : [authentification](../features/authentication.md).

## Tests

- Unitaires (Jest) pour les services, avec repositories et services externes mockés.
- e2e (Supertest) pour chaque endpoint : cas nominal, validation, `401`, `403` ou `404`.
- Base PostgreSQL dédiée aux tests e2e, recréée à chaque exécution.
