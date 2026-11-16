"""Private stdin/stdout bridge. No public listener or user-provided database queries."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / ".pythonlibs/lib/python3.11/site-packages"))
import os, json, asyncio, logging
from datetime import datetime, timezone
os.environ["GRAPHITI_TELEMETRY_ENABLED"] = "false"
logging.disable(logging.CRITICAL)
from graphiti_core import Graphiti
from graphiti_core.nodes import EpisodeType, EpisodicNode
from graphiti_core.errors import NodeNotFoundError
from graphiti_core.llm_client import OpenAIClient, LLMConfig
from graphiti_core.driver.neo4j_driver import Neo4jDriver
from neo4j import AsyncGraphDatabase

async def main():
    data = json.load(sys.stdin)
    uri, user, password = os.environ["NEO4J_URI"].strip(), os.environ["NEO4J_USER"].strip(), os.environ["NEO4J_PASSWORD"]
    async with AsyncGraphDatabase.driver(uri, auth=(user, password)) as connection:
        async with connection.session() as session:
            response = await session.run("RETURN 1")
            database = (await response.consume()).database
    graph = Graphiti(graph_driver=Neo4jDriver(uri, user, password, database=database),
                     llm_client=OpenAIClient(LLMConfig(api_key=os.environ["OPENAI_API_KEY"],
                         model="gpt-4.1-mini", small_model="gpt-4.1-mini")), max_coroutines=2)
    try:
        op = data["op"]
        if op == "health":
            result = {"ok": True}
        elif op == "init":
            await graph.build_indices_and_constraints()
            result = {"ok": True}
        elif op == "remove":
            try:
                await graph.remove_episode(data["uuid"])
            except NodeNotFoundError:
                pass
            result = {"ok": True}
        elif op == "add":
            reference_time = datetime.fromisoformat(data["time"].replace("Z", "+00:00"))
            # Graphiti treats a supplied UUID as an existing episode, not a new ID.
            await EpisodicNode(uuid=data["uuid"], name=data["title"], group_id=data["group"],
                source=EpisodeType.text, source_description="Monotecho Memo",
                content=data["content"], valid_at=reference_time).save(graph.driver)
            await graph.add_episode(name=data["title"], episode_body=data["content"],
                source_description="Monotecho Memo", source=EpisodeType.text,
                reference_time=reference_time,
                group_id=data["group"], uuid=data["uuid"])
            result = {"ok": True}
        elif op == "search":
            edges = await graph.search(data["query"], group_ids=[data["group"]], num_results=12)
            result = {"facts": [{"fact": e.fact, "episodes": e.episodes,
                "validAt": e.valid_at.isoformat() if e.valid_at else None,
                "invalidAt": e.invalid_at.isoformat() if e.invalid_at else None} for e in edges]}
        else:
            raise ValueError("Unknown operation")
        print(json.dumps(result))
    finally:
        await graph.close()

try:
    asyncio.run(main())
except Exception as error:
    # Never echo provider exceptions, credentials or memo text.
    print(json.dumps({"error": type(error).__name__}))
    sys.exit(1)
