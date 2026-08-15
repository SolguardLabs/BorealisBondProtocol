$ErrorActionPreference = "Stop"

bun install --frozen-lockfile
bun run ci
