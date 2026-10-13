---
title: Règles de sécurité
tags: [security, owasp, secrets, injection, xss, auth]
owner: référent sécurité
updated: 2026-10-13
---

# Règles de sécurité

Ces règles s'appliquent à tout le code de TaskFlow, qu'il soit écrit à la main ou généré par une IA. Les règles qui portent un identifiant (`no-eval`…) sont vérifiées automatiquement par l'outil `check_code`, à partir de [`rules.json`](rules.json) ; les autres relèvent de la revue de code.

> La vérification automatique est un premier filet de sécurité, fondé sur des expressions régulières. Elle ne remplace ni la revue de code, ni le linter, ni l'analyse des dépendances.

## Principes

1. **Ne jamais faire confiance à l'entrée** : tout ce qui vient du client (body, query, params, en-têtes, cookies) est validé.
2. **Moindre privilège** : chaque route vérifie l'authentification **et** le droit d'accès à la ressource demandée.
3. **Défense en profondeur** : validation à l'entrée, requêtes paramétrées, échappement à l'affichage.
4. **Aucun secret dans le code** : ni dans le dépôt, ni dans les logs, ni dans le bundle front.

## Règles vérifiées automatiquement

| Identifiant               | Sévérité | Résumé                                                  |
| ------------------------- | -------- | ------------------------------------------------------- |
| `no-eval`                 | error    | `eval()` et `new Function()` interdits                  |
| `no-hardcoded-secret`     | error    | Pas de secret codé en dur                               |
| `no-sql-concat`           | error    | Pas de SQL construit par concaténation ou interpolation |
| `no-console-log`          | warning  | Pas de `console.log` en production                      |
| `no-dangerously-set-html` | warning  | Pas de `dangerouslySetInnerHTML`                        |

### `no-eval`

**Pourquoi** : `eval()` (comme `new Function()`) exécute une chaîne comme du code. Si cette chaîne contient une donnée utilisateur, l'attaquant fait exécuter son propre code, sur le serveur ou dans le navigateur.

```ts
// ❌
const filters = eval('(' + rawFilters + ')');

// ✅ parser, puis valider
const filters = taskFiltersSchema.parse(JSON.parse(rawFilters));
```

### `no-hardcoded-secret`

**Pourquoi** : un secret commité reste dans l'historique git, même après sa suppression. Toute personne ayant accès au dépôt, ou à une copie, peut le lire.

```ts
// ❌
const jwtSecret = 'super-secret-value-123';

// ✅ lu depuis la configuration, validée au démarrage
const jwtSecret = this.config.get('JWT_ACCESS_SECRET', { infer: true });
```

- Un secret exposé par erreur est **révoqué et remplacé immédiatement**, puis signalé au référent sécurité. Le retirer du code ne suffit pas.
- Les secrets de production sont stockés dans le gestionnaire de secrets de l'hébergeur, jamais dans un fichier partagé.

### `no-sql-concat`

**Pourquoi** : concaténer une valeur dans une requête SQL ouvre la porte à l'injection SQL, c'est-à-dire à la lecture ou à la modification de toute la base.

```ts
// ❌
await this.dataSource.query("SELECT * FROM tasks WHERE id = '" + taskId + "'");

// ✅ requête paramétrée
await this.dataSource.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
```

Les template literals (`` `… WHERE id = ${taskId}` ``) posent exactement le même problème : une valeur n'est jamais interpolée dans du SQL. Voir aussi les [conventions NestJS](../conventions/nestjs.md#accès-aux-données-typeorm).

### `no-console-log`

**Pourquoi** : `console.log` contourne la configuration des logs (niveaux, format, destination) et finit souvent par exposer des données sensibles en production.

- Back : `Logger` de NestJS (voir les [conventions NestJS](../conventions/nestjs.md#logs)).
- Front : `shared/lib/logger.ts`.

### `no-dangerously-set-html`

**Pourquoi** : `dangerouslySetInnerHTML` insère du HTML sans échappement. Si son contenu vient d'un utilisateur, c'est une faille XSS : vol de session, actions effectuées à la place de la victime.

```tsx
// ❌
<div dangerouslySetInnerHTML={{ __html: task.description }} />

// ✅ rendu Markdown, sans HTML brut
<Markdown>{task.description}</Markdown>
```

## Règles vérifiées en revue de code

### Contrôle d'accès (IDOR)

- Une ressource est toujours chargée **avec** son workspace (`where: { id: taskId, workspaceId }`), jamais par son seul identifiant.
- L'identité de l'utilisateur vient du token (`@CurrentUser()`), jamais du body ni de la query.
- Son rôle, lui, ne vient **jamais** du token : il dépend du workspace et peut changer à tout moment. Il se lit dans `@CurrentMember()`, chargé en base à chaque requête par `WorkspaceMemberGuard`.
- Un droit qui dépend de la ressource (« si auteur ») se vérifie dans le service, une fois la ressource chargée.
- Ressource d'un autre workspace : répondre **404**, pas 403, pour ne pas révéler son existence.

### Validation des entrées

- Tout body, query et param passe par un DTO validé (`ValidationPipe` avec `whitelist` et `forbidNonWhitelisted`).
- Longueur maximale sur chaque chaîne, bornes sur chaque nombre, pagination plafonnée à 100 éléments.

### Authentification

- Mots de passe hachés avec argon2id, jamais stockés ni journalisés en clair.
- Tokens, cookies et limitation de débit : voir la feature [authentification](../features/authentication.md).

### Données sensibles

- Jamais de mot de passe, token, hash ou secret dans les logs, les messages d'erreur ou les réponses d'API.
- Les réponses d'API sont des DTO explicites : un champ ajouté à une entité n'est pas exposé par accident.

### En-têtes et exposition de l'API

- `helmet` activé ; CORS limité aux origines connues (jamais `*` avec des cookies).
- Limitation de débit (`@nestjs/throttler`) globale, renforcée sur les routes d'authentification.
- En production, aucune stack trace n'est renvoyée au client.

### Dépendances

- Dependabot activé et `pnpm audit` en CI : une vulnérabilité `high` ou `critical` bloque le merge.
- Toute nouvelle dépendance est justifiée dans la PR (maintenance, usage, taille).

## Signaler un problème

Une faille suspectée se signale en privé au référent sécurité (canal `#security`), jamais dans un ticket public.
