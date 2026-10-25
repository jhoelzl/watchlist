"""Gleiche Fälle wie web/src/lib/shared.test.ts (fixtures/shared_cases.json): hält Python und TypeScript synchron."""

import json
from pathlib import Path

import pytest

import notify
from diffing import annotate_diff, diff_counts, fragment_url

CASES = json.loads((Path(__file__).parent.parent / "fixtures" / "shared_cases.json").read_text())


@pytest.mark.parametrize("case", CASES["group_of"])
def test_group_of(case):
    assert notify.group_of(case["input"]) == case["expected"]


@pytest.mark.parametrize("case", CASES["counts"])
def test_diff_counts(case):
    assert list(diff_counts(case["diff"])) == case["expected"]


@pytest.mark.parametrize("case", CASES["fragment"])
def test_fragment_url(case):
    assert fragment_url(case["url"], case["diff"]) == case["expected"]


@pytest.mark.parametrize("case", CASES["annotate"])
def test_annotate_diff(case):
    assert [[list(s) for s in row] for row in annotate_diff(case["diff"])] == case["expected"]
