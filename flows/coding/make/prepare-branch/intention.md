# prepare-branch

Create (or reuse) a feature branch named from the tracker issue, so the implementation
never happens on `main`. This makes the later commit-and-pr step able to open a real
pull request (feature branch -> main) instead of failing with "no commits between main
and main".
