> **User Manual** &mdash; [Back to Service Discovery](./service-discovery) | [Back to User Manual](../index#user-manual)

---

# Kubernetes Service Discovery

The Kubernetes discovery plugin helps you find DocumentDB-compatible targets running in Kubernetes clusters, including AKS, EKS, GKE, OpenShift, on-premises clusters, and local clusters such as kind, minikube, k3s, k3d, Docker Desktop, and Rancher Desktop.

You can use Kubernetes discovery from either:

- The **Service Discovery** tree, where you browse contexts, namespaces, and discovered targets.
- **New Connection** > **Service Discovery** > **Kubernetes**, where the wizard creates a connection from a discovered target.

## Enable and Configure Kubernetes Discovery

1. Open the **Service Discovery** panel.
2. Select **+** and choose **Kubernetes**.
3. Choose a kubeconfig source.

The selected kubeconfig is validated before it is saved. If the file cannot be loaded or does not contain any contexts, the setup flow fails immediately so you can choose a different source. By default, all contexts from the selected kubeconfig are enabled, matching the Azure DocumentDB discovery behavior where adding the provider does not ask for per-context aliases, context selection, or namespace selection. After activation, use **Manage Credentials** on the Kubernetes provider to change the kubeconfig source. Use **Filter** separately when you want to hide contexts.

Reconfiguring Kubernetes credentials stops active Kubernetes port-forward tunnels automatically. Tunnels are recreated when you connect to ClusterIP targets again.

## Kubeconfig Sources

| Source | Behavior |
| --- | --- |
| **Default kubeconfig** | Uses the Kubernetes client's default loading behavior, including `KUBECONFIG` and `~/.kube/config`. |
| **Custom kubeconfig file** | Lets you browse to a kubeconfig file. The selected file path is stored in extension global state. |
| **Pasted kubeconfig YAML** | Reads kubeconfig YAML from the clipboard and stores it in VS Code Secret Storage. |

If a configured kubeconfig cannot be loaded later, the Kubernetes tree shows recovery actions to configure kubeconfig, open Kubernetes discovery documentation, or retry.

## Contexts and Filters

**Manage Credentials** controls the kubeconfig source:

- Default kubeconfig
- Custom kubeconfig file
- Pasted kubeconfig YAML

Changing the kubeconfig source does not immediately prompt for context or namespace filtering. All contexts from the selected source are enabled by default.

**Filter** controls context visibility without changing enabled contexts:

- Hidden contexts are not shown in the Discovery tree or the New Connection Kubernetes wizard.
- Filtering is useful for reducing noise after choosing or changing the kubeconfig source.

## Browse the Discovery Tree

Kubernetes discovery keeps context loading lightweight while making namespace browsing easier to understand:

1. The Kubernetes root lists visible enabled contexts without scanning namespaces or services.
2. Expanding a context checks namespaces for DocumentDB targets.
3. Namespaces that contain DocumentDB targets are expandable and sorted first.
4. Namespaces without DocumentDB targets remain visible as non-expandable leaf items with a "No DocumentDB targets" description.
5. Expanding a DocumentDB namespace lists the targets in that namespace.

If kubeconfig loading fails, no contexts are available, or filters hide every context, the tree shows recovery actions such as **Configure kubeconfig**, **Manage Filter**, **Open Kubernetes discovery docs**, and **Retry**. Namespace or service listing failures still show retry items and write diagnostics to the DocumentDB output channel.

## New Connection Wizard Behavior

The **New Connection** > **Service Discovery** > **Kubernetes** flow uses the same visibility rules as the tree:

1. It lists enabled contexts that are not hidden by Filter.
2. It scans namespaces in the selected context without prompting for namespace selection.
3. It lists discovered DocumentDB targets directly.
4. It resolves the endpoint and creates a credential-free DocumentDB API connection string.
5. If credentials are available from a supported Kubernetes Secret, it preselects native username/password authentication and masks the password.

If credentials cannot be read or are not configured, discovery still succeeds and the connection flow prompts you for credentials later.

## Discovery Rules

Kubernetes discovery uses the following target selection order.

### 1. DocumentDB Kubernetes Operator Resources

DocumentDB Kubernetes Operator (DKO) custom resources are discovered first. The plugin lists `documentdb.io/preview` `dbs` resources in the selected namespace and maps each resource to its backing Service.

DKO-backed Services are not duplicated by generic service fallback. DKO targets are displayed before generic targets.

### 2. Explicit Generic Service Opt-In

A generic Kubernetes Service can opt in to discovery with this annotation or label:

```yaml
metadata:
  annotations:
    documentdb.vscode.extension/discovery: "true"
```

or:

```yaml
metadata:
  labels:
    documentdb.vscode.extension/discovery: "true"
```

An opted-in Service is included when it has at least one TCP port. Ports with non-TCP protocols are ignored. If the Kubernetes port protocol is omitted, it is treated as TCP.

### 3. Known-Port Generic Fallback

Without explicit opt-in, generic fallback includes TCP Services that expose a known DocumentDB API-compatible service or numeric target port:

- `27017`
- `27018`
- `27019`
- `10260`

Services that are not DKO-backed, not explicitly opted in, and not on a known DocumentDB API-compatible port are ignored.

## Credential Secret Conventions

Credentials are passed to the extension as native username/password authentication. They are never embedded into Kubernetes-discovered connection strings and are not written to logs.

### DKO Credentials

For DKO resources, the plugin reads the Secret named by:

```yaml
spec:
  documentDbCredentialSecret: <secretName>
```

If `spec.documentDbCredentialSecret` is not set, the plugin uses the default Secret name `documentdb-credentials`.

### Generic Service Credentials

For generic Services, add a same-namespace Secret reference with this annotation:

```yaml
metadata:
  annotations:
    documentdb.vscode.extension/credential-secret: "my-documentdb-credentials"
```

The Secret name must be a valid Kubernetes DNS subdomain name. The Secret must contain `username` and `password` data keys. For example:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: my-documentdb-credentials
  namespace: app
stringData:
  username: my-user
  password: my-password
```

Missing, invalid, or unreadable credential Secrets do not block discovery. The extension prompts for credentials later when needed.

## Endpoint Resolution and Port Forwarding

| Kubernetes Service type | Behavior |
| --- | --- |
| **LoadBalancer** | Uses the first load balancer ingress hostname or IP. If ingress is not assigned yet, falls back to NodePort behavior when a NodePort is available. |
| **NodePort** | Uses node `ExternalIP` addresses first. If only `InternalIP` addresses are available, the extension warns that the endpoint may not be reachable from your machine. |
| **ClusterIP** | Starts a local port-forward tunnel to a ready backing pod and connects through `127.0.0.1:<localPort>`. |
| **ExternalName** | Not resolved automatically. Use the external DNS name to connect manually. |

For ClusterIP targets, the extension prompts for a local port when needed. If the port is already in use, the extension can use an existing process on that port, such as a manually started `kubectl port-forward`, if you confirm.

Active tunnels are tracked and reused for the same context, namespace, Service, and local port. Tunnels stop automatically when the extension is disposed or when Kubernetes credentials are reconfigured. There are internal APIs for tunnel management, but there are no user-facing list or stop commands at this time.

## Minimum RBAC Permissions

The current implementation uses the following Kubernetes API operations. `services` only requires `list`; service `get` and `watch` are not required.

| Purpose | API group | Resource | Verbs |
| --- | --- | --- | --- |
| List contexts' namespaces | `""` | `namespaces` | `list` |
| Discover Services in a selected namespace | `""` | `services` | `list` |
| Resolve NodePort and LoadBalancer NodePort fallback addresses | `""` | `nodes` | `list` |
| Resolve ClusterIP port-forward backend pods | `""` | `endpoints` | `get` |
| Open ClusterIP port-forward streams | `""` | `pods/portforward` | `create` |
| Read DKO or generic credential Secrets | `""` | `secrets` | `get` |
| Discover DKO resources | `documentdb.io` | `dbs` | `list` |

A broad ClusterRole for all Kubernetes discovery features looks like this:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: documentdb-vscode-discovery
rules:
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["list"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["list"]
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["list"]
  - apiGroups: [""]
    resources: ["endpoints"]
    verbs: ["get"]
  - apiGroups: [""]
    resources: ["pods/portforward"]
    verbs: ["create"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get"]
  - apiGroups: ["documentdb.io"]
    resources: ["dbs"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: documentdb-vscode-discovery-binding
subjects:
  - kind: User
    name: <your-username>
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: documentdb-vscode-discovery
  apiGroup: rbac.authorization.k8s.io
```

You can narrow permissions for production use. Because `namespaces` and `nodes` are cluster-scoped resources, a namespace-scoped setup usually combines a small ClusterRole for cluster-scoped reads with Roles in selected namespaces for `services`, `endpoints`, `pods/portforward`, `secrets`, and `dbs`.

If RBAC denies an operation, discovery surfaces the failure as a warning, retry node, or connection error instead of silently hiding the cluster.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Kubernetes provider activates but shows a kubeconfig error | Verify the default kubeconfig or use **Manage Credentials** to choose another source. |
| No contexts appear | Verify kubeconfig contents and check **Filter**. |
| Context is missing | Check **Filter**. Filters hide contexts in both the tree and New Connection wizard without changing enabled contexts. |
| Namespace shows no DocumentDB services | Verify a DKO `dbs` resource exists, add the explicit discovery annotation/label, or expose a TCP known-port service. |
| RBAC errors or retry nodes | Grant the relevant RBAC from the table above. Namespace and service list failures appear as retry/error nodes. |
| LoadBalancer target is pending | Wait for load balancer ingress, or ensure NodePort fallback is available and reachable. |
| NodePort uses an InternalIP | The address may only be reachable from inside the cluster network. Use a reachable node address or another service type if needed. |
| ClusterIP connection fails | Check that a ready backing pod appears in the Service Endpoints, that `pods/portforward` is allowed, and that the chosen local port is free or intentionally reused. |
| Credentials are not auto-filled | Verify the Secret name convention, namespace, RBAC `secrets get`, and `username` / `password` data keys. Discovery still works without auto-resolved credentials. |

## Cluster Provider Detection

The plugin identifies common cluster providers from the kubeconfig server URL, context name, or cluster name. The detected provider and region, when available, are shown in the tree description or tooltip.

| Provider | Detection method |
| --- | --- |
| **AKS** | `*.azmk8s.io` server URL, with region extracted when available. |
| **EKS** | `*.eks.amazonaws.com` server URL, with region extracted when available. |
| **GKE** | `container.googleapis.com` or `*.gke.io` server URL. |
| **OpenShift** | Server URL or context/cluster name contains `openshift`. |
| **kind** | Context or cluster name starts with `kind-`. |
| **minikube** | Context or cluster name contains `minikube`. |
| **k3s / k3d** | Context or cluster name contains `k3s` or `k3d`. |
| **Docker Desktop** | Context or cluster name contains `docker-desktop` or `docker desktop`. |
| **Rancher** | Context or cluster name contains `rancher`. |
