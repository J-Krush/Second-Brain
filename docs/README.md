# Docs

Reference material for people and coding agents working on Second Brain. The product brief — vision, principles, schema, API contract — is [`../PROJECT.md`](../PROJECT.md); these documents describe how the brief is realised and what we learned doing it.

| Document | Read it when |
| --- | --- |
| [`architecture.md`](architecture.md) | You need to know how a request, a file, a search, or a cron job actually flows through the system, or where code lives |
| [`local-development.md`](local-development.md) | You are setting the project up on a machine, or something in the dev loop is misbehaving |
| [`deployment.md`](deployment.md) | You are standing up your own Cloudflare deployment, rotating a secret, or debugging CI |
| [`decisions.md`](decisions.md) | You are about to change something foundational and want to know why it is the way it is; or you just made such a change and need to record it |
| [`conventions.md`](conventions.md) | You are writing code — rules, patterns, UI system, keyboard map, how to add a migration or a route |
| [`api.md`](api.md) | You are calling or extending the HTTP API (including from a non-browser capture client) |
| [`ingestion.md`](ingestion.md) | You are setting up the iPhone share sheet or wondering why a shared link looks the way it does |

Keep these current. A doc that describes the previous design is worse than no doc: when a PR changes behaviour described here, the same PR updates the page.
