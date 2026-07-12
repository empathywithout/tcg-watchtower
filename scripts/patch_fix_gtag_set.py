"""
patch_fix_gtag_set.py

Corrective, mechanical fix for a real bug in the previous surgical patch:
that patch used gtag('set', {...}); gtag('config', ID); to attach custom
dimensions -- but Google's own developer docs state the 'set' command
"may not reliably propagate custom parameters to all Google Analytics
measurement streams." Confirmed via DebugView on the live site: the
dimensions genuinely weren't arriving.

The fix is purely mechanical: the correct dimensions JSON is ALREADY
embedded in every live file (from the previous patch) -- this just moves
it from the 'set' call into the 'config' call directly, which IS the
Google-recommended pattern for custom event parameters. No re-deriving
of set_id/rarity/series needed; the existing JSON is captured and
reused as-is.

Usage:
  python3 patch_fix_gtag_set.py --dry-run
  python3 patch_fix_gtag_set.py
"""
import re
import os
import sys

# Captures the exact dims JSON blob already embedded live, to move it
# into config() unchanged -- no re-derivation, just relocation.
BUGGY_PATTERN = re.compile(
    r"gtag\('js',new Date\(\)\);gtag\('set',(\{.*?\})\);gtag\('config','G-E0S4363S5Y'\);"
)

def fix_content(content: str):
    def replacer(m):
        dims_json = m.group(1)
        return f"gtag('js',new Date());gtag('config','G-E0S4363S5Y',{dims_json});"
    new_content, count = BUGGY_PATTERN.subn(replacer, content)
    return new_content, count


def find_all_html():
    candidates = []
    for root, dirs, files in os.walk('.'):
        if '.git' in root or 'node_modules' in root:
            continue
        for f in files:
            if f.endswith('.html'):
                candidates.append(os.path.relpath(os.path.join(root, f), '.'))
    return candidates


def main():
    dry_run = '--dry-run' in sys.argv
    all_html = find_all_html()
    print(f"Scanning {len(all_html)} HTML files site-wide...\n")

    fixed_count, skip_count, multi_match_files = 0, 0, []

    for rel_path in all_html:
        try:
            with open(rel_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            continue

        new_content, count = fix_content(content)
        if count == 0:
            skip_count += 1
            continue
        if count > 1:
            multi_match_files.append((rel_path, count))

        fixed_count += 1
        if not dry_run:
            with open(rel_path, 'w', encoding='utf-8') as f:
                f.write(new_content)

    print(f"Files with the buggy gtag('set',...) pattern: {fixed_count}")
    print(f"  {'Would fix' if dry_run else 'Fixed'}: {fixed_count}")
    print(f"Files without the pattern (unaffected): {skip_count}")
    if multi_match_files:
        print(f"\nWARNING: {len(multi_match_files)} file(s) had more than one match (unexpected):")
        for path, count in multi_match_files:
            print(f"  {path}: {count} matches")

if __name__ == "__main__":
    main()
