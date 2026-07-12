"""
pinterest_queue_post.py

Reads pinterest_queue/queue.json (built and reviewed via
pinterest_queue_build.py) and posts ONLY entries marked approved=true
and posted=false, respecting the same pacing rules as before (daily cap,
72h same-URL spacing). Updates queue.json in place to mark what's been
posted, so re-running never double-posts.

This is the actual control point requested: nothing posts without an
explicit approved=true in the committed queue file. Auto-selection
still works if you want it (pass --auto-approve to the build step), but
now it's an explicit choice rather than the only option.
"""

import os
import sys
import json
import argparse

sys.path.insert(0, os.path.dirname(__file__))
from pinterest_post_pins import (
    create_pin, check_daily_count, check_url_spacing,
    MAX_PINS_PER_DAY, record_url_pinned, increment_daily_count,
)

QUEUE_PATH = "pinterest_queue/queue.json"


def load_queue() -> list:
    if not os.path.exists(QUEUE_PATH):
        print(f"ERROR: {QUEUE_PATH} not found -- run pinterest_queue_build.py first.")
        sys.exit(1)
    with open(QUEUE_PATH) as f:
        return json.load(f)


def save_queue(queue: list):
    with open(QUEUE_PATH, "w") as f:
        json.dump(queue, f, indent=2)


def post_from_queue(dry_run: bool, max_posts: int = None):
    queue = load_queue()
    posted_count = 0

    for entry in queue:
        for variant_name, variant in entry["variants"].items():
            if variant["posted"]:
                continue
            if not variant["approved"]:
                continue
            if max_posts is not None and posted_count >= max_posts:
                print(f"Reached --max-posts limit ({max_posts}), stopping.")
                save_queue(queue)
                return

            label = f"{entry['card_name']} ({variant_name})"
            print(f"\n{label}")

            if dry_run:
                print(f"  [DRY RUN] Would post: {variant['image_url']}")
                print(f"  [DRY RUN] Title: {variant['title']}")
                print(f"  [DRY RUN] Destination: {entry['destination_url']}")
                continue

            if check_daily_count() >= MAX_PINS_PER_DAY:
                print(f"  Skipped: daily pacing limit reached")
                continue
            if not check_url_spacing(entry["destination_url"]):
                print(f"  Skipped: destination URL pinned too recently (72h spacing)")
                continue

            result = create_pin(
                board_id=entry["board_id"],
                image_url=variant["image_url"],
                title=variant["title"],
                description=variant["description"],
                destination_url=entry["destination_url"],
                alt_text=variant["alt_text"],
            )
            print(f"  Posted: pin id {result.get('id')}")
            variant["posted"] = True
            increment_daily_count()
            record_url_pinned(entry["destination_url"])
            posted_count += 1

    save_queue(queue)
    print(f"\nDone. {'(dry run)' if dry_run else f'{posted_count} pin(s) posted.'}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Actually post (default: dry run)")
    parser.add_argument("--max-posts", type=int, default=None,
                         help="Cap how many pins this run posts, regardless of "
                              "how many are approved -- useful for spreading a "
                              "large approved batch across several days manually")
    args = parser.parse_args()
    post_from_queue(dry_run=not args.live, max_posts=args.max_posts)
