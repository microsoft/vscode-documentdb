---
title: 'Connect to DocumentDB Local'
parent: 'Local Instances'
nav_order: 3
---

# DocumentDB Local

The **DocumentDB Local** option helps you work with a local DocumentDB instance for development, prototyping, and testing.

Use [Set up DocumentDB Local](./local-quick-start) when you want the extension to create and manage the official container. The setup supports Docker (Docker Engine or Docker Desktop) and Podman. It requires a Docker or Podman CLI that the VS Code extension host can use to reach an engine running Linux containers. Choose your preferred engine on the **Configure** step.

Use the manual connection flow when DocumentDB Local is already running and you only need to save its connection details. This flow does not require either CLI and does not make the extension manage the existing container.

## How to Use

- Ensure you have a DocumentDB instance reachable from the VS Code extension host.
- In the DocumentDB extension for Visual Studio Code, select the **DocumentDB Local** option from the local connection area.
- The extension will guide you through the connection process, allowing you to specify connection details and adjust security settings as needed.
