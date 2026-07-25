# Claude Skills — Moneytracer

Skills vendored in from [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills)
(MIT licensed — see `LICENSE`), picked for relevance to this stack
(FastAPI + SQLAlchemy + Postgres/SQLite backend, React/Vite frontend).

Any Claude Code session opened in this repo should pick these up
automatically from `.claude/skills/`.

## Included

| Skill | Why it's here |
|---|---|
| `fastapi-expert` | Backend framework — async endpoints, Pydantic V2, JWT auth |
| `postgres-pro` | Production Postgres — the multi-tenant schema-per-type DB |
| `sql-pro` | General SQL correctness/performance across both SQLite (dev) and Postgres (prod) |
| `database-optimizer` | Query/index tuning as the dataset grows past dev-scale |
| `react-expert` | Frontend framework |
| `javascript-pro` | General JS correctness for the frontend outside React specifics |
| `api-designer` | REST API design consistency across the ~200 existing endpoints |
| `code-reviewer` | General review pass before merging agent-written changes |
| `security-reviewer` | Auth, multi-tenant data isolation, injection/XSS review |
| `debugging-wizard` | Structured debugging (useful given the multi-agent coordination issues we've hit) |
| `test-master` | Test strategy — the codebase currently has none |
| `code-documenter` | Keeping docs in sync as multiple agents touch the same files |
| `fullstack-guardian` | End-to-end review across backend+frontend changes together |
| `playwright-expert` | E2E testing for the React frontend, if/when that gets built out |

## Not included

The source repo has ~65 skills total — most were dropped as not relevant to
this stack (Angular, Vue, Kotlin, Swift, Rust, PHP, Laravel, Rails, Django,
.NET, Java, C#, C++, Go, Flutter, React Native, WordPress, Shopify,
Salesforce, Kubernetes, Terraform, GraphQL, WebSockets, ML/RAG/fine-tuning,
embedded systems, game dev, etc). If a future need genuinely calls for one
of these, it's a two-minute copy from the source repo rather than carrying
dead weight now.
