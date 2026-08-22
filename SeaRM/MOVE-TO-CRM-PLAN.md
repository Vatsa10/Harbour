# Harbour restructure: SeaRM CRM moves into crm/

Harbour holds two products. SeaRM (this CRM) goes under `crm/`; the ERP another
session is building goes under `erp/`. Root becomes a container, not a workspace.

## Target

```
Harbour/                 <- repo root, .git lives here
├── crm/                 <- SeaRM (everything currently at root)
│   ├── packages/
│   ├── node_modules/
│   ├── nx.json, package.json, tsconfig.base.json, yarn.lock
│   ├── .yarn/, .yarnrc.yml, .nx/, .cache/
│   └── docs/, scripts/, .github/ (CRM-specific CI)
├── erp/                 <- other session
├── ref/                 <- 14 reference repos (gitignored, stays at root)
├── LICENSE              <- stays at root, AGPL + Twenty attribution
└── README.md            <- Harbour-level, names both products
```

## Do NOT move (stays at root)
- `.git` — moving it rewrites nothing but breaks every path
- `ref/` — reference sources, gitignored, shared by both products
- `LICENSE` — AGPL-3.0 obligations apply repo-wide
- `*.bundle` — archival snapshots

## Order (each step verified before the next)

1. **Precondition: zero agents running, zero uncommitted files.**
   Moving while a process holds a file is how `twenty-ui` lost 747 files and
   how the first root move half-completed. `git status --short` must be empty.
2. Stop Docker and every node process — they hold `node_modules` and `dist`:
   `Get-Process node | Stop-Process -Force`
3. `mkdir crm`, then `git mv` each root entry into `crm/` EXCEPT the do-not-move
   list above. Use `git mv` so history follows.
4. `node_modules/` is not tracked — move it with `Move-Item`, not `git mv`.
5. **Repoint the 18 workspace junctions.** They are absolute paths to
   `.../AI-CRM/packages/searm-*` and will all dangle. Recreate as
   `crm/node_modules/searm-* -> crm/packages/searm-*`:
   ```powershell
   Get-ChildItem crm\packages -Directory |
     Where-Object { $_.Name -like 'searm-*' -or $_.Name -eq 'create-searm-app' } |
     ForEach-Object {
       $l = "crm\node_modules\$($_.Name)"
       if (Test-Path $l) { Remove-Item $l -Recurse -Force }
       New-Item -ItemType Junction -Path $l -Target $_.FullName | Out-Null
     }
   ```
6. Fix root-relative references that assumed the old depth:
   - `.github/workflows/*` — `working-directory: crm`
   - `packages/searm-docker/*` compose file paths
   - `scripts/lowmem.sh` callers use `../../scripts/lowmem.sh` from a package;
     that stays correct since the relative depth is unchanged inside `crm/`
   - `.mcp.json`, `.vscode/*.code-workspace`
7. Verify, in this order, and do not skip:
   - `cd crm/packages/searm-server && npx tsgo -p tsconfig.json --noEmit` -> 0
   - `cd crm/packages/searm-front && npx tsgo -p tsconfig.json --noEmit` -> 0
   - `cd crm/packages/searm-server && NODE_ENV=development npx nest start`
     -> `Nest application successfully started`
   - `docker compose -f crm/packages/searm-docker/docker-compose.dev.yml up -d`
8. Commit as one change. Tag `pre-crm-move` first so it is reversible.

## Known traps, learned the hard way tonight
- Bash `mv` fails with "Permission denied" here; PowerShell `Move-Item` works.
- Bash `ln -s` COPIES instead of linking on this filesystem. Use
  `New-Item -ItemType Junction`.
- `git checkout -- <path>` restores tracked files only. `dist/` is gitignored,
  so a lost build output is gone until rebuilt.
- Long paths exceed Windows' 260 chars in
  `searm-server/.../row-level-permission-predicate-group/services/`; python's
  `os.path.exists` returns False there while `sed` still works.
- Docker compose project name is derived from the directory. Moving to `crm/`
  will create NEW volumes; the current `searm-dev_dev-db-data` (81 core tables,
  149 migrations) will be orphaned. Either re-run
  `npx nx run searm-server:database:init:prod` after the move, or set
  `name:` explicitly in the compose file to pin the project name.
