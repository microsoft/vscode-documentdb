> **User Manual** &mdash; [Back to Kubernetes Service Discovery](./service-discovery-kubernetes) | [Back to Service Discovery](./service-discovery) | [Back to User Manual](../index#user-manual)

---

# Kubernetes Service Discovery: Getting Started and Test Lab

This guide explains the Kubernetes service discovery feature from the beginning. It shows how to create a small DocumentDB cluster in Kubernetes, how the VS Code extension discovers it, and how to test the full flow locally and in Azure Kubernetes Service (AKS).

Use this guide when you want to:

- understand what the Kubernetes discovery feature does,
- create a disposable local test cluster,
- create a similar AKS test cluster in Azure,
- verify that the extension can discover, authenticate, port-forward, and connect to the cluster.

This guide is for development and validation. For production AKS clusters, use your team's normal security, networking, identity, backup, monitoring, and change-management standards.

## Concepts in plain language

### Kubernetes

Kubernetes is a system that runs containers. A Kubernetes cluster contains:

- a **control plane**, which stores cluster state and answers API requests,
- **nodes**, which run workload containers,
- **namespaces**, which group resources,
- **pods**, which run one or more containers,
- **services**, which provide stable network names and ports for pods.

### kubeconfig

A **kubeconfig** file tells tools such as `kubectl` and the VS Code extension how to reach Kubernetes clusters. It usually contains:

- cluster API server addresses,
- contexts, which are named combinations of cluster, user, and namespace information,
- authentication information or references to an authentication plugin.

The extension can read the default kubeconfig from `KUBECONFIG` or the Kubernetes default kubeconfig path (`~/.kube/config` on macOS/Linux, `%USERPROFILE%\.kube\config` on Windows), a custom kubeconfig file, or pasted kubeconfig YAML stored in VS Code Secret Storage.

### DocumentDB Kubernetes Operator

The **DocumentDB Kubernetes Operator** manages DocumentDB clusters inside Kubernetes. In this feature, the operator is important because it creates Kubernetes resources that the extension can understand:

```text
DocumentDB custom resource
  -> backing Kubernetes Service
  -> ready pod endpoint
  -> credential Secret
```

The extension discovers operator-managed resources first. If the operator CRD is not installed, the extension can fall back to generic Kubernetes Services that opt in or expose known DocumentDB-compatible ports.

### Service discovery in the extension

The extension does not ask you to manually build a connection string. Instead, it uses Kubernetes APIs to find DocumentDB-compatible targets:

```text
VS Code
  -> DocumentDB extension
    -> Service Discovery tree
      -> Kubernetes provider
        -> kubeconfig source
          -> context
            -> namespace
              -> DocumentDB target
```

When you connect to a discovered target, two authentication layers are involved:

```text
Layer 1: Kubernetes access
  Used by the extension to list namespaces, Services, endpoints, Secrets, and DKO resources.
  Comes from kubeconfig.

Layer 2: DocumentDB database access
  Used by the extension to authenticate to DocumentDB itself.
  Usually comes from a Kubernetes Secret created for the DocumentDB cluster.
```

For `ClusterIP` Services, the database is only reachable inside the Kubernetes cluster. The extension handles that by starting a local port-forward tunnel:

```text
DocumentDB extension
  -> Kubernetes API pods/portforward
    -> ready DocumentDB pod in the cluster
      -> local connection string such as mongodb://127.0.0.1:10260/
```

## What you will build

Both the local and Azure paths create the same basic lab shape:

```text
Kubernetes cluster
  namespace: documentdb-ns
    Secret: documentdb-credentials
      username
      password
    DocumentDB custom resource: my-documentdb
      nodeCount: 1
      instancesPerNode: 1
      exposeViaService: ClusterIP
    Service: documentdb-service-my-documentdb
      port: 10260
```

The extension should discover `my-documentdb`, resolve credentials from `documentdb-credentials`, start a port-forward tunnel for the `ClusterIP` Service, and create a normal saved connection in the Connections view.

## Prerequisites

Install these tools before starting:

| Tool             | Why you need it                                               |
| ---------------- | ------------------------------------------------------------- |
| VS Code          | Runs and tests the extension.                                 |
| Node.js and npm  | Builds the extension.                                         |
| Docker or Colima | Runs the local kind cluster.                                  |
| `kubectl`        | Talks to Kubernetes clusters.                                 |
| `kind`           | Creates a local Kubernetes cluster in Docker.                 |
| `helm`           | Installs cert-manager and the DocumentDB Kubernetes Operator. |
| `mongosh`        | Optional manual database connectivity test.                   |
| Azure CLI `az`   | Required only for the AKS path.                               |

On macOS, the local setup script can install Docker CLI, Colima, `kubectl`, `kind`, and `helm` with Homebrew if they are missing.

## Path A: create a local kind cluster

Use this path for the fastest developer loop. It creates a disposable local Kubernetes cluster named `documentdb-dev`.

### Option A1: run the repository setup script

From the repository root:

```bash
./scripts/k8s-test-setup.sh
```

The script does the following:

1. Installs local prerequisites on macOS when needed.
2. Starts Colima if Docker is not already available.
3. Recreates a kind cluster named `documentdb-dev`.
4. Installs cert-manager.
5. Installs the DocumentDB Kubernetes Operator.
6. Creates namespace `documentdb-ns`.
7. Creates Secret `documentdb-credentials`.
8. Creates a sample `DocumentDB` custom resource named `my-documentdb`.
9. Waits for the DocumentDB cluster to become healthy.

The resulting kubeconfig context is:

```text
kind-documentdb-dev
```

The sample local credentials are printed by the script and are intended only for a disposable local test cluster.

### Option A2: use the DKO local development script

If you have the DocumentDB Kubernetes Operator repository checked out next to this repository as `../dko`, you can also use the DKO repository's local development deployment script:

- DKO local deployment script: [`operator/src/scripts/development/deploy.sh`](https://github.com/documentdb/documentdb-kubernetes-operator/blob/main/operator/src/scripts/development/deploy.sh)

From the DKO repository's `operator/src` directory:

```bash
cd ../dko/operator/src
DEPLOY=true DEPLOY_CLUSTER=true ./scripts/development/deploy.sh
```

This DKO script builds the local operator images, creates or reuses a kind Kubernetes cluster with a local registry, installs cert-manager, installs the operator, deploys a sample DocumentDB cluster, and prints follow-up health and connection commands.

Use this script when you need to validate the operator development workflow itself. Use `./scripts/k8s-test-setup.sh` from this repository when you only need a ready local cluster for testing the VS Code extension discovery feature.

### Option A3: run the local setup manually

Use the manual steps if you are not on macOS, want to understand each resource, or need to adjust the cluster.

Create the kind cluster:

```bash
kind create cluster --name documentdb-dev --image kindest/node:v1.35.0
kubectl config use-context kind-documentdb-dev
```

Install cert-manager:

```bash
helm repo add jetstack https://charts.jetstack.io 2>/dev/null || true
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true \
  --wait
```

Install the DocumentDB Kubernetes Operator:

```bash
helm repo add documentdb https://documentdb.github.io/documentdb-kubernetes-operator 2>/dev/null || true
helm repo update
helm install documentdb-operator documentdb/documentdb-operator \
  --namespace documentdb-operator \
  --create-namespace \
  --wait
```

Create a namespace, credentials Secret, and DocumentDB cluster:

```bash
kubectl apply -f - <<'EOF'
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
```

Wait for the custom resource to become healthy:

```bash
kubectl wait --for=jsonpath='{.status.phase}'='Cluster in healthy state' \
  documentdb/my-documentdb \
  --namespace documentdb-ns \
  --timeout=300s
```

Inspect the result:

```bash
kubectl get documentdb -n documentdb-ns
kubectl get pods -n documentdb-ns
kubectl get services -n documentdb-ns
kubectl get secret documentdb-credentials -n documentdb-ns
```

You should see a `DocumentDB` resource named `my-documentdb`, at least one ready pod, and a Service named `documentdb-service-my-documentdb`.

## Path B: create an AKS test cluster in Azure

Use this path when you want to test the same extension flow against a real Azure-hosted Kubernetes cluster.

The commands below create a small dev/test AKS cluster. They intentionally keep the DocumentDB Service as `ClusterIP`, so the database is reached through Kubernetes port-forwarding rather than a public load balancer.

### Prefer the DKO AKS automation scripts

The DKO repository owns the AKS deployment automation for DocumentDB on Kubernetes:

- AKS setup guide: [`documentdb-playground/aks-setup/README.md`](https://github.com/documentdb/documentdb-kubernetes-operator/blob/main/documentdb-playground/aks-setup/README.md)
- AKS create script: [`documentdb-playground/aks-setup/scripts/create-cluster.sh`](https://github.com/documentdb/documentdb-kubernetes-operator/blob/main/documentdb-playground/aks-setup/scripts/create-cluster.sh)
- AKS connection test script: [`documentdb-playground/aks-setup/scripts/test-connection.sh`](https://github.com/documentdb/documentdb-kubernetes-operator/blob/main/documentdb-playground/aks-setup/scripts/test-connection.sh)
- AKS cleanup script: [`documentdb-playground/aks-setup/scripts/delete-cluster.sh`](https://github.com/documentdb/documentdb-kubernetes-operator/blob/main/documentdb-playground/aks-setup/scripts/delete-cluster.sh)

If you have the DKO repository checked out next to this repository as `../dko`, the fastest AKS path is:

```bash
cd ../dko/documentdb-playground/aks-setup/scripts
az login
./create-cluster.sh --install-all
./test-connection.sh
```

The DKO AKS script creates an AKS Kubernetes cluster, configures Azure storage and load balancing, installs cert-manager and the DocumentDB Kubernetes Operator, deploys a sample DocumentDB instance, and configures kubeconfig. The test script checks the DocumentDB resource status, Service, credentials Secret, and database connectivity.

Run the cleanup script when you finish testing:

```bash
./delete-cluster.sh --delete-all
```

The manual AKS steps below are useful when you want to understand or customize each command before running the DKO automation.

### 1. Sign in and choose names

```bash
az login

LOCATION=eastus
RESOURCE_GROUP=rg-documentdb-k8s-dev
AKS_NAME=aks-documentdb-dev
```

Create the resource group:

```bash
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION"
```

### 2. Create the AKS cluster

For a development cluster, this Standard AKS command is a practical baseline:

```bash
az aks create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$AKS_NAME" \
  --location "$LOCATION" \
  --node-count 2 \
  --node-vm-size Standard_D4ds_v5 \
  --network-plugin azure \
  --network-plugin-mode overlay \
  --network-dataplane cilium \
  --enable-managed-identity \
  --generate-ssh-keys
```

Notes:

- `Standard_D4ds_v5` is a reasonable dev/test node size. Avoid burstable B-series nodes for this workload.
- Azure CNI Overlay keeps pod IP consumption manageable.
- Cilium provides a modern dataplane and network policy support.
- If your Azure CLI version or region does not support `--network-dataplane cilium`, update the Azure CLI or remove that line for the lab cluster.
- For production, decide AKS Automatic versus Standard, API server access, network policy, private networking, observability, and upgrade strategy before creating the cluster.

Download the kubeconfig entry:

```bash
az aks get-credentials \
  --resource-group "$RESOURCE_GROUP" \
  --name "$AKS_NAME" \
  --overwrite-existing
```

Confirm that `kubectl` can reach the cluster:

```bash
kubectl get nodes
kubectl config current-context
```

### 3. Install cert-manager on AKS

```bash
helm repo add jetstack https://charts.jetstack.io 2>/dev/null || true
helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set installCRDs=true \
  --wait
```

### 4. Install the DocumentDB Kubernetes Operator on AKS

```bash
helm repo add documentdb https://documentdb.github.io/documentdb-kubernetes-operator 2>/dev/null || true
helm repo update
helm install documentdb-operator documentdb/documentdb-operator \
  --namespace documentdb-operator \
  --create-namespace \
  --wait
```

Verify the operator:

```bash
kubectl get pods -n documentdb-operator
kubectl get crd | grep documentdb
```

### 5. Deploy a DocumentDB cluster on AKS

Use a development password that is not reused anywhere else. Do not commit real secrets.

```bash
kubectl apply -f - <<'EOF'
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
  password: ReplaceWithADevOnlyPassword
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
```

Wait and inspect:

```bash
kubectl wait --for=jsonpath='{.status.phase}'='Cluster in healthy state' \
  documentdb/my-documentdb \
  --namespace documentdb-ns \
  --timeout=600s

kubectl get documentdb,pods,services -n documentdb-ns
```

If the wait times out, inspect events and operator logs:

```bash
kubectl describe documentdb my-documentdb -n documentdb-ns
kubectl get events -n documentdb-ns --sort-by=.lastTimestamp
kubectl logs -n documentdb-operator deploy/documentdb-operator
```

## Manual database connectivity test

This test proves the Kubernetes cluster and DocumentDB deployment work before you involve the VS Code extension.

Find a ready pod:

```bash
kubectl get pods -n documentdb-ns
```

Start a port-forward from your terminal. Replace `<ready-pod-name>` with the pod name from the previous command:

```bash
kubectl port-forward pod/<ready-pod-name> 10260:10260 -n documentdb-ns
```

In another terminal, connect with `mongosh`:

```bash
mongosh 'mongodb://dev_user:<password>@127.0.0.1:10260/?directConnection=true&authMechanism=SCRAM-SHA-256&tls=true&tlsAllowInvalidCertificates=true&replicaSet=rs0'
```

For the local setup script, the sample password is `DevPassword123`. For AKS, use the development password you put in the Secret.

Run a quick smoke test in `mongosh`:

```javascript
show dbs
use smoke
db.items.insertOne({ source: "kubernetes-discovery-lab", createdAt: new Date() })
db.items.find()
```

Stop the manual port-forward with `Ctrl+C` after the test. The VS Code extension starts its own port-forward when it connects to a `ClusterIP` Service.

## Test in the VS Code extension

### 1. Build and start the extension

From the repository root:

```bash
npm install
npm run build
npm run webpack-dev
```

Open the repository in VS Code and press `F5` to launch an Extension Development Host.

### 2. Verify Kubernetes discovery in the tree

In the Extension Development Host:

1. Open the DocumentDB activity bar.
2. Expand **Service Discovery**.
3. Expand **Kubernetes**.
4. Expand your kubeconfig source:
   - local kind: **Default kubeconfig** should include context `kind-documentdb-dev`,
   - AKS: **Default kubeconfig** should include the AKS context added by `az aks get-credentials`.
5. Expand the context.
6. Expand namespace `documentdb-ns`.
7. Confirm that `my-documentdb` or `documentdb-service-my-documentdb` appears as a DocumentDB target.

Expected tree shape:

```text
Service Discovery
  Kubernetes
    Default kubeconfig
      kind-documentdb-dev
        documentdb-ns
          my-documentdb [DKO] [ClusterIP :10260]
```

The exact label may include provider, region, service type, or port details.

### 3. Add the discovered target as a connection

Use either flow:

- Tree flow: right-click the discovered Kubernetes target and add it to the Connections view.
- Wizard flow: run **New Connection**, choose **Service Discovery**, choose **Kubernetes**, select the context, then select the DocumentDB target.

For a `ClusterIP` Service, the extension asks for a local port. Use `10260` if it is free, or choose another local port.

Expected behavior:

1. The extension starts a port-forward tunnel to a ready DocumentDB pod.
2. The generated connection string uses `127.0.0.1:<localPort>`.
3. Credentials are auto-resolved from Secret `documentdb-credentials`.
4. The connection appears in the Connections view.
5. Expanding the connection lists databases and collections.

### 4. Verify saved-connection reconnect

After adding the connection:

1. Close the collection/database nodes if they are open.
2. Stop any manually started `kubectl port-forward`; the extension tunnel is separate.
3. Reload the Extension Development Host.
4. Expand the saved connection again.

Expected behavior:

- The extension reloads the Kubernetes source metadata saved with the connection.
- It reuses or recreates the source-scoped port-forward tunnel.
- It reconnects without asking you to rebuild the connection string manually.

## Test generic Service fallback

The DKO path is the primary path. You can also verify generic Kubernetes Service discovery by creating a Service that opts in explicitly.

First inspect the labels on the ready DocumentDB pods:

```bash
kubectl get pods -n documentdb-ns --show-labels
```

Then create a generic Service whose selector matches those ready pods. The example below is a template: replace `<label-key>` and `<label-value>` with a real label key/value pair from the previous command before applying it.

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: generic-documentdb-credentials
  namespace: documentdb-ns
type: Opaque
stringData:
  username: dev_user
  password: DevPassword123
---
apiVersion: v1
kind: Service
metadata:
  name: generic-documentdb-target
  namespace: documentdb-ns
  annotations:
    documentdb.vscode.extension/discovery: "true"
    documentdb.vscode.extension/credential-secret: generic-documentdb-credentials
spec:
  type: ClusterIP
  selector:
    <label-key>: <label-value>
  ports:
    - name: documentdb
      protocol: TCP
      port: 10260
      targetPort: 10260
EOF
```

Refresh the Kubernetes discovery tree. The generic Service should appear if its selector points to ready DocumentDB pods. If it does not appear, check the Service selector and endpoints:

```bash
kubectl describe service generic-documentdb-target -n documentdb-ns
kubectl get endpoints generic-documentdb-target -n documentdb-ns
```

## Common failure points

| Symptom                                            | What it usually means                                                                | How to check                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Kubernetes source fails to load                    | kubeconfig is missing, invalid, or points to an unreachable cluster.                 | `kubectl config current-context`; `kubectl get namespaces`                                                         |
| Context appears but namespace loading fails        | Kubernetes identity lacks `namespaces list`.                                         | Ask for RBAC or use an admin/dev kubeconfig.                                                                       |
| Namespace appears but no DocumentDB target appears | DKO resource is not healthy, Service is missing, or generic Service does not opt in. | `kubectl get documentdb,services -n documentdb-ns`                                                                 |
| DKO discovery returns an RBAC error                | The identity cannot list `documentdb.io` `dbs` resources.                            | `kubectl auth can-i list dbs.documentdb.io -n documentdb-ns`                                                       |
| Credentials are not auto-filled                    | Secret is missing, has different keys, or Kubernetes identity cannot `get` Secrets.  | `kubectl get secret documentdb-credentials -n documentdb-ns`; `kubectl auth can-i get secrets -n documentdb-ns`    |
| Port-forward fails                                 | No ready endpoint, local port in use, or missing `pods/portforward create`.          | `kubectl get endpoints -n documentdb-ns`; `kubectl auth can-i create pods/portforward -n documentdb-ns`            |
| AKS nodes are stuck or pods are pending            | VM quota, storage, image pull, or scheduling issue.                                  | `kubectl describe pod <pod> -n documentdb-ns`; `az aks show --resource-group "$RESOURCE_GROUP" --name "$AKS_NAME"` |

## Cleanup

### Local kind cleanup

```bash
./scripts/k8s-test-teardown.sh
```

or:

```bash
kind delete cluster --name documentdb-dev
```

### AKS cleanup

To stop paying for the AKS lab and its related resources:

```bash
az group delete \
  --name "$RESOURCE_GROUP" \
  --yes
```

If you want to keep the resource group but remove only the cluster:

```bash
az aks delete \
  --resource-group "$RESOURCE_GROUP" \
  --name "$AKS_NAME" \
  --yes
```

## Quick validation checklist

Use this checklist before asking someone else to review the feature:

- `kubectl get nodes` works for the selected context.
- `kubectl get documentdb -n documentdb-ns` shows `my-documentdb`.
- `kubectl get service -n documentdb-ns` shows `documentdb-service-my-documentdb`.
- Manual `kubectl port-forward` plus `mongosh` works.
- Extension Development Host shows **Service Discovery** -> **Kubernetes**.
- Kubernetes tree shows the kubeconfig source, context, namespace, and DocumentDB target.
- Adding the target creates a saved connection.
- The saved connection expands and lists databases.
- Reloading the Extension Development Host still reconnects through the saved Kubernetes metadata.
