> **User Manual** &mdash; [Back to Service Discovery](./service-discovery) | [Back to User Manual](../index#user-manual)

---

# Copy Connection String

The **Copy Connection String** command puts a ready-to-use connection string for a cluster on your clipboard. It is available from the right-click menu of a cluster in both the **Connections** view and the **Service Discovery** view.

For most clusters the command copies the string directly (optionally asking whether to include the password). For **Kubernetes ClusterIP targets that are reached through a local port-forward tunnel**, it opens a small grouped quick pick with a few extra, Kubernetes-specific options.

**Table of Contents**

- [Standard clusters](#standard-clusters)
- [Including or omitting the password](#including-or-omitting-the-password)
- [Kubernetes port-forwarded targets](#kubernetes-port-forwarded-targets)
  - [Why these targets are special](#why-these-targets-are-special)
  - [The copy options](#the-copy-options)
  - [Sharing access with a teammate](#sharing-access-with-a-teammate)

## Standard clusters

Right-click a cluster and select **Copy Connection String…**. The connection string is copied to your clipboard and a short confirmation is shown.

## Including or omitting the password

When the cluster uses username/password authentication and a password is available, the command first asks whether to include it:

- **Copy without password**: the connection string omits the password. This is the safer choice when you intend to share or paste the string somewhere.
- **Copy with password**: the connection string includes the password.

This prompt appears for saved connections and for Kubernetes-discovered targets, which routinely carry a real password.

## Kubernetes port-forwarded targets

When you copy the connection string for a Kubernetes **ClusterIP** target, the command shows a grouped quick pick instead of copying immediately. This applies both to the discovered target in the **Service Discovery** view and to the corresponding saved connection in the **Connections** view.

### Why these targets are special

A ClusterIP service is not reachable from outside the cluster. To connect, the extension opens a local **port-forward tunnel** and the connection string points at `127.0.0.1:<localPort>`. That string therefore only works **on your machine, and only while the tunnel is active**. It is not portable: pasting it into another machine, or into a teammate's environment, will not connect.

For background on how the tunnel is established and reused, see [Endpoint resolution and port forwarding](./service-discovery-kubernetes#endpoint-resolution-and-port-forwarding).

### The copy options

The quick pick is organized into groups:

**Connection string**

- **Copy connection string without password**: safe to share; the password is omitted.
- **Copy connection string with password**: works on your machine while the tunnel is active (shown only when a password is available).

**Kubernetes**

- **Copy kubectl port-forward command**: copies a `kubectl … port-forward` command that reproduces the same machine-local tunnel, so a teammate can establish it on their own machine.
- **Learn more…**: opens this documentation.

After copying a connection string for a port-forwarded target, the extension reminds you that the string uses port-forwarding and only works on this machine while the tunnel is active.

### Sharing access with a teammate

Because the `127.0.0.1` connection string is machine-local, do not send it to a teammate directly. Instead, share the **`kubectl port-forward` command** from the quick pick (together with the password-free connection string if needed). Your teammate runs the command against the same cluster to open their own tunnel, then connects through their local `127.0.0.1:<localPort>`.
