# DocumentDB for VS Code

<!-- region exclude-from-marketplace -->

[![CI](https://github.com/microsoft/vscode-documentdb/actions/workflows/main.yml/badge.svg)](https://github.com/microsoft/vscode-documentdb/actions/workflows/main.yml)
[![License: MIT](https://img.shields.io/github/license/microsoft/vscode-documentdb)](LICENSE.md)
[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/ms-azuretools.vscode-documentdb?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb)

<img src="resources/readme/documentdb-logo.png" alt="DocumentDB Logo" style="width:40%; min-width:180px; max-width:320px; height:auto;" />

> **Built in the open, with you.** DocumentDB for VS Code is open source under the MIT license. The roadmap, the design discussions and every change happen right here on GitHub.
>
> - ⬇️ **Install it** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb), or search for "DocumentDB" in the VS Code Extensions view
> - 🐞 **Found a bug or missing a feature?** [Open an issue](https://github.com/microsoft/vscode-documentdb/issues/new)
> - 💡 **Want to help?** Pick an [open issue](https://github.com/microsoft/vscode-documentdb/issues), read the [contributing guide](./CONTRIBUTING.md) and send a pull request
> - ⭐ **Like it?** Star the repository, it helps others find the project
> - 📰 **What's new:** [release notes](https://microsoft.github.io/vscode-documentdb/release-notes/1.0)

<!-- endregion exclude-from-marketplace -->

**The free, open-source DocumentDB GUI and MongoDB GUI for VS Code.**

Connect to your databases, explore your data, run and tune queries, and move collections around, all without leaving your editor. One extension for all three:

| **Azure DocumentDB**                                                                   | **DocumentDB**                                                                                       | **MongoDB**                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Azure DocumentDB and Azure Cosmos DB for MongoDB (RU), with Microsoft Entra ID sign-in | The open-source [DocumentDB](https://documentdb.io) engine: on your laptop, on a VM or in Kubernetes | MongoDB Atlas, self-hosted MongoDB, and any other database that speaks the MongoDB API |

🎉 **Version 1.0 is here**, released alongside DocumentDB 1.0. See [what's in 1.0](https://microsoft.github.io/vscode-documentdb/release-notes/1.0).

<p align="center"><img src="resources/readme/vscode-documentdb-hero-screenshot.png" alt="DocumentDB for VS Code: the Collection View with a query, autocompletion and results in a table" width="800" style="max-width:100%;height:auto;"></p>

## Connect in Seconds, Wherever Your Data Lives

- **No database yet?** Select **Set up DocumentDB Local** and the extension starts [DocumentDB](https://documentdb.io) in Docker for you, with a persistent volume, generated credentials and optional sample data. No `docker run` command to assemble. [Learn more](https://microsoft.github.io/vscode-documentdb/user-manual/local-quick-start)
- **On Azure?** Browse your Azure DocumentDB clusters and Azure Cosmos DB for MongoDB (RU) accounts across accounts, tenants and subscriptions, and sign in with **Microsoft Entra ID** or a managed identity. They also show up in the Azure Resources view. [Learn more](https://microsoft.github.io/vscode-documentdb/user-manual/service-discovery)
- **On MongoDB Atlas?** Sign in with an Atlas service account or API key and pick a cluster from your organizations and projects instead of copying endpoints. [Learn more](https://microsoft.github.io/vscode-documentdb/user-manual/service-discovery-mongodb-atlas)
- **In Kubernetes?** DocumentDB clusters on AKS, EKS, GKE, kind, minikube or Docker Desktop are found from your kubeconfig, and port forwarding is handled for you. [Learn more](https://microsoft.github.io/vscode-documentdb/user-manual/service-discovery-kubernetes)
- **Anything else?** Paste a connection string. Keep all your connections organized in folders.

## See What You Have

The first question on any cluster is "what's in here?" The **Cluster Dashboard** answers it on one page: whether you're connected, the round-trip time, and an inventory of every database and collection with its storage size, index size and document count. Sort and filter the list, drill into a database, or create and delete databases and collections right there.

<p align="center"><img src="resources/readme/cluster-dashboard.png" alt="Cluster Dashboard with connection status, storage and document metrics, and a filterable database inventory" width="800" style="max-width:100%;height:auto;"></p>

## Query Your Data, Your Way

Three connected ways to work with the same query, and one click moves it between them. All three know your data's schema, so field names, operators and values are suggested as you type.

- **Collection View** (shown at the top): build a query with filter, project and sort editors, and browse results as a **Table**, a **Tree** or **JSON**. Create, edit and delete documents in place.
- **Interactive Shell**: `show dbs`, `use <db>`, persistent variables, syntax highlighting and tab completion with ghost text, right in a VS Code terminal.
- **Query Playground**: write JavaScript in `.documentdb.js` files and run each block with its own **Run** button. Keep the queries you want to reuse next to your code.

<p align="center"><img src="resources/readme/interactive-shell.png" alt="Interactive Shell with syntax highlighting and tab completion" width="800" style="max-width:100%;height:auto;"></p>

Nothing to install: the shell and query runtime are bundled with the extension, reuse your connection (including Entra ID sign-in), and work the same on Windows, macOS and Linux.

## Find Out Why a Query Is Slow, and Fix It

Whether you wrote a query yourself or an AI agent suggested it, you want to know how it runs. **Query Insights** explains it in three steps: the query plan, then execution statistics with a simple Good, Fair or Poor rating, and then optional AI recommendations from GitHub Copilot that explain what's happening and suggest changes you can apply directly.

<p align="center"><img src="resources/readme/query-insights.png" alt="Query Insights streaming an AI summary and index recommendations" width="800" style="max-width:100%;height:auto;"></p>

**Index management** sits right next to it, so understanding a query and fixing it happen in the same place. See which indexes are used and which are not, create standard, wildcard and vector indexes with a guided form, and **hide** an index to check the impact before you delete it.

<p align="center"><img src="resources/readme/index-management.png" alt="Indexes tab with index count, size and usage metrics above a filterable table of indexes and their actions" width="800" style="max-width:100%;height:auto;"></p>

> AI recommendations require the [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) extension. The extension sends the query shape and execution statistics, not your documents.

## Bring Your Data With You

Copy a collection the way you copy files: right-click it and select **Copy Collection…**, then right-click a database on the same cluster or any other and select **Paste Collection…**. A collection from MongoDB Atlas, Azure or a shared development cluster can land in your DocumentDB Local instance in a few clicks. If the target already has documents, you decide what happens with duplicates, and the indexes can come along too.

<p align="center"><img src="resources/readme/copy-and-paste.png" alt="Copy and paste in three steps: copy the source collection, paste it into the target, and choose how to handle conflicts" width="800" style="max-width:100%;height:auto;"></p>

Copy and paste is built for development and small to medium datasets. For large production migrations, use a dedicated migration service. You can also **import** JSON files and **export** documents, query results or entire collections.

## Open Source and Extensible

Everything happens in the open on [GitHub](https://github.com/microsoft/vscode-documentdb): the roadmap, the discussions and every change. Your bug reports, ideas and pull requests shape the extension. Other extensions can plug in as **Service Discovery** providers for more clouds, or as **data migration** providers.

# Prerequisites

No external tools or runtimes are required. Install the extension and start working. Only DocumentDB Local needs Docker (Docker Engine or Docker Desktop).

<!-- region exclude-from-marketplace -->

#### References

- [DocumentDB](https://github.com/microsoft/documentdb)
- [Documentation](https://microsoft.github.io/vscode-documentdb/)

# How to Contribute

To contribute, see these documents:

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## Legal

Before we can accept your pull request, you will need to sign a **Contribution License Agreement**. All you need to do is to submit a pull request, then the PR will get appropriately labeled (e.g. `cla-required`, `cla-norequired`, `cla-signed`, `cla-already-signed`). If you already signed the agreement, we will continue with reviewing the PR, otherwise the system will tell you how you can sign the CLA. Once you sign the CLA, all future PRs will be labeled as `cla-signed`.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information, see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must follow Microsoft's Trademark & Brand Guidelines. Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party's policies.

<!-- endregion exclude-from-marketplace -->

# Telemetry

VS Code collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](https://go.microsoft.com/fwlink/?LinkId=521839) to learn more. If you don't wish to send usage data to Microsoft, you can set the `telemetry.telemetryLevel` setting to `off`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).

# Feedback Collection

DocumentDB for VS Code proactively asks for user feedback and provides feedback entry points in the UI. Feedback collection is controlled by VS Code's global telemetry setting.

To disable feedback, set `telemetry.telemetryLevel` to a value other than `all` (e.g., `error` or `off`). Feedback is only active when the level is set to `all`.

# License

[MIT](LICENSE.md)
