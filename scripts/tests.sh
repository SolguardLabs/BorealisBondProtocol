#!/usr/bin/env bash
set -euo pipefail

bun install --frozen-lockfile
bun test
