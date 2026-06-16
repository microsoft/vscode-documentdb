> **User Manual** &mdash; [Back to Service Discovery](./service-discovery) | [Back to User Manual](../index#user-manual)

---

# Kubernetes Service Discovery

The Kubernetes discovery plugin helps you find DocumentDB-compatible targets running in Kubernetes clusters, including AKS, EKS, GKE, OpenShift, on-premises clusters, and local clusters such as kind, minikube, k3s, k3d, Docker Desktop, and Rancher Desktop.

You can use Kubernetes discovery from either:

- The **Service Discovery** tree, where you browse kubeconfig sources, contexts, namespaces, and discovered targets.
- **New Connection** > **Service Discovery** > **Kubernetes**, where the wizard creates a connection from a discovered target.

For a step-by-step lab that creates a local or AKS DocumentDB cluster and tests this feature end to end, see [Kubernetes Service Discovery: Getting Started and Test Lab](./service-discovery-kubernetes-getting-started).

## Multiple kubeconfig sources

The **Kubernetes Clusters** node lists one or more **kubeconfig sources** as siblings:

- **Default kubeconfig**: uses the Kubernetes client's default loading (`KUBECONFIG` environment variable, or the Kubernetes default kubeconfig path in your user profile). It is created by default, but if you remove it explicitly, it stays removed until you add it again.
- **Custom kubeconfig file…**: a kubeconfig YAML file you select on disk.
- **Pasted kubeconfig YAML**: kubeconfig YAML pasted from the clipboard, kept in VS Code Secret Storage.

Each source expands independently to its own contexts -> namespaces -> services subtree. Failures in one source do not affect the others.

## Add a kubeconfig source

The **Kubernetes Clusters** node has an inline **`+` (Add Kubeconfig…)** action that opens a quick pick:

- **Default kubeconfig**: uses the `KUBECONFIG` environment variable or Kubernetes default kubeconfig path.
- **Add custom kubeconfig file...**: pick a file from disk.
- **Paste kubeconfig YAML from clipboard**: kept in VS Code Secret Storage.

Custom file and pasted-YAML sources are validated before they are saved. If the file or pasted YAML cannot be loaded or contains zero contexts, the source is not added and an error is shown. The Default source also validates the current default kubeconfig before it is added; if it is missing, invalid, or empty, fix the underlying `KUBECONFIG` value or default kubeconfig file and try again. Adding the same path twice or pasting identical YAML reuses the existing entry.

The Kubernetes default kubeconfig path is `~/.kube/config` on macOS/Linux and `%USERPROFILE%\.kube\config` on Windows.

## Manage existing sources

Manage each source from its **right-click context menu** in the discovery tree:

- **Refresh**: reloads the source and re-expands its contexts.
- **Rename…**: changes the source's display label, including the Default source. This only changes the label shown in the tree; the kubeconfig file is never modified.
- **Edit Kubeconfig**: opens the kubeconfig YAML file in the editor (file-based sources only), which is handy when fixing a source that failed to load.
- **View Kubeconfig**: opens a read-only view of the stored YAML (pasted/inline sources only). To change it, copy the content, edit it elsewhere, and re-add the source with **Add Kubeconfig…**.
- **Remove…**: deletes the source, including the Default source. Removing a source stops active port-forward tunnels for that source, and saved connections that depend on it need to be reconfigured or the source needs to be added again. If you remove the Default source it stays removed until you add it again with **Add Kubeconfig…**.

## Browse the discovery tree

```
v Discovery
  v Kubernetes Clusters
    v Default kubeconfig
      v aks-prod (AKS / eastus)
        v app
          > sample-documentdb   port-forward
        > Other namespaces
    v team.yaml
      v eks-staging
        ...
```

1. Each source lists its contexts after a lightweight kubeconfig load.
2. Expanding a context checks its namespaces for DocumentDB targets.
3. Namespaces with DocumentDB targets are shown directly under the context.
4. Namespaces where DocumentDB targets were not detected are grouped under **Other namespaces**. That bucket has no inline description to keep the row short; hover it for a tooltip that explains the namespaces were scanned but had no DocumentDB target. Expand it to see which namespaces were checked.
5. Namespaces whose pre-scan failed remain visible directly under the context so the error and **Retry** action are easy to find.
6. Expanding a DocumentDB namespace lists the discovered targets.

## Switch between list and tree view

A context node has a **view toggle** that controls how the levels beneath every context are shown across the whole Kubernetes discovery (it is a global choice, surfaced on the context node so it is easy to find). The current choice is remembered between sessions.

- **List view** (default): contexts list discovered DocumentDB clusters directly, with the namespace shown in each cluster's grey description. Empty namespaces are not shown, so you see clusters immediately without scanning past namespaces that contain no targets.
- **Tree view**: contexts list namespaces, and DocumentDB clusters live under each namespace (with empty namespaces grouped under **Other namespaces**, as described above).

Use the inline button on a context node, or its right-click context menu, to switch. Following the same convention as the VS Code Search view, the button's icon reflects the **current** mode and its label states the action: in tree view it shows **View as List**, and in list view it shows **View as Tree**. Namespaces whose pre-scan failed stay visible in both modes so you can retry them.

## Reading a discovered target

Each discovered DocumentDB target appears as a cluster node using the **DocumentDB** icon, so it reads as a first-class cluster you can expand and connect to, just like a saved connection.

The grey text after the target name is a single **connectivity word** that tells you how the extension reaches the service, in other words how portable the resulting connection string is. The healthy, directly reachable case shows no word at all; a word is only shown when there is something to be aware of:

| Word           | Service type / state                  | What it means                                                                                                              |
| -------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| _(none)_       | LoadBalancer with an external address | Reachable directly; the connection string is portable if that address is reachable from you.                               |
| `node-routed`  | NodePort, or LoadBalancer via a node  | Reached through a cluster node address; only works if that node is reachable from your machine.                            |
| `pending`      | LoadBalancer awaiting an external IP  | No external address assigned yet (mirrors `kubectl`'s `EXTERNAL-IP: <pending>`).                                           |
| `port-forward` | ClusterIP                             | Reached through a local port-forward tunnel; the `127.0.0.1` string only works on this machine while the tunnel is active. |
| `unsupported`  | ExternalName or unknown types         | Not resolved automatically; connect manually using a reachable endpoint.                                                   |

Hover the target for a richer tooltip that leads with the reachability explanation and then lists the target identity, its **source** (a DocumentDB Kubernetes Operator resource or a generic service), the service type, port, and where it lives (provider, region, namespace, context).

## Rename a context (display alias)

Auto-generated context names from cloud CLIs (`clusterUser_…`, `arn:aws:eks:…`, `gke_…`) are often hard to scan. You can give a context a friendlier display name without modifying the kubeconfig file:

1. Right-click a context node in the Discovery tree -> **Rename Context...**
2. Type a display name (e.g. `Prod AKS East`) and press Enter. Submit an empty value to clear the alias.

The alias is stored locally inside the extension. It changes only:

- the tree label (the original context name remains visible in parentheses next to the alias),
- the wizard quick-pick label (the original name appears in brackets in the description so you can still grep by it).

The kubeconfig file, the underlying Kubernetes context name, saved-connection metadata, and output-channel logs are **never** modified. Aliases are scoped per source, so the same context name in two different kubeconfig sources can have different aliases. If you delete a context from the kubeconfig (or remove the source), its aliases are cleaned up automatically.

## New Connection wizard

The **New Connection** > **Service Discovery** > **Kubernetes** flow lists every context across every source in a single quick pick. Each item shows the source label in the description so colliding context names can be told apart.

After selecting a context and a target, the wizard:

1. Resolves the endpoint and creates a credential-free DocumentDB API connection string.
2. Starts a port-forward tunnel for `ClusterIP` services, prompting for a local port.
3. If credentials are available from a supported Kubernetes Secret, preselects native username/password authentication and masks the password.

If credentials cannot be read or are not configured, discovery still succeeds and the connection flow prompts you for credentials later.

## Discovery rules

Kubernetes discovery uses the following target selection order.

### 1. DocumentDB Kubernetes Operator resources

DocumentDB Kubernetes Operator (DKO) custom resources are discovered first. The plugin lists `documentdb.io/preview` `dbs` resources in the selected namespace and maps each resource to its backing Service.

DKO-backed Services are not duplicated by generic service fallback. DKO targets are displayed before generic targets.

If the DKO CRD is not installed in a cluster, Kubernetes discovery falls back to generic Service discovery. If the CRD exists but cannot be listed because of RBAC, authentication, or API errors, discovery surfaces the failure instead of silently showing only generic targets.

### 2. Explicit generic service opt-in

A generic Kubernetes Service can opt in to discovery with this annotation or label:

```yaml
metadata:
  annotations:
    documentdb.vscode.extension/discovery: 'true'
```

or:

```yaml
metadata:
  labels:
    documentdb.vscode.extension/discovery: 'true'
```

An opted-in Service is included when it has at least one TCP port. Ports with non-TCP protocols are ignored. If the Kubernetes port protocol is omitted, it is treated as TCP.

### 3. Known-port generic fallback

Without explicit opt-in, generic fallback includes TCP Services that expose a known DocumentDB API-compatible service or numeric target port:

- `27017`
- `27018`
- `27019`
- `10260`

Services that are not DKO-backed, not explicitly opted in, and not on a known DocumentDB API-compatible port are ignored.

## Credential secret conventions

Credentials are passed to the extension as native username/password authentication. They are never embedded into Kubernetes-discovered connection strings and are not written to logs.

### DKO credentials

For DKO resources, the plugin reads the Secret named by:

```yaml
spec:
  documentDbCredentialSecret: <secretName>
```

If `spec.documentDbCredentialSecret` is not set, the plugin uses the default Secret name `documentdb-credentials`.

### Generic service credentials

For generic Services, add a same-namespace Secret reference with this annotation:

```yaml
metadata:
  annotations:
    documentdb.vscode.extension/credential-secret: 'my-documentdb-credentials'
```

The Secret name must be a valid Kubernetes DNS subdomain name. The Secret must contain `username` and `password` data keys.

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

## Connection security (TLS/SSL)

Kubernetes-discovered DocumentDB targets are connected to with TLS enabled but **certificate validation disabled** (`tls=true&tlsAllowInvalidCertificates=true`). The DocumentDB Kubernetes Operator (DKO) gateway commonly serves a **self-signed certificate**, so strict certificate verification would otherwise break the most common discovery path. With validation disabled, the connection is still encrypted in transit, but the server certificate is not verified, so it does not protect against an on-path (man-in-the-middle) attacker.

Discovered target nodes show a `⚠️ Security: TLS/SSL certificate validation disabled` line in their hover tooltip so this is visible before you connect.

When you **save** a discovered target to the Connections view, the `tlsAllowInvalidCertificates=true` parameter is stored as part of the connection string. If your service presents a certificate that your machine trusts (for example, a CA-signed certificate rather than the DKO self-signed one), you can **edit the saved connection and remove `tlsAllowInvalidCertificates=true`** to re-enable certificate validation. As with [local connections](./local-connection#tls-ssl-security), it is worth investing a little time in proper certificates even outside production so security-related issues surface early.

## Endpoint resolution and port forwarding

| Kubernetes Service type | Behavior                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LoadBalancer**        | Uses the first load balancer ingress hostname or IP. If ingress is not assigned yet, falls back to NodePort behavior when a NodePort is available.                  |
| **NodePort**            | Uses node `ExternalIP` addresses first. If only `InternalIP` addresses are available, the extension warns that the endpoint may not be reachable from your machine. |
| **ClusterIP**           | Starts a local port-forward tunnel to a ready backing pod and connects through `127.0.0.1:<localPort>`.                                                             |
| **ExternalName**        | Not resolved automatically. Use the external DNS name to connect manually.                                                                                          |

For ClusterIP targets the extension prompts for a local port when needed. By default, the suggested local port matches the remote service port. You can change this under **DocumentDB** > **Service Discovery** > **Kubernetes** > **Port Forward** in VS Code settings:

- **Local Port Strategy** (`documentDB.serviceDiscovery.kubernetes.portForward.localPortStrategy`):
  - **matchRemote**: use the same port number as the remote Kubernetes service port.
  - **autoSelect**: automatically find a free local port starting from **Local Port Base**.
- **Local Port Base** (`documentDB.serviceDiscovery.kubernetes.portForward.localPortBase`, default `27100`): the starting port for the **autoSelect** strategy.

If the final port is already in use, the extension can use an existing process on that port (such as a manually started `kubectl port-forward`) if you confirm.

Active tunnels are tracked and reused for the same source, context, namespace, Service, and local port. Tunnels stop automatically when the extension is disposed or when the underlying source is removed.

A connection string for a ClusterIP target points at `127.0.0.1:<localPort>` and therefore only works **on this machine while the tunnel is active**. For sharing such a connection with a teammate, see [Copy Connection String](./copy-connection-string).

## Minimum RBAC permissions

The current implementation uses the following Kubernetes API operations. `services` only requires `list`; service `get` and `watch` are not required.

| Purpose                                                       | API group       | Resource           | Verbs    |
| ------------------------------------------------------------- | --------------- | ------------------ | -------- |
| List contexts' namespaces                                     | `""`            | `namespaces`       | `list`   |
| Discover Services in a selected namespace                     | `""`            | `services`         | `list`   |
| Resolve NodePort and LoadBalancer NodePort fallback addresses | `""`            | `nodes`            | `list`   |
| Resolve ClusterIP port-forward backend pods                   | `""`            | `endpoints`        | `get`    |
| Open ClusterIP port-forward streams                           | `""`            | `pods/portforward` | `create` |
| Read DKO or generic credential Secrets                        | `""`            | `secrets`          | `get`    |
| Discover DKO resources                                        | `documentdb.io` | `dbs`              | `list`   |

A broad ClusterRole for all Kubernetes discovery features looks like this:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: documentdb-vscode-discovery
rules:
  - apiGroups: ['']
    resources: ['namespaces']
    verbs: ['list']
  - apiGroups: ['']
    resources: ['services']
    verbs: ['list']
  - apiGroups: ['']
    resources: ['nodes']
    verbs: ['list']
  - apiGroups: ['']
    resources: ['endpoints']
    verbs: ['get']
  - apiGroups: ['']
    resources: ['pods/portforward']
    verbs: ['create']
  - apiGroups: ['']
    resources: ['secrets']
    verbs: ['get']
  - apiGroups: ['documentdb.io']
    resources: ['dbs']
    verbs: ['list']
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

| Symptom                                | What to check                                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A source shows a kubeconfig error      | Verify the file exists or the YAML is still valid; use **Refresh** or remove the source and add it again.                                                            |
| No contexts under a source             | Verify the kubeconfig contents; the source must declare at least one context.                                                                                        |
| Namespace shows no DocumentDB services | Verify a DKO `dbs` resource exists, add the explicit discovery annotation/label, or expose a TCP known-port service.                                                 |
| RBAC errors or retry nodes             | Grant the relevant RBAC from the table above. Namespace and service list failures appear as retry/error nodes.                                                       |
| LoadBalancer target is pending         | Wait for load balancer ingress, or ensure NodePort fallback is available and reachable.                                                                              |
| NodePort uses an InternalIP            | The address may only be reachable from inside the cluster network. Use a reachable node address or another service type if needed.                                   |
| ClusterIP connection fails             | Check that a ready backing pod appears in the Service Endpoints, that `pods/portforward` is allowed, and that the chosen local port is free or intentionally reused. |
| Credentials are not auto-filled        | Verify the Secret name convention, namespace, RBAC `secrets get`, and `username` / `password` data keys. Discovery still works without auto-resolved credentials.    |

## Cluster provider detection

The plugin identifies common cluster providers from the kubeconfig server URL, context name, or cluster name. The detected provider and region, when available, are shown in the tree description or tooltip.

| Provider           | Detection method                                                        |
| ------------------ | ----------------------------------------------------------------------- |
| **AKS**            | `*.azmk8s.io` server URL, with region extracted when available.         |
| **EKS**            | `*.eks.amazonaws.com` server URL, with region extracted when available. |
| **GKE**            | `container.googleapis.com` or `*.gke.io` server URL.                    |
| **OpenShift**      | Server URL or context/cluster name contains `openshift`.                |
| **kind**           | Context or cluster name starts with `kind-`.                            |
| **minikube**       | Context or cluster name contains `minikube`.                            |
| **k3s / k3d**      | Context or cluster name contains `k3s` or `k3d`.                        |
| **Docker Desktop** | Context or cluster name contains `docker-desktop` or `docker desktop`.  |
| **Rancher**        | Context or cluster name contains `rancher`.                             |
