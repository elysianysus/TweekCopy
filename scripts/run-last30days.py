#!/usr/bin/env python3
"""
Wrapper around the vendored upstream last30days engine.

Reads a single JSON object on stdin:
    {
      "topic": "openai dev day",
      "sources": ["reddit", "hn", "github"],   // optional
      "outDir":  "uploads/last30days/12",       // required
      "runId":   "abc-123",                     // required (used for filename)
      "dryRun":  true                            // optional, per-request opt-in
    }

Always prints exactly ONE JSON line on stdout:
    {"status":"ok","htmlPath":"...","stderrTail":"...","engineVersion":"3.1.0"}
or
    {"status":"failed","error":"...","stderrTail":"...","missingKey":"..."}

Honours LAST30DAYS_DRY_RUN=1 (process-wide) OR a per-request `dryRun: true`
in the JSON params to short-circuit with a fixture (used by tests and CI so
we never depend on third-party APIs to validate the wiring). The per-request
flag is only sent by the Node worker when the route handler accepted it,
which it only does when LAST30DAYS_ALLOW_DRY_RUN_HEADER=1 is set on the
server process.
"""

from __future__ import annotations

import glob
import io
import json
import os
import re
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path

ENGINE_VERSION = "3.1.0"
REPO_ROOT = Path(__file__).resolve().parent.parent
_VENDOR_ROOT = REPO_ROOT / "vendor" / "last30days"
# v3.1.0 ships scripts/ at the repo root; older / future layouts may nest under skills/last30days/scripts.
_ENGINE_CANDIDATES = [
    _VENDOR_ROOT / "scripts" / "last30days.py",
    _VENDOR_ROOT / "skills" / "last30days" / "scripts" / "last30days.py",
]
ENGINE_SCRIPT = next((p for p in _ENGINE_CANDIDATES if p.exists()), _ENGINE_CANDIDATES[0])


def _find_python_312() -> str:
    """Locate a Python >= 3.12 interpreter (engine requires it).

    Checks LAST30DAYS_ENGINE_PYTHON, then PATH for python3.13/3.12, then
    falls back to scanning the local Nix store. Returns the path or an
    empty string if nothing usable is found.
    """
    explicit = os.environ.get("LAST30DAYS_ENGINE_PYTHON", "").strip()
    if explicit and Path(explicit).exists():
        return explicit
    for name in ("python3.13", "python3.12"):
        found = shutil.which(name)
        if found:
            return found
    # Fallback: Nix store scan (Replit environment).
    for pat in (
        "/nix/store/*python3-3.13*/bin/python3.13",
        "/nix/store/*python3-3.12*/bin/python3.12",
    ):
        matches = sorted(glob.glob(pat))
        if matches:
            return matches[-1]
    # Last resort: same interpreter that's running us, if it's >= 3.12.
    if sys.version_info >= (3, 12):
        return sys.executable
    return ""
STDERR_TAIL_LINES = 80
STDERR_TAIL_BYTES = 8000

ALLOWED_SOURCES = {
    "reddit", "hn", "hackernews", "github", "youtube", "x", "twitter",
    "tiktok", "instagram", "polymarket", "web", "bluesky", "truthsocial",
}

# Map a source name to the env var it requires. Sources not in this map are
# treated as "no key needed" (e.g. reddit/hn are public).
SOURCE_TO_REQUIRED_KEY = {
    "x": "SCRAPECREATORS_API_KEY",
    "twitter": "SCRAPECREATORS_API_KEY",
    "tiktok": "SCRAPECREATORS_API_KEY",
    "instagram": "SCRAPECREATORS_API_KEY",
}


def _esc_topic(value: str) -> str:
    from html import escape
    return escape((value or "")[:200])


def _emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _slug(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")
    return s or "topic"


def _ring_tail(text: str) -> str:
    if not text:
        return ""
    lines = deque(text.splitlines(), maxlen=STDERR_TAIL_LINES)
    tail = "\n".join(lines)
    if len(tail) > STDERR_TAIL_BYTES:
        tail = tail[-STDERR_TAIL_BYTES:]
    return tail


def _detect_missing_key(stderr: str, sources: list[str]) -> str | None:
    if not stderr:
        return None
    for src in sources:
        key = SOURCE_TO_REQUIRED_KEY.get(src.lower())
        if key and key in stderr:
            return key
    # Generic fallback — engine logs "missing API key" style messages.
    m = re.search(r"\b([A-Z0-9_]{6,})\s+(?:env|environment|key)\b", stderr)
    if m:
        return m.group(1)
    return None


def _dry_run_fixture(out_dir: Path, run_id: str, topic: str, sources: list[str]) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    md_path = out_dir / f"{run_id}.md"
    body = (
        f"# Dry run brief: {topic}\n\n"
        f"This is a fixture brief generated with `LAST30DAYS_DRY_RUN=1`.\n\n"
        f"## Selected sources\n\n"
        + "".join(f"- {s}\n" for s in sources)
    )
    md_path.write_text(body, encoding="utf-8")
    return {
        "status": "ok",
        "mdPath": str(md_path),
        "stderrTail": "[dry run] skipped subprocess",
        "engineVersion": ENGINE_VERSION,
        "dryRun": True,
    }


def main() -> int:
    try:
        raw = sys.stdin.read()
        params = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        _emit({"status": "failed", "error": f"invalid wrapper params: {exc}", "stderrTail": ""})
        return 0  # exit 0 so Node parses our JSON

    if not isinstance(params, dict):
        _emit({
            "status": "failed",
            "error": f"wrapper params must be a JSON object (got {type(params).__name__})",
            "stderrTail": "",
        })
        return 0

    topic = (params.get("topic") or "").strip()
    sources = params.get("sources") or []
    out_dir = params.get("outDir") or ""
    run_id = str(params.get("runId") or "")

    if not topic:
        _emit({"status": "failed", "error": "topic is required", "stderrTail": ""})
        return 0
    if not out_dir or not run_id:
        _emit({"status": "failed", "error": "outDir and runId are required", "stderrTail": ""})
        return 0

    cleaned_sources: list[str] = []
    for s in sources:
        if not isinstance(s, str):
            continue
        norm = s.strip().lower()
        if norm and norm in ALLOWED_SOURCES and norm not in cleaned_sources:
            cleaned_sources.append(norm)

    out_dir_path = Path(out_dir).resolve()
    out_dir_path.mkdir(parents=True, exist_ok=True)

    dry_run_flag = bool(params.get("dryRun")) or os.environ.get("LAST30DAYS_DRY_RUN") == "1"
    if dry_run_flag:
        _emit(_dry_run_fixture(out_dir_path, run_id, topic, cleaned_sources or ["reddit", "hn"]))
        return 0

    if not ENGINE_SCRIPT.exists():
        _emit({
            "status": "failed",
            "error": (
                "Vendored engine not installed. Run scripts/install-last30days.sh "
                f"(expected at {ENGINE_SCRIPT})."
            ),
            "stderrTail": "",
        })
        return 0

    engine_python = _find_python_312()
    if not engine_python:
        _emit({
            "status": "failed",
            "error": "Could not locate a Python >= 3.12 interpreter (engine requirement). "
                     "Set LAST30DAYS_ENGINE_PYTHON to a python3.12 binary.",
            "stderrTail": "",
            "engineVersion": ENGINE_VERSION,
        })
        return 0

    save_dir = out_dir_path / f"_work_{run_id}"
    save_dir.mkdir(parents=True, exist_ok=True)

    # Engine emits markdown (or json/compact/context). We always request md
    # and then convert to HTML in-process via the `markdown` package.
    cmd = [
        engine_python,
        str(ENGINE_SCRIPT),
        topic,
        "--emit", "md",
        "--save-dir", str(save_dir),
    ]
    if cleaned_sources:
        cmd += ["--search", ",".join(cleaned_sources)]
    if os.environ.get("LAST30DAYS_MOCK") == "1":
        cmd.append("--mock")

    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(REPO_ROOT),
            timeout=20 * 60,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        _emit({
            "status": "failed",
            "error": "engine timed out after 20 minutes",
            "stderrTail": _ring_tail((exc.stderr or b"").decode("utf-8", "replace")),
            "engineVersion": ENGINE_VERSION,
        })
        return 0
    except OSError as exc:
        _emit({
            "status": "failed",
            "error": f"failed to spawn engine: {exc}",
            "stderrTail": "",
            "engineVersion": ENGINE_VERSION,
        })
        return 0

    stderr_text = (proc.stderr or b"").decode("utf-8", "replace")
    stderr_tail = _ring_tail(stderr_text)

    if proc.returncode != 0:
        missing = _detect_missing_key(stderr_text, cleaned_sources)
        result = {
            "status": "failed",
            "error": f"engine exited with code {proc.returncode}",
            "stderrTail": stderr_tail,
            "engineVersion": ENGINE_VERSION,
        }
        if missing:
            result["missingKey"] = missing
            result["error"] = f"missing required key: {missing}"
        _emit(result)
        return 0

    # Engine writes <slug>-raw.md (md mode). Move the freshest .md into our
    # stable path; the Node worker handles md -> html via `marked`.
    md_candidates = sorted(save_dir.glob("*-raw*.md")) or sorted(save_dir.glob("*.md"))
    if not md_candidates:
        _emit({
            "status": "failed",
            "error": "engine produced no markdown output",
            "stderrTail": stderr_tail,
            "engineVersion": ENGINE_VERSION,
        })
        return 0

    md_out_path = out_dir_path / f"{run_id}.md"
    try:
        md_out_path.write_bytes(md_candidates[-1].read_bytes())
    finally:
        try:
            for child in save_dir.iterdir():
                child.unlink(missing_ok=True)
            save_dir.rmdir()
        except OSError:
            pass

    _emit({
        "status": "ok",
        "mdPath": str(md_out_path),
        "stderrTail": stderr_tail,
        "engineVersion": ENGINE_VERSION,
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
