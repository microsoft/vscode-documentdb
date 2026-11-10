---
title: 'Set up DocumentDB Local'
parent: 'Local Instances'
nav_order: 1
---

# Set up DocumentDB Local

Set up and manage a DocumentDB Local container from the Connections view. The extension pulls the official image, creates a persistent data volume, waits for DocumentDB to accept connections, and saves the connection in VS Code.

[DocumentDB](https://documentdb.io/) is an open-source, fully MongoDB-compatible database for modern application development. DocumentDB Local lets you run it in a local container for development and testing.

## Happy path

With Docker or Podman available to the extension host, and any required Podman machine already started, setup takes only a few clicks:

1. Open the **Connections** view.
2. Expand **Your own DocumentDB**, then select **Set up DocumentDB Local**.
3. On the **Introduction** step, select **Continue**.
4. On the **Configure** step, keep the defaults and select **Start DocumentDB Local**.
5. When **DocumentDB Local is ready** appears, select **Open Connection**.

The extension generates the credentials, includes sample data, and chooses an available port. The new **DocumentDB Local** connection appears under **Your own DocumentDB**, ready to browse.

The note above **Start DocumentDB Local** also says that the container follows your VS Code telemetry setting. See [Usage telemetry](#usage-telemetry) for what that means.

## Container engine requirement

Setting up DocumentDB Local requires:

- A Docker CLI available to the VS Code extension host, or the Podman CLI when Docker is not available. Docker is preferred whenever both CLIs are available; there is no setting to change this.
- Access from the selected CLI to an engine running Linux containers.
- An x64 or arm64 extension host. DocumentDB Local images are published for those architectures.

Both Docker Engine and Docker Desktop are supported. Docker Desktop is not required when Docker Engine is already available. The extension falls back to Podman only when the Docker CLI is unavailable; it does not switch to Podman just because Docker cannot connect. The extension never installs Docker or Podman, silently starts a provider, runs `sudo`, changes group membership, or switches Docker contexts.

The extension host matters. In a local VS Code window, the container engine and DocumentDB Local run on your machine. In WSL, SSH, a dev container, or Codespaces, they run in that extension-host environment. In remote sessions, `localhost:10260` refers to the extension host, not necessarily your local computer.

The instance tooltip names an engine only when positive evidence identifies it. When evidence identifies a Podman engine reached through the Docker CLI, the tooltip reports **Podman (through the Docker CLI)**. It shows the server version, not the CLI version. Some host error messages use neutral container-engine wording.

The first setup stage heading reads **Checking container engine**, and its detail line still uses the raw CLI version output. Redesigned findings and engine-specific guides have not shipped yet.

The setup view shows pull, create, start, and connection-readiness progress. While pulling, it shows
the known image and custom or reused origin, plus the latest engine-output line when available.
This line reports activity, not a completion estimate. Container-engine command output is also
written to the **DocumentDB Local Setup** output channel.

Select **Details** on a completed or failed setup stage to see the facts available for that stage.
Details start collapsed and remain available on the success screen; each row with Details has a
short factual summary. Checking shows which Docker and Podman executables are on PATH, without
probing the unselected engine. For shortened image or container IDs, hover or focus the ID to see
the full value. An updated image also shows its previous ID when already available. Failure
explanations and recovery actions stay visible below the stages.

## Port

The **Configure** step pre-fills the **Address** with a host port that is free at that moment, starting at `10260` and moving forward if that port is taken. You can change it, and the value is checked while you are still on the step.

Setup then uses exactly that port. It never moves the instance to a different port after you select **Start DocumentDB Local**. If the port is taken by the time the container is created, setup stops with an explanation so you can go back and choose another one.

## Usage telemetry

Starting with release 1.0-rc2, the DocumentDB Local image sends a small amount of anonymous usage data to the DocumentDB project. It helps the project see which releases and platforms are in use. The [DocumentDB Local privacy statement](https://github.com/documentdb/documentdb/blob/main/documentdb-local/PRIVACY.md) describes it in full. In short:

- **What is sent:** the image's release version, the operating system, the CPU architecture, and a fixed event name. Nothing else.
- **What is never sent:** your documents, queries, database or collection names, user names, or credentials.
- **When:** once when the container starts, then once an hour while it keeps running.
- **Where:** to [Scarf](https://scarf.sh), the analytics service the DocumentDB project uses. As with any web request, Scarf also sees the network address the request comes from.

This is separate from the extension's own telemetry, which VS Code controls in the usual way.

### Which VS Code setting does what

The extension doesn't ask you a second time. When it creates the container, it applies the telemetry level you already chose in VS Code (`telemetry.telemetryLevel`):

| VS Code telemetry level     | What the DocumentDB Local container does |
| --------------------------- | ---------------------------------------- |
| `all` (the VS Code default) | Sends the usage data described above.    |
| `error`                     | Sends nothing.                           |
| `crash`                     | Sends nothing.                           |
| `off`                       | Sends nothing.                           |

For every level except `all`, setup creates the container with `DOCUMENTDB_USAGE_TELEMETRY=false`, the image's own off switch. The same applies when telemetry is turned off by an organization policy or by starting VS Code with `--disable-telemetry`. See [Telemetry in VS Code](https://code.visualstudio.com/docs/configure/telemetry) for how to change the level.

### When a change takes effect

The setting is read once, when the container is created. **Stop**, **Start**, and **Restart** keep the container as it is, so changing the VS Code level later doesn't change an existing container.

To apply a new level and keep your data:

1. Remove only the container. Its data volume stays:

   ```bash
   docker rm -f vscode-documentdb-local
   ```

2. In the **Connections** view, expand the **DocumentDB Local** instance and select **Recreate container**. If the row doesn't appear yet, refresh the view.
3. In the setup view, select **Continue**, then **Start DocumentDB Local**. The extension creates a new container on the same data volume, with the same credentials and image, using your current telemetry level.

**Delete Container…** in the extension removes the data volume too, so use it only when you want to start over.

To check what a running container does, run:

```bash
docker exec vscode-documentdb-local printenv DOCUMENTDB_USAGE_TELEMETRY
```

It prints `false` when usage telemetry is turned off. It prints nothing when the image's default (on) applies.

Images older than 1.0-rc2, which you can pick with the image-tag setting on the **Configure** step, send no usage data and ignore this setting.

## Container engine is not ready

Readiness checks identify the selected CLI and, where positive evidence permits, the engine and platform. Use **View setup log** for command details. Use **Refresh** to discard cached and remembered provider facts and run every check again.

### Container engine CLI not found

Install [Docker Engine](https://docs.docker.com/engine/install/), Docker Desktop, or [Podman](https://podman.io/docs/installation), then open **Set up DocumentDB Local** again. The extension uses `docker` when it is on `PATH` and falls back to `podman` only when Docker is unavailable. If Docker works in a terminal but not in VS Code, confirm that the extension host inherited the same `PATH`, `DOCKER_HOST`, and `DOCKER_CONTEXT` configuration.

### Linux or WSL socket access denied

The card may offer this fixed command as copy-only text:

```bash
sudo usermod -aG docker $USER
```

The extension never runs the command. Group changes apply only to new login sessions:

- **Native Linux:** Sign out of the desktop session and sign back in. Reloading the VS Code window is not enough.
- **WSL:** Run `wsl --shutdown` in a Windows terminal, then reopen the folder in WSL. This stops all running WSL distributions.
- **Remote SSH:** Run **Remote-SSH: Kill VS Code Server on Host**, then reconnect.
- **Dev container or Codespaces:** Rebuild the container.

See [Linux post-installation steps for Docker Engine](https://docs.docker.com/engine/install/linux-postinstall/) for details and security considerations.

### Native Docker Engine is stopped

Start the system service outside the extension, then select **Retry** or **Refresh**. Depending on the Linux environment, the card may offer one of these commands as copy-only text:

```bash
sudo systemctl start docker
```

```bash
sudo service docker start
```

Only a positively identified rootless Docker Engine user service can receive an automatic **Start Docker** action. The extension never starts a root-managed service or elevates privileges.

### Docker Desktop and WSL integration

When setup positively identifies Docker Desktop, it may offer **Start Docker Desktop**. In WSL, the Windows application being installed is not enough to identify the active provider because native Docker Engine can coexist with Docker Desktop.

If Docker Desktop is running but unavailable in a WSL distribution:

1. Open Docker Desktop settings.
2. Open **Resources > WSL Integration**.
3. Enable integration for the distribution where VS Code is running.
4. Reopen the WSL folder, open **Set up DocumentDB Local**, and select **Refresh**.

See [Docker Desktop WSL integration](https://docs.docker.com/desktop/features/wsl/).

### Podman machine is not running

On macOS and Windows, Podman uses a machine. The extension does not initialize or start that machine, and there is currently no **Start Podman machine** button. If no machine exists, run `podman machine init` in a terminal; then run `podman machine start`. If a machine already exists but is stopped, run `podman machine start`. Afterward, return to setup and select **Refresh**.

### Context or remote endpoint unavailable

Setup respects `DOCKER_HOST`, `DOCKER_CONTEXT`, the current Docker context, and then the platform default endpoint, in that order. It never changes the selected context.

- Repair or select a valid context using the [Docker context guide](https://docs.docker.com/engine/manage-resources/contexts/).
- For `tcp://` or `ssh://` endpoints, make sure the endpoint is reachable from the extension host.
- In SSH, dev-container, and Codespaces sessions, install and configure Docker in the remote environment. Setup does not launch an application on your local machine.

### Linux containers required

DocumentDB Local requires a Linux-container Docker daemon. If a reachable Windows daemon reports Windows-container mode, switch Docker to Linux containers and select **Retry**.

## Recovery during setup

If the selected container engine becomes unavailable during image pull or container creation, setup returns to its recovery stage. Registry, proxy, image-manifest, and other image-specific failures remain setup errors and are not presented as engine diagnoses.

If a dev-container setup creates the container but times out waiting for DocumentDB, the container engine may be running on the dev-container host. A published `localhost` port is not always reachable from inside the dev container. Use **View setup log** and verify port reachability in the extension-host environment.
