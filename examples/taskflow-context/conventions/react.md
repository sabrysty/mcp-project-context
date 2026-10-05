---
title: Conventions React
tags: [react, frontend, hooks, state, tanstack-query, zustand]
owner: équipe front
updated: 2026-09-18
---

# Conventions React (`apps/web`)

Complètent les [conventions TypeScript](typescript.md).

## Structure

Organisation par feature :

```
apps/web/src/
├── app/                  # Routeur, providers, layout
├── features/
│   ├── auth/
│   └── tasks/
│       ├── api/          # Appels HTTP + hooks TanStack Query
│       ├── components/   # task-card.tsx, task-board.tsx…
│       ├── hooks/
│       └── types.ts
└── shared/
    ├── api/              # apiClient : fetch + gestion des tokens
    ├── ui/               # Design system : button.tsx, modal.tsx…
    └── lib/              # Utilitaires, dont logger.ts
```

- Une feature n'importe pas les fichiers internes d'une autre feature : ce qui est partagé va dans `shared/`.

## Composants

- Composants fonctions uniquement, exports nommés, un composant par fichier.
- Props typées par un `type` nommé `<Composant>Props`.
- Au-delà de ~150 lignes, le composant est découpé.
- Les composants d'affichage ne chargent pas de données : ils reçoivent des props.

```tsx
type TaskCardProps = {
  task: Task;
  onOpen: (taskId: string) => void;
};

export function TaskCard({ task, onOpen }: TaskCardProps) {
  return (
    <article className={styles.card}>
      <button type="button" onClick={() => onOpen(task.id)}>
        {task.title}
      </button>
      <PriorityBadge priority={task.priority} />
    </article>
  );
}
```

## Hooks

- Règles des hooks respectées (lint `react-hooks`).
- Hooks personnalisés préfixés par `use`, un par fichier, dans `hooks/` ou `api/`.
- `useEffect` sert uniquement à se synchroniser avec un système externe (abonnement, API du navigateur). **Jamais de chargement de données dans un `useEffect`** : c'est le rôle de TanStack Query.
- Pas d'état dérivé stocké : il se calcule pendant le rendu.

## Gestion d'état

| Type d'état                               | Outil                                |
| ----------------------------------------- | ------------------------------------ |
| Données serveur (tâches, membres…)        | TanStack Query                       |
| État d'interface partagé (panneau, thème) | Zustand (petits stores, sélecteurs)  |
| État local d'un composant                 | `useState` / `useReducer`            |
| Filtres, tri, pagination                  | Paramètres d'URL (`useSearchParams`) |
| Formulaires                               | React Hook Form + Zod                |

- Les données serveur ne sont **jamais** recopiées dans Zustand ou dans un `useState`.
- Les clés de requête viennent d'une fabrique propre à chaque feature :

```ts
export const taskKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'tasks'] as const,
  list: (workspaceId: string, filters: TaskFilters) =>
    [...taskKeys.all(workspaceId), 'list', filters] as const,
  detail: (workspaceId: string, taskId: string) =>
    [...taskKeys.all(workspaceId), 'detail', taskId] as const,
};
```

- Après une mutation, invalider les clés concernées : `queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) })`.

## Appels API

- Toujours via `apiClient` (`shared/api`), qui ajoute l'access token et gère son rafraîchissement (voir [authentification](../features/authentication.md)).
- Jamais de `fetch` direct dans un composant.
- Fonctions typées avec les contrats de `@taskflow/shared`.

## Styles

- CSS Modules (`task-card.module.css`) et variables CSS du design system pour les couleurs et les espacements.
- Pas de style inline, sauf pour une valeur réellement dynamique.

## Accessibilité

- Éléments sémantiques : un `<button>` pour une action, jamais une `<div onClick>`.
- Chaque champ de formulaire a un `<label>` associé.
- Navigation au clavier et gestion du focus dans les modales.
- Lint `jsx-a11y` actif.

## Sécurité

- **Pas de `dangerouslySetInnerHTML`** (règle `no-dangerously-set-html`). La description Markdown des tâches est rendue avec `react-markdown`, qui n'interprète pas le HTML brut. Si du HTML est inévitable, il est assaini avec DOMPurify et validé en revue.
- Aucun token dans `localStorage` ni `sessionStorage` : tout script injecté (XSS) pourrait le lire.
- Les variables `VITE_*` sont publiques (intégrées au bundle) : jamais de secret dedans.
- Pas de `console.log` dans le code livré (règle `no-console-log`) : utiliser `shared/lib/logger.ts`, qui transmet les erreurs à l'outil de monitoring.

## Performance

- `memo`, `useMemo` et `useCallback` seulement pour un problème mesuré (React DevTools Profiler).
- Clés de liste stables (identifiants), jamais l'index du tableau.
- Routes chargées à la demande (`lazy`).

## Chargement et erreurs

- Toute requête gère ses trois états : chargement (squelette), erreur (message et bouton « Réessayer »), liste vide.
- Une Error Boundary par route.

## Tests

- Vitest + Testing Library : tester ce que voit l'utilisateur, pas l'implémentation.
- Sélection par rôle et libellé : `getByRole('button', { name: 'Créer la tâche' })`.
- API simulée avec MSW.
