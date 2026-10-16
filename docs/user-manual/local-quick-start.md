---
title: 'Set up DocumentDB Local'
parent: 'Local Instances'
nav_order: 1
---

# Set up DocumentDB Local

Set up and manage a DocumentDB Local container from the Connections view. The extension pulls the official image, creates a persistent Docker volume, waits for DocumentDB to accept connections, and saves the connection in VS Code.

[DocumentDB](https://documentdb.io/) is an open-source, fully MongoDB-compatible database for modern application development. DocumentDB Local lets you run it in a Docker container for development and testing.

## Happy path

With Docker running, setup takes only a few clicks:

1. Open the **Connections** view.
2. Expand **Your own DocumentDB**, then select **Set up DocumentDB Local**.
3. On the **Introduction** step, select **Continue**.
4. On the **Configure** step, keep the defaults and select **Start DocumentDB Local**.
5. When **DocumentDB Local is ready** appears, select **Open Connection**.

The extension generates the credentials, includes sample data, and chooses an available port. The new **DocumentDB Local** connection appears under **Your own DocumentDB**, ready to browse.

The note above **Start DocumentDB Local** also says that the container follows your VS Code telemetry setting. See [Usage telemetry](#usage-telemetry) for what that means.

## Docker requirement

Setting up DocumentDB Local requires:

- A Docker CLI available to the VS Code extension host.
- Access from that CLI to a Docker daemon running Linux containers.
- An x64 or arm64 extension host. DocumentDB Local images are published for those architectures.

Both Docker Engine and Docker Desktop are supported. Docker Desktop is not required when Docker Engine is already available. The extension never installs Docker, silently starts a provider, runs `sudo`, changes group membership, or switches Docker contexts.

The extension host matters. In a local VS Code window, Docker and DocumentDB Local run on your machine. In WSL, SSH, a dev container, or Codespaces, they run in that extension-host environment. In remote sessions, `localhost:10260` refers to the extension host, not necessarily your local computer.

The setup view shows pull, create, start, and connection-readiness progress. Docker command output is written to the **DocumentDB Local Setup** output channel.

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

## Docker is not ready

The readiness screen separates Docker CLI, daemon, and daemon-platform facts. Use **View Docker output** for command details. Use **Refresh** to discard cached and remembered provider facts and run every check again.

### Docker CLI not found

Install [Docker Engine](https://docs.docker.com/engine/install/) or Docker Desktop, then open **Set up DocumentDB Local** again. If Docker works in a terminal but not in VS Code, confirm that the extension host inherited the same `PATH`, `DOCKER_HOST`, and `DOCKER_CONTEXT` configuration.

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

### Context or remote endpoint unavailable

Setup respects `DOCKER_HOST`, `DOCKER_CONTEXT`, the current Docker context, and then the platform default endpoint, in that order. It never changes the selected context.

- Repair or select a valid context using the [Docker context guide](https://docs.docker.com/engine/manage-resources/contexts/).
- For `tcp://` or `ssh://` endpoints, make sure the endpoint is reachable from the extension host.
- In SSH, dev-container, and Codespaces sessions, install and configure Docker in the remote environment. Setup does not launch an application on your local machine.

### Linux containers required

DocumentDB Local requires a Linux-container Docker daemon. If a reachable Windows daemon reports Windows-container mode, switch Docker to Linux containers and select **Retry**.

## Recovery during setup

If Docker becomes unavailable during image pull or container creation, setup returns to the same Docker recovery screen. Registry, proxy, image-manifest, and other image-specific failures remain setup errors and are not presented as daemon diagnoses.

If a dev-container setup creates the container but times out waiting for DocumentDB, Docker may be running on the dev-container host. A published `localhost` port is not always reachable from inside the dev container. Use **View Docker output** and verify port reachability in the extension-host environment.
