#!/bin/bash
# =============================================================================
# DocumentDB K8s Discovery Plugin — Test Environment Setup (WSL)
#
# Creates a kind cluster with the DocumentDB Kubernetes Operator and a
# DocumentDB cluster for testing the VS Code extension discovery plugin.
#
# Prerequisites: WSL2 on Windows with Docker Desktop (WSL integration enabled)
#   OR Docker Engine installed directly in WSL.
#
# Tools installed automatically via curl/apt: kubectl, kind, helm.
# =============================================================================
set -euo pipefail

echo "=== DocumentDB K8s Discovery Plugin — Test Environment Setup (WSL) ==="
echo ""

# Verify we are running inside WSL
if ! grep -qi microsoft /proc/version 2>/dev/null; then
    echo "WARNING: /proc/version does not indicate a WSL environment."
    echo "This script is intended for WSL2 on Windows. Proceeding anyway..."
fi

# 1. Verify Docker is available
if ! command -v docker &>/dev/null; then
    echo "ERROR: 'docker' not found."
    echo ""
    echo "Options:"
    echo "  A) Enable Docker Desktop WSL integration:"
    echo "     Docker Desktop → Settings → Resources → WSL Integration → enable your distro"
    echo "  B) Install Docker Engine in WSL:"
    echo "     curl -fsSL https://get.docker.com | sh"
    echo "     sudo usermod -aG docker \$USER && newgrp docker"
    exit 1
fi

if ! docker info &>/dev/null; then
    echo "ERROR: Docker daemon is not running or the current user has no access."
    echo ""
    echo "If using Docker Desktop, make sure it is running and WSL integration is enabled."
    echo "If using Docker Engine, start the daemon: sudo service docker start"
    exit 1
fi

echo "Docker: OK ($(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'version unknown'))"

# 2. Install kubectl
if ! command -v kubectl &>/dev/null; then
    echo "Installing kubectl..."
    KUBECTL_VERSION=$(curl -fsSL https://dl.k8s.io/release/stable.txt)
    curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
        -o /tmp/kubectl
    chmod +x /tmp/kubectl
    sudo mv /tmp/kubectl /usr/local/bin/kubectl
    echo "kubectl installed: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"
fi

# 3. Install kind
if ! command -v kind &>/dev/null; then
    echo "Installing kind..."
    KIND_VERSION=$(curl -fsSL https://api.github.com/repos/kubernetes-sigs/kind/releases/latest \
        | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
    curl -fsSL "https://github.com/kubernetes-sigs/kind/releases/download/v${KIND_VERSION}/kind-linux-amd64" \
        -o /tmp/kind
    chmod +x /tmp/kind
    sudo mv /tmp/kind /usr/local/bin/kind
    echo "kind installed: $(kind version)"
fi

# 4. Install helm
if ! command -v helm &>/dev/null; then
    echo "Installing helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    echo "helm installed: $(helm version --short)"
fi

echo ""
echo "All prerequisites satisfied."
echo ""

# 5. Delete existing cluster if present
if kind get clusters 2>/dev/null | grep -q '^documentdb-dev$'; then
    echo "Deleting existing 'documentdb-dev' cluster..."
    kind delete cluster --name documentdb-dev
fi

# 6. Create kind cluster (K8s 1.35 required for ImageVolume GA)
echo "Creating kind cluster 'documentdb-dev'..."
kind create cluster --name documentdb-dev --image kindest/node:v1.35.0

# 7. Install cert-manager
echo "Installing cert-manager..."
helm repo add jetstack https://charts.jetstack.io 2>/dev/null || true
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true \
  --wait

# 8. Install DocumentDB operator
echo "Installing DocumentDB operator..."
helm repo add documentdb https://documentdb.github.io/documentdb-kubernetes-operator 2>/dev/null || true
helm repo update
helm install documentdb-operator documentdb/documentdb-operator \
  --namespace documentdb-operator \
  --create-namespace \
  --wait

# 9. Deploy DocumentDB cluster
echo "Deploying DocumentDB cluster..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Namespace
metadata:
  name: documentdb-ns
---
apiVersion: v1
kind: Secret
metadata:
  name: documentdb-credentials
  namespace: documentdb-ns
type: Opaque
stringData:
  username: dev_user
  password: DevPassword123
---
apiVersion: documentdb.io/preview
kind: DocumentDB
metadata:
  name: my-documentdb
  namespace: documentdb-ns
spec:
  nodeCount: 1
  instancesPerNode: 1
  documentDbCredentialSecret: documentdb-credentials
  resource:
    storage:
      pvcSize: 10Gi
  exposeViaService:
    serviceType: ClusterIP
EOF

# 10. Wait for DocumentDB to be healthy
echo "Waiting for DocumentDB cluster to become healthy..."
kubectl wait --for=jsonpath='{.status.phase}'='Cluster in healthy state' \
  documentdb/my-documentdb -n documentdb-ns --timeout=300s 2>/dev/null || \
  kubectl get documentdb my-documentdb -n documentdb-ns

echo ""
echo "=== Test Environment Ready ==="
echo ""
echo "Kubeconfig context: kind-documentdb-dev"
echo ""
echo "DocumentDB cluster:"
echo "  Namespace:   documentdb-ns"
echo "  Service:     documentdb-service-my-documentdb (ClusterIP :10260)"
echo "  Credentials: dev_user / DevPassword123 (auto-resolved from K8s Secret)"
echo ""
echo "To test in the extension:"
echo "  1. Build: npm run build"
echo "  2. Open VS Code via Remote - WSL (or use 'code .' from WSL terminal)"
echo "  3. Press F5 in VS Code"
echo "  4. Service Discovery → '+' → 'Kubernetes'"
echo "  5. Manage Credentials → select 'kind-documentdb-dev'"
echo "  6. Expand: documentdb-ns → documentdb-service-my-documentdb"
echo "  7. Right-click → 'Add to Connections View'"
echo "  8. Credentials should auto-resolve — no username prompt!"
echo ""
echo "Manual port-forward test:"
echo "  kubectl port-forward pod/my-documentdb-1 10260:10260 -n documentdb-ns"
echo "  mongosh 'mongodb://dev_user:DevPassword123@127.0.0.1:10260/?directConnection=true&authMechanism=SCRAM-SHA-256&tls=true&tlsAllowInvalidCertificates=true&replicaSet=rs0'"
echo ""
echo "To tear down: ./scripts/k8s-test-teardown-wsl.sh"
