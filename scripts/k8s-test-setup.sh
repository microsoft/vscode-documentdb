#!/bin/bash
# =============================================================================
# DocumentDB K8s Discovery Plugin — Test Environment Setup
#
# Creates a kind cluster with the DocumentDB Kubernetes Operator and a
# DocumentDB cluster for testing the VS Code extension discovery plugin.
#
# Prerequisites: brew (macOS). The script installs docker/colima/kubectl/kind/helm.
# =============================================================================
set -euo pipefail

echo "=== DocumentDB K8s Discovery Plugin — Test Environment Setup ==="
echo ""

# 1. Install prerequisites
if ! command -v docker &>/dev/null; then
    if ! command -v colima &>/dev/null; then
        echo "Installing colima and docker CLI..."
        brew install colima docker
    fi
    echo "Starting colima..."
    colima start --cpu 2 --memory 4 2>/dev/null || true
fi

for tool in kubectl kind helm; do
    if ! command -v $tool &>/dev/null; then
        echo "Installing $tool..."
        brew install $tool
    fi
done

# 2. Delete existing cluster if present
if kind get clusters 2>/dev/null | grep -q '^documentdb-dev$'; then
    echo "Deleting existing 'documentdb-dev' cluster..."
    kind delete cluster --name documentdb-dev
fi

# 3. Create kind cluster (K8s 1.35 required for ImageVolume GA)
echo "Creating kind cluster 'documentdb-dev'..."
kind create cluster --name documentdb-dev --image kindest/node:v1.35.0

# 4. Install cert-manager
echo "Installing cert-manager..."
helm repo add jetstack https://charts.jetstack.io 2>/dev/null || true
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true \
  --wait

# 5. Install DocumentDB operator
echo "Installing DocumentDB operator..."
helm repo add documentdb https://documentdb.github.io/documentdb-kubernetes-operator 2>/dev/null || true
helm repo update
helm install documentdb-operator documentdb/documentdb-operator \
  --namespace documentdb-operator \
  --create-namespace \
  --wait

# 6. Deploy DocumentDB cluster
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

# 7. Wait for DocumentDB to be healthy
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
echo "  1. Build: npm run build && npx webpack --config webpack.config.ext.js --mode development"
echo "  2. Press F5 in VS Code"
echo "  3. Service Discovery → '+' → 'Kubernetes'"
echo "  4. Manage Credentials → select 'kind-documentdb-dev'"
echo "  5. Expand: documentdb-ns → documentdb-service-my-documentdb"
echo "  6. Right-click → 'Add to Connections View'"
echo "  7. Credentials should auto-resolve — no username prompt!"
echo ""
echo "Manual port-forward test:"
echo "  kubectl port-forward pod/my-documentdb-1 10260:10260 -n documentdb-ns"
echo "  mongosh 'mongodb://dev_user:DevPassword123@127.0.0.1:10260/?directConnection=true&authMechanism=SCRAM-SHA-256&tls=true&tlsAllowInvalidCertificates=true&replicaSet=rs0'"
echo ""
echo "To tear down: ./scripts/k8s-test-teardown.sh"
