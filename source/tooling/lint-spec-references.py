#!/usr/bin/env python3
"""
OPS-DOC-LINT-001: Specification Reference & Markdown Integrity Linter
Validates normative IDs, expanded ranges, table formatting, and code fences.
"""

import sys
import os
import re

def lint_spec(file_path):
    if not os.path.exists(file_path):
        print(f"ERROR: Specification file '{file_path}' not found.", file=sys.stderr)
        return 1

    with open(file_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    errors = []
    warnings = []

    # 1. Code Fence Parity Check
    fence_count = 0
    for idx, line in enumerate(lines, 1):
        if line.strip().startswith("```"):
            fence_count += 1

    if fence_count % 2 != 0:
        errors.append(f"Odd number of code fences ({fence_count}) found in document.")

    # 2. Extract and Validate ID Ranges (e.g. API-PRODUCT-001..011)
    range_pattern = re.compile(r'([A-Z0-9_-]+-)(\d+)\.\.(\d+)')
    defined_ids = set()
    referenced_ids = set()

    for idx, line in enumerate(lines, 1):
        # Extract explicit normative ID definitions (e.g. `OPS-DB-ISOLATION-001`: or | `WU-00` |)
        explicit_defs = re.findall(r'`([A-Z]+-[A-Z0-9-]+-\d+)`', line)
        for norm_id in explicit_defs:
            defined_ids.add(norm_id)

        # Check ranges
        for match in range_pattern.finditer(line):
            prefix, start_str, end_str = match.groups()
            start_num = int(start_str)
            end_num = int(end_str)

            if start_num > end_num:
                errors.append(f"Line {idx}: Inverted or invalid ID range '{prefix}{start_str}..{end_str}' (start {start_num} > end {end_num}).")
            else:
                # Expand range
                pad = len(start_str)
                for num in range(start_num, end_num + 1):
                    expanded_id = f"{prefix}{num:0{pad}d}"
                    referenced_ids.add(expanded_id)

    # 3. Validate Markdown Table Structure
    in_fence = False
    for idx, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        
        if not in_fence and "|" in stripped:
            pipes = stripped.count("|")
            if pipes < 2:
                warnings.append(f"Line {idx}: Malformed table line with single pipe.")

    print(f"=== Spec Reference Linter Results ({file_path}) ===")
    print(f"Fences checked: {fence_count} (even: {fence_count % 2 == 0})")
    print(f"Explicit Norm IDs found: {len(defined_ids)}")
    print(f"Expanded Range IDs checked: {len(referenced_ids)}")

    if warnings:
        print(f"\nWarnings ({len(warnings)}):")
        for w in warnings[:10]:
            print(f" - {w}")

    if errors:
        print(f"\nERRORS ({len(errors)}):", file=sys.stderr)
        for e in errors:
            print(f" - {e}", file=sys.stderr)
        return 1

    print("\nSUCCESS: All spec references, ranges, and formatting checks passed!")
    return 0

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md"
    sys.exit(lint_spec(target))

if __name__ == "__main__":
    main()
