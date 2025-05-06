# DocumentDB for VS Code (Preview)

<!-- region exclude-from-marketplace -->

[![Version](https://img.shields.io/visual-studio-marketplace/v/ms-azuretools.vscode-documentdb.svg)](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb)

<!-- endregion exclude-from-marketplace -->

**A powerful, open-source DocumentDB and MongoDB GUI for everyone.**

**DocumentDB for VS Code** helps you browse, manage, and query **DocumentDB** and **MongoDB** API databases across any cloud, hybrid, or local environment.

![DocumentDB with a Collection View and auto-completion](resources/readme/vscode-cosmosdb-vcore.png)

# Features

### Universal DocumentDB and MongoDB Support

Connect to any MongoDB or DocumentDB instance: cloud, hybrid cloud, on-premises, or a local machine.

- **Flexible Connections:** Use a connection string or browse your cloud providers.

- **Cross-Platform Service Discovery:** Connect to DocumentDB and MongoDB instances hosted with your provider.

- **Wide Compatibility:** Full support for all DocumentDB and MongoDB API databases.

### Developer-Centric Experience

DocumentDB for VS Code focuses on providing developer productivity features with minimal setup.

- **Multiple Data Views**: Inspect collections using **Table**, **Tree**, or **JSON** layouts, with built-in pagination.

- **Query Editing**: Execute `find` queries with syntax highlighting, auto-completion, and field name suggestions.

- **Document Management**: Create, edit, and delete documents directly from VS Code.

- **Data Import/Export**: Quickly import JSON files or export documents, query results, or collections.

### Open Development

We believe in building in the open. All development, roadmap planning, and feature discussions happen publicly on GitHub.
Your feedback, contributions, and ideas shape the future of the extension.

# Prerequisites

- **Mongo Shell Requirement (Optional)**: Some advanced commands in the Mongo [scrapbook](#mongo-scrapbooks), as well as use of the MongoDB shell, require installing [MongoDB shell](https://docs.mongodb.com/manual/installation/).

## Known Issues

Here are some known issues and limitations to be aware of when using the DocumentDB VS Code extension:

- **Escaped Characters in Scrapbooks**: Scrapbook support for escaped characters is preliminary. Use double escaping for newlines (`\\n` instead of `\n`).

<!-- region exclude-from-marketplace -->

#### References

- [DocumentDB](https://github.com/microsoft/documentdb)


# How to Contribute

To contribute, see these documents:

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## Legal

Before we can accept your pull request, you will need to sign a **Contribution License Agreement**. All you need to do is to submit a pull request, then the PR will get appropriately labeled (e.g. `cla-required`, `cla-norequired`, `cla-signed`, `cla-already-signed`). If you already signed the agreement, we will continue with reviewing the PR, otherwise the system will tell you how you can sign the CLA. Once you sign the CLA, all future PRs will be labeled as `cla-signed`.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information, see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

<!-- endregion exclude-from-marketplace -->

# Telemetry

VS Code collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](https://go.microsoft.com/fwlink/?LinkID=528096&clcid=0x409) to learn more. If you don’t wish to send usage data to Microsoft, you can set the `telemetry.enableTelemetry` setting to `false`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).

# License

[MIT](LICENSE.md)
