#!/bin/bash
set -euo pipefail
echo "Deleting kind cluster 'documentdb-dev'..."
kind delete cluster --name documentdb-dev 2>/dev/null || echo "Cluster 'documentdb-dev' not found."
echo "Done."
