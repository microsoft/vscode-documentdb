#!/bin/bash
# =============================================================================
# DocumentDB K8s Discovery Plugin — Test Environment Teardown (WSL)
# =============================================================================
set -euo pipefail

if ! command -v kind &>/dev/null; then
    echo "kind is not installed; nothing to tear down."
    exit 0
fi

echo "Deleting kind cluster 'documentdb-dev'..."
kind delete cluster --name documentdb-dev 2>/dev/null || echo "Cluster 'documentdb-dev' not found."
echo "Done."
