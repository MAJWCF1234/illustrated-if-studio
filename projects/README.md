# Projects

Each folder is one **illustrated text-based RPG** project (`project.json` + `story/` + `assets/` + `theme/`).

| Project | Layout | Notes |
|---------|--------|-------|
| `sample-project/` | `illustrated-if` | Generic demo bundled with the studio |

Default active project: `sample-project` (overridden per machine in the git-ignored `studio-settings.json`).
Your own games live here too — add them from the editor **Projects** tab or CLI (`use <id>`).

## Switch / import

- Editor **Projects** tab, or CLI tab: `use <id>`, `import folder|html …`
- Override for one process: `IF_PROJECT=/path/to/project` (legacy alias: `VN_PROJECT`)

```bash
npm start
# or desktop (dev): npm run electron
# or friendly launcher: double-click "Illustrated IF Studio.vbs"
```

Raw export destination is set under **Projects** (or CLI `dest <path>`), default `dist/raw-projects/`.
