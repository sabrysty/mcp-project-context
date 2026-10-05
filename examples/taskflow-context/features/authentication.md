---
title: Authentification
tags: [auth, jwt, nestjs]
owner: équipe back
updated: 2026-10-01
---

# Authentification

## But

Permettre à un utilisateur de créer un compte, de se connecter et de rester connecté de façon sûre, sans jamais exposer de token à du JavaScript malveillant.

## Principe

- **Access token** : JWT valable **15 minutes**, envoyé dans l'en-tête `Authorization: Bearer <token>`. Le front le garde **en mémoire uniquement**.
- **Refresh token** : valeur aléatoire opaque (256 bits) valable **7 jours**, transportée dans un cookie `httpOnly`. La base n'en conserve que le **hash SHA-256**.
- **Rotation** : chaque rafraîchissement invalide le refresh token utilisé et en émet un nouveau, de la même famille.
- **Détection de réutilisation** : si un refresh token déjà utilisé est présenté de nouveau, toute sa famille est révoquée (vol probable) et l'utilisateur doit se reconnecter.

## Flux

### Inscription

1. `POST /auth/register` avec l'e-mail, le mot de passe et le nom affiché.
2. L'e-mail est normalisé (espaces retirés, minuscules) ; le mot de passe fait entre 12 et 128 caractères.
3. Le mot de passe est haché avec argon2id, puis l'utilisateur est créé.
4. La réponse est la même que pour une connexion réussie : l'utilisateur est connecté.

Un e-mail déjà utilisé renvoie `409`. L'énumération de comptes que cela permet est freinée par la limitation de débit.

### Connexion

1. `POST /auth/login` avec l'e-mail et le mot de passe.
2. Si l'utilisateur n'existe pas, un hash factice est quand même vérifié : le temps de réponse ne révèle pas l'existence du compte.
3. En cas d'échec, un message unique : « Identifiants invalides », que l'e-mail existe ou non.
4. En cas de succès : access token dans le body, refresh token dans le cookie.

### Rafraîchissement

1. Le front reçoit un `401` sur un appel à l'API.
2. `apiClient` appelle `POST /auth/refresh` (le cookie part automatiquement), **une seule fois** pour toutes les requêtes en échec au même moment.
3. Si le rafraîchissement réussit, les requêtes en attente sont rejouées avec le nouvel access token. S'il échoue, l'utilisateur est renvoyé vers la page de connexion.

Au chargement de l'application, un appel à `/auth/refresh` restaure la session si le cookie est encore valide.

### Déconnexion

`POST /auth/logout` révoque la famille du refresh token courant et efface le cookie. L'access token reste techniquement valide jusqu'à son expiration (15 minutes au plus) : ce compromis est accepté.

### Mot de passe oublié

1. `POST /auth/password/forgot` répond toujours `202`, que l'e-mail existe ou non.
2. Si le compte existe, un e-mail contient un lien à usage unique valable 30 minutes (le token est stocké haché).
3. `POST /auth/password/reset` change le mot de passe et révoque toutes les sessions de l'utilisateur.

## Endpoints

Préfixe : `/api/v1`.

| Méthode | Route                   | Accès                  | Corps                              | Réponses           |
| ------- | ----------------------- | ---------------------- | ---------------------------------- | ------------------ |
| POST    | `/auth/register`        | public                 | `{ email, password, displayName }` | 201, 400, 409, 429 |
| POST    | `/auth/login`           | public                 | `{ email, password }`              | 200, 400, 401, 429 |
| POST    | `/auth/refresh`         | cookie `refresh_token` | —                                  | 200, 401           |
| POST    | `/auth/logout`          | authentifié            | —                                  | 204                |
| GET     | `/auth/me`              | authentifié            | —                                  | 200, 401           |
| POST    | `/auth/password/forgot` | public                 | `{ email }`                        | 202, 429           |
| POST    | `/auth/password/reset`  | public                 | `{ token, newPassword }`           | 204, 400           |

Réponse d'une connexion réussie :

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiJ9…",
  "expiresIn": 900,
  "user": { "id": "3f6c2a9e-…", "email": "camille@exemple.fr", "displayName": "Camille" }
}
```

Cookie de rafraîchissement : `refresh_token`, avec `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth` et `Max-Age=604800`.

## Modèle de données

- `users` : `id` (uuid), `email` (unique, normalisé), `password_hash`, `display_name`, `last_login_at`, `created_at`, `updated_at`.
- `refresh_tokens` : `id`, `user_id`, `family_id`, `token_hash` (SHA-256), `expires_at`, `revoked_at`, `replaced_by_id`, `created_at`.

## Implémentation

### Back (`apps/api/src/auth/`)

- `auth.controller.ts` et `auth.service.ts` : les flux ci-dessus.
- `tokens.service.ts` : émission, rotation et révocation des refresh tokens.
- `strategies/jwt.strategy.ts` : validation de l'access token (Passport JWT). Le payload ne contient que `sub` (l'identifiant de l'utilisateur), `iat` et `exp` : aucune donnée personnelle.
- `common/guards/jwt-auth.guard.ts` : guard global ; les routes ouvertes portent `@Public()`.
- Secrets et durées lus via `ConfigService` : `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL`.

### Front (`apps/web/src/`)

- `features/auth/auth-provider.tsx` : garde l'access token en mémoire et expose `useAuth()`.
- `shared/api/api-client.ts` : ajoute l'en-tête `Authorization` et gère l'enchaînement `401` → rafraîchissement → rejeu.
- `features/auth/protected-route.tsx` : redirige vers `/login` si l'utilisateur n'est pas connecté.

## Points d'attention

- **Limitation de débit** : 5 tentatives par minute sur `/auth/login` pour un même couple IP + e-mail ; 3 demandes par heure sur `/auth/password/forgot`.
- **CSRF** : `/auth/refresh` s'appuie sur un cookie. `SameSite=Strict` et la vérification de l'en-tête `Origin` empêchent de l'appeler depuis un autre site.
- **Jamais dans les logs** : mot de passe, token, hash. Un échec de connexion est journalisé avec l'IP et l'e-mail masqué.
- **Jamais dans `localStorage`** : ni l'access token, ni le refresh token.
- **Payload JWT minimal** : les rôles ne sont pas dans le token. Ils sont vérifiés en base, par workspace, à chaque requête, car ils peuvent changer à tout moment.
- Un changement de mot de passe révoque toutes les sessions de l'utilisateur.

## Tests à maintenir

- e2e : inscription ; connexion réussie et échouée ; message identique pour un e-mail inconnu et un mauvais mot de passe ; rotation ; réutilisation d'un refresh token révoqué (famille révoquée) ; déconnexion ; limitation de débit.
- Unitaires : `TokensService` (expiration, rotation, révocation).
