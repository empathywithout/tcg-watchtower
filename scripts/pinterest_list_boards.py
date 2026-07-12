"""
pinterest_list_boards.py

Lists all boards on the authenticated Pinterest account, with their
board_id -- needed before any pin creation, since every Pin requires a
board_id. Also doubles as a quick token-validity check.

Requires env var PINTEREST_ACCESS_TOKEN.
"""

import os
import sys
import json
import urllib.request
import urllib.error

API_BASE = "https://api.pinterest.com/v5"


def get_token() -> str:
    token = os.environ.get("PINTEREST_ACCESS_TOKEN")
    if not token:
        print("ERROR: PINTEREST_ACCESS_TOKEN environment variable not set.")
        sys.exit(1)
    return token


def list_boards():
    token = get_token()
    url = f"{API_BASE}/boards?page_size=100"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"ERROR: Pinterest API returned {e.code}: {body}")
        sys.exit(1)

    boards = data.get("items", [])
    if not boards:
        print("No boards found -- either the account has none yet, or the "
              "token lacks the boards:read scope.")
        return

    print(f"Found {len(boards)} board(s):\n")
    for b in boards:
        print(f"  {b.get('name')!r}")
        print(f"    board_id: {b.get('id')}")
        print(f"    privacy:  {b.get('privacy')}")
        print()


if __name__ == "__main__":
    list_boards()
