# Contributing

## Branch policy

- `main` — stable/product branch. Only accepted releases land here.
- `develop` — active development/integration branch.
- `feature/*` — optional, temporary branches created from `develop` for a single change.

Normal workflow:

```text
feature/* -> develop -> live/test acceptance -> main
```

Do not commit unfinished development work directly to `main`. GitHub's default branch stays
`main`, since that is the stable product a new visitor should see first.
