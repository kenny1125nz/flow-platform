Review the build and test results from the upstream `verify` output. Decide whether the
change is `ready` to be committed and opened as a pull request, or needs `rework` (with
concrete feedback about what failed or what still needs attention). Report a `confidence`
between 0 and 1 for your verdict — a lower confidence means a human reviewer must confirm.

Print one final JSON line:

{"outcome":"succeeded","label":"ready","confidence":0.9}

or

{"outcome":"succeeded","label":"rework","output":{"feedback":"<what must change>"},"confidence":0.9}
