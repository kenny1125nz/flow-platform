Review the pull request (its number and url are in the upstream `commit-and-pr` output).
Decide whether it is `approved` for merge, or needs `rework` (with concrete feedback about
what must change before merging). Report a `confidence` between 0 and 1 for your verdict —
a lower confidence means a human reviewer must confirm.

Print one final JSON line:

{"outcome":"succeeded","label":"approved","confidence":0.9}

or

{"outcome":"succeeded","label":"rework","output":{"feedback":"<what must change>"},"confidence":0.9}
