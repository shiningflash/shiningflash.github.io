#!/usr/bin/env python3
"""Sync practice problems from a source repo into the blog's _practice/ collection.

For each problem under <source>/problems/NNN-slug/, this writes a single
combined Markdown file to _practice/<track>/NNN-slug.md, containing:

    ---
    layout: practice-problem
    track: <track>
    id, title, category, topics, difficulty
    slug, source_url, solution_lang
    ---

    {question body}

    <div class="pr-solution-divider"></div>

    {solution body}

The layout splits on the divider div, so the question shows by default and
the solution is gated behind a Reveal button.

Usage:
    # Sync from a cloned source repo
    python3 scripts/sync_practice.py \
        --source /path/to/data-engineering-practice-problems \
        --track data-engineering

    # Sync from a remote repo (clones to a tempdir, then deletes)
    python3 scripts/sync_practice.py \
        --remote shiningflash/data-engineering-practice-problems \
        --track data-engineering

Run from the blog repo root.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BLOG_ROOT = Path(__file__).resolve().parent.parent
SOLUTION_DIVIDER = '<div class="pr-solution-divider"></div>'

# Map solution file extensions to fenced-code language identifiers used in
# the wrapped solution body (only used when the source is a .py/.sql/.sh).
EXT_TO_LANG = {
    ".py": "python",
    ".sql": "sql",
    ".sh": "bash",
    ".js": "javascript",
    ".ts": "typescript",
    ".java": "java",
    ".go": "go",
    ".rb": "ruby",
}


# ─── frontmatter parsing ──────────────────────────────────────────────
def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (metadata dict, body string) from a YAML-frontmatter Markdown file."""
    if not text.startswith("---\n"):
        raise ValueError("missing frontmatter")
    end = text.find("\n---\n", 4)
    if end == -1:
        raise ValueError("unterminated frontmatter")
    block = text[4:end]
    body = text[end + 5:]
    meta: dict = {}
    for line in block.splitlines():
        if not line.strip() or ":" not in line:
            continue
        key, _, val = line.partition(":")
        meta[key.strip()] = val.strip()
    # Coerce types
    if "id" in meta:
        meta["id"] = int(meta["id"])
    topics = meta.get("topics", "").strip()
    if topics.startswith("[") and topics.endswith("]"):
        topics = topics[1:-1]
    meta["topics"] = [t.strip() for t in topics.split(",") if t.strip()]
    return meta, body


# ─── YAML emission (handwritten, no PyYAML dependency) ────────────────
def yaml_escape(value: str) -> str:
    """Escape a string for safe inclusion in a single-line YAML scalar."""
    if value == "" or any(c in value for c in ':#"\'\n') or value.startswith(("-", "?", "!", "&", "*", "[", "{", "@", "`")):
        # Use double-quoted form with escapes
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return value


def emit_frontmatter(meta: dict) -> str:
    """Render a dict as a deterministic YAML frontmatter block."""
    lines = ["---"]
    # Stable key order — easier to diff
    order = [
        "layout", "track", "id", "title", "slug",
        "category", "difficulty", "topics",
        "source_url", "solution_lang",
    ]
    for key in order:
        if key not in meta:
            continue
        v = meta[key]
        if isinstance(v, list):
            inner = ", ".join(yaml_escape(str(t)) for t in v)
            lines.append(f"{key}: [{inner}]")
        elif isinstance(v, int):
            lines.append(f"{key}: {v}")
        else:
            lines.append(f"{key}: {yaml_escape(str(v))}")
    lines.append("---")
    return "\n".join(lines) + "\n"


# ─── solution loading ─────────────────────────────────────────────────
def load_solution(problem_dir: Path, solution_filename: str) -> tuple[str, str]:
    """Return (rendered_body, language_tag).

    For .md solutions, the body is the raw Markdown (no wrapper).
    For code solutions, the body is a fenced code block in the right language.
    """
    path = problem_dir / solution_filename
    if not path.exists():
        # Try common fallbacks
        for fb in ("solution.md", "solution.py"):
            if (problem_dir / fb).exists():
                path = problem_dir / fb
                break
        else:
            return "*Solution file missing.*\n", "markdown"

    raw = path.read_text(encoding="utf-8")

    if path.suffix == ".md":
        return raw, "markdown"

    lang = EXT_TO_LANG.get(path.suffix, "")
    fence = f"```{lang}\n{raw.rstrip()}\n```\n"
    intro = f"_Reference implementation_ — `{path.name}`\n\n"
    return intro + fence, lang or "code"


# ─── core sync ────────────────────────────────────────────────────────
PROBLEM_DIR_RE = re.compile(r"^(\d{3,4})-")


def sync(source: Path, track: str, *, source_repo_url: str | None = None,
         blog_root: Path = BLOG_ROOT) -> int:
    problems_dir = source / "problems"
    if not problems_dir.is_dir():
        print(f"FATAL: {problems_dir} not found", file=sys.stderr)
        return 1

    out_dir = blog_root / "_practice" / track
    out_dir.mkdir(parents=True, exist_ok=True)

    # Discover problem folders
    folders = sorted(
        d for d in problems_dir.iterdir()
        if d.is_dir() and PROBLEM_DIR_RE.match(d.name)
    )
    if not folders:
        print(f"WARN: no problem folders found in {problems_dir}", file=sys.stderr)
        return 0

    # Track what we generated so we can prune stale files
    generated: set[str] = set()
    seen_ids: set[int] = set()

    for folder in folders:
        qpath = folder / "question.md"
        if not qpath.exists():
            print(f"  skip (no question.md): {folder.name}")
            continue

        try:
            meta, qbody = parse_frontmatter(qpath.read_text(encoding="utf-8"))
        except ValueError as e:
            print(f"  skip ({e}): {folder.name}", file=sys.stderr)
            continue

        if "id" not in meta or "title" not in meta:
            print(f"  skip (missing id/title): {folder.name}", file=sys.stderr)
            continue

        if meta["id"] in seen_ids:
            print(f"  WARN: duplicate id {meta['id']} at {folder.name}", file=sys.stderr)
        seen_ids.add(meta["id"])

        sol_name = meta.get("solution", "solution.md")
        sol_body, sol_lang = load_solution(folder, sol_name)

        out_meta = {
            "layout": "practice-problem",
            "track": track,
            "id": meta["id"],
            "title": meta["title"],
            "slug": folder.name,
            "category": meta.get("category", "Uncategorized"),
            "difficulty": meta.get("difficulty", "Medium"),
            "topics": meta["topics"],
            "solution_lang": sol_lang,
        }
        if source_repo_url:
            out_meta["source_url"] = f"{source_repo_url.rstrip('/')}/tree/main/problems/{folder.name}"

        # Strip the H1 from the question body — the layout already renders
        # an H1 with the title + badges, so a second H1 would be a dupe.
        qbody_clean = re.sub(r"^# .*\n", "", qbody.lstrip(), count=1)

        # Wrap question + solution bodies in {% raw %} so Liquid doesn't try
        # to parse dbt/Jinja-style braces (e.g. {% snapshot %}, {{ ref(...) }})
        # that legitimately appear in the source markdown.
        contents = (
            emit_frontmatter(out_meta)
            + "\n{% raw %}\n"
            + qbody_clean.rstrip()
            + "\n{% endraw %}\n\n"
            + SOLUTION_DIVIDER
            + "\n\n{% raw %}\n"
            + sol_body.rstrip()
            + "\n{% endraw %}\n"
        )

        out_file = out_dir / f"{folder.name}.md"
        # Skip rewrite if identical (keeps `git diff` minimal)
        if out_file.exists() and out_file.read_text(encoding="utf-8") == contents:
            generated.add(out_file.name)
            continue
        out_file.write_text(contents, encoding="utf-8")
        generated.add(out_file.name)
        print(f"  wrote {out_file.relative_to(blog_root)}")

    # Prune stale files no longer present in source
    pruned = 0
    for existing in out_dir.iterdir():
        if existing.name.startswith(".") or not existing.is_file():
            continue
        if existing.name not in generated:
            existing.unlink()
            print(f"  pruned {existing.relative_to(blog_root)}")
            pruned += 1

    print(f"\nDone. {len(generated)} problems in _practice/{track}/ (pruned {pruned}).")
    return 0


# ─── CLI ──────────────────────────────────────────────────────────────
def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--source", type=Path, help="Local path to source repo checkout")
    src.add_argument("--remote", type=str, help="GitHub <owner>/<repo> to clone")
    ap.add_argument("--track", required=True, help="Track slug (e.g. data-engineering)")
    ap.add_argument("--source-repo-url",
                    help="Public URL for the source repo (used in 'View on GitHub' links). "
                         "Defaults to https://github.com/<remote> when --remote is used.")
    args = ap.parse_args(argv)

    if args.source:
        source_path = args.source.resolve()
        repo_url = args.source_repo_url
        return sync(source_path, args.track, source_repo_url=repo_url)

    # --remote: clone shallow into tempdir
    repo_url = args.source_repo_url or f"https://github.com/{args.remote}"
    with tempfile.TemporaryDirectory() as td:
        clone_dir = Path(td) / "src"
        print(f"Cloning {repo_url} (shallow)…")
        try:
            subprocess.run(
                ["git", "clone", "--depth", "1", f"{repo_url}.git", str(clone_dir)],
                check=True, capture_output=True, text=True,
            )
        except subprocess.CalledProcessError as e:
            print(f"FATAL: git clone failed: {e.stderr}", file=sys.stderr)
            return 1
        return sync(clone_dir, args.track, source_repo_url=repo_url)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
