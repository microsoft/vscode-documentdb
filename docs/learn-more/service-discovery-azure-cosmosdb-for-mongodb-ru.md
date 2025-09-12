<!-- filepath: /home/tomek/github/ms/vscode-documentdb/docs/learn-more/service-discovery-azure-cosmosdb-for-mongodb-ru.md -->
<!-- Learn More Section Badge or Breadcrumb -->

> **Learn More** &mdash; [Back to Learn More Index](./index)

---

# Azure CosmosDB for MongoDB (RU) Service Discovery Plugin

The **Azure CosmosDB for MongoDB (RU)** plugin is available as part of the [Service Discovery](./service-discovery) feature in DocumentDB for VS Code. This plugin helps you find and connect to Azure Cosmos DB accounts provisioned with Request Units (RU) for the MongoDB API by handling authentication, resource discovery, and connection creation from inside the extension.

## How to Access

You can access this plugin in two ways:

- From the `Service Discovery` panel in the extension sidebar.
- When adding a new connection, select the `Azure CosmosDB for MongoDB (RU)` option.

![Service Discovery Activation](./images/service-discovery-activation.png)

## How It Works

When you use the Azure CosmosDB for MongoDB (RU) plugin, the extension performs the following steps:

1. **Authentication:**
   The plugin uses your Azure credentials available in VS Code. If needed, it will prompt you to sign in via the standard Azure sign-in flows.

2. **Subscription Discovery:**
   The plugin lists subscriptions available to your account so you can pick where to search for resources.

3. **Account Discovery:**
   The provider queries Azure using the CosmosDB Management Client and filters results by the MongoDB "kind" for RU-based accounts. This ensures the list contains accounts that support the MongoDB API under RU provisioning.

4. **Connection Options:**
   - Expand an account entry to view databases and connection options.
   - Save an account to your `DocumentDB Connections` list using the context menu or the save icon next to its name.
   - When connecting or saving, the extension will extract credentials or connection details from Azure where available. If multiple authentication methods are supported, you will be prompted to choose one.

## Additional Notes

- You can filter subscriptions in the Service Discovery panel to limit the scope of discovery if you have access to many subscriptions.
- The provider reuses shared authentication and subscription selection flows used across other Service Discovery plugins.
- If you save a discovered account, the saved connection will appear in your Connections view for later use.

## Feedback and Contributions

If you have suggestions for improving this provider or would like to add support for additional resource types, please [join the discussion board](https://github.com/microsoft/vscode-documentdb/discussions) and share your feedback.

---
