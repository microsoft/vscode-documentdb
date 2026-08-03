> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# DocumentDB Local Quick Start

Quick Start creates and manages a DocumentDB Local container from the Connections view. It pulls the official image, creates a persistent Docker volume, waits for DocumentDB to accept connections, and saves the connection in VS Code.

## Docker requirement

Quick Start requires:

- A Docker CLI available to the VS Code extension host.
- Access from that CLI to a Docker daemon running Linux containers.

Both Docker Engine and Docker Desktop are supported. Docker Desktop is not required when Docker Engine is already available. The extension never installs Docker, silently starts a provider, runs `sudo`, changes group membership, or switches Docker contexts.

The extension host matters. In a local VS Code window, Docker and DocumentDB Local run on your machine. In WSL, SSH, a dev container, or Codespaces, they run in that extension-host environment. The Review screen shows the target before setup. In remote sessions, `localhost:10260` refers to the extension host, not necessarily your local computer.

## Start Quick Start

1. Open the **Connections** view.
2. Under **DocumentDB Local - Quick Start**, select **Quick Start**.
3. Review the Docker, port, platform, data, and security cards.
4. Select **Start DocumentDB Local**.

The setup view shows pull, create, start, and connection-readiness progress. Docker command output is written to the masked **DocumentDB Local Quick Start** output channel.

## Docker is not ready

The readiness screen separates Docker CLI, daemon, and daemon-platform facts. Use **View Docker output** for masked command details. Use **Refresh** to discard cached and remembered provider facts and run every check again.

### Docker CLI not found

Install [Docker Engine](https://docs.docker.com/engine/install/) or Docker Desktop, then reopen Quick Start. If Docker works in a terminal but not in VS Code, confirm that the extension host inherited the same `PATH`, `DOCKER_HOST`, and `DOCKER_CONTEXT` configuration.

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

Only a positively identified rootless Docker Engine user service can receive an automatic **Start Docker** action. Quick Start never starts a root-managed service or elevates privileges.

### Docker Desktop and WSL integration

When Quick Start positively identifies Docker Desktop, it may offer **Start Docker Desktop**. In WSL, the Windows application being installed is not enough to identify the active provider because native Docker Engine can coexist with Docker Desktop.

If Docker Desktop is running but unavailable in a WSL distribution:

1. Open Docker Desktop settings.
2. Open **Resources > WSL Integration**.
3. Enable integration for the distribution where VS Code is running.
4. Reopen the WSL folder and select **Refresh**.

See [Docker Desktop WSL integration](https://docs.docker.com/desktop/features/wsl/).

### Context or remote endpoint unavailable

Quick Start respects `DOCKER_HOST`, `DOCKER_CONTEXT`, the current Docker context, and then the platform default endpoint, in that order. It never changes the selected context.

- Repair or select a valid context using the [Docker context guide](https://docs.docker.com/engine/manage-resources/contexts/).
- For `tcp://` or `ssh://` endpoints, make sure the endpoint is reachable from the extension host.
- In SSH, dev-container, and Codespaces sessions, install and configure Docker in the remote environment. Quick Start does not launch an application on your local machine.

### Linux containers required

DocumentDB Local requires a Linux-container Docker daemon. If a reachable Windows daemon reports Windows-container mode, switch Docker to Linux containers and select **Retry**.

## Recovery during setup

If Docker becomes unavailable during image pull or container creation, Quick Start returns to the same Docker recovery screen. Registry, proxy, image-manifest, and other image-specific failures remain setup errors and are not presented as daemon diagnoses.

If a dev-container setup creates the container but times out waiting for DocumentDB, Docker may be running on the dev-container host. A published `localhost` port is not always reachable from inside the dev container. Use **View Docker output** and verify port reachability in the extension-host environment.
