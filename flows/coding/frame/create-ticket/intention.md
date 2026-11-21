# create-ticket

Publish the confirmed task spec to a GitHub issue and return a stable reference (issue
number + url) the later stages read from. This is the hand-off boundary: Frame writes
the spec, Make reads it back. The spec is embedded in the issue body as a fenced JSON
block so it round-trips losslessly.
