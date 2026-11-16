# Memo knowledge integration

Graphiti 0.31.2 runs through a private Python stdin/stdout bridge, not an exposed REST/MCP server. The Node API applies existing session/Bearer authentication and derives tenant groups server-side. Development and production use different group prefixes.

Required secrets: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, OPENAI_API_KEY. Direct OpenAI API credits are required for embeddings and extraction; this is not the application's managed AI proxy.

The bridge discovers the user's default Neo4j database instead of assuming `neo4j`. `npm run build` installs Python dependencies from `server/graphiti/requirements.txt` into project-local `.pythonlibs` before building Vite. Python 3.11 and uv must be available in the deployment image. Keep this manifest scoped to the bridge: a root `pyproject.toml` triggers an extra deployment `uv sync` step that targets the read-only Nix interpreter and fails before the explicit build command runs.

Users explicitly enable indexing through Memo's Graphiti panel. Memo text is sent to Neo4j and OpenAI only after enabling. A PostgreSQL ledger persists consent/status; a session advisory lock prevents overlapping workers. Each minute, up to five changed memos per enabled user are processed. Failed items require Retry (or a content change). Original memos remain authoritative.

Edits remove/rebuild their episode. Deleted memos are removed on the next worker pass. Search evidence is filtered against live owner-scoped memos and content hashes so stale or deleted evidence is not returned while reconciliation is pending. Editing an original memo is a correction, not a retained revision history; temporal changes should be recorded in separate dated memos. Full historical browsing is not implemented. Attachments are not ingested; memos above 60,000 content characters fail explicitly.

Autoscale workers run only while the app process is alive: opening the app resumes reconciliation, not a guaranteed always-on scheduler. Existing notebooks are never automatically opted in.

Verification: `node --test tests/memoKnowledgeEvidence.test.js`; `echo '{"op":"health"}' | python server/graphiti/bridge.py`. Live extraction/search verification requires funded OpenAI credentials. Do not test by opting in a real/shared user's entire notebook.
