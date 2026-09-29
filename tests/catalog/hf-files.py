#!/usr/bin/env python3
"""List GGUF files in a Hugging Face repo with their authoritative size and sha256.

Git-LFS stores a file's sha256 as its object id, so the API already knows the
hash the downloader will check against. Taking it from here rather than
downloading a gigabyte to hash it locally is the difference between a catalog
entry that can be verified and one that cannot.
"""
import json
import sys
import urllib.request

def files(repo: str):
    url = f"https://huggingface.co/api/models/{repo}/tree/main?recursive=1"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)

for repo in sys.argv[1:]:
    print(f"=== {repo}")
    try:
        for entry in files(repo):
            path = entry.get("path", "")
            if not path.endswith(".gguf"):
                continue
            lfs = entry.get("lfs") or {}
            size = lfs.get("size") or entry.get("size") or 0
            if size > 1_400_000_000:
                continue
            print(f"  {size/1e9:5.2f}GB  {lfs.get('oid', '?')}  {path}")
    except Exception as e:  # a repo that moved is data, not a crash
        print(f"  unavailable: {e}")
