> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Azure DocumentDB Service Discovery Plugin

The **Azure DocumentDB** plugin is available as part of the [Service Discovery](./service-discovery) feature in DocumentDB for VS Code. This plugin helps you connect to your Azure DocumentDB clusters by handling authentication, resource discovery, and connection management within the extension.

> **📘 Managing Azure Resources**: This provider shares common Azure management features with other Azure-based providers. See [Managing Azure Discovery (Accounts, Tenants, and Subscriptions)](./managing-azure-discovery) for detailed information about:
>
> - Managing Azure accounts and credentials
> - Filtering by tenants and subscriptions
> - Troubleshooting common issues

## How to Access

You can access this plugin in two ways:

- Through the `Service Discovery` panel in the extension sidebar.
- When adding a new connection, select the `Azure DocumentDB` option.

![Service Discovery Activation](./images/service-discovery-activation.png)

## How It Works

When you use the Azure DocumentDB plugin, the following steps are performed:

1. **Authentication:**
   The plugin authenticates you with Azure using your credentials. See [Managing Azure Accounts](./managing-azure-discovery#managing-azure-accounts) for details on managing your Azure accounts.

2. **Resource Filtering (Service Discovery Panel):**
   When accessing this plugin from the Service Discovery panel, you can control which resources are displayed by filtering tenants and subscriptions. Click the funnel icon next to the provider name to configure filters. See [Filtering Azure Resources](./managing-azure-discovery#filtering-azure-resources) for more information.

3. **Subscription and Cluster Discovery:**
   - **From Service Discovery Panel**: The plugin lists subscriptions based on your configured filters, allowing you to browse DocumentDB clusters within selected subscriptions.
   - **From Add New Connection Wizard**: All subscriptions from all tenants are shown without pre-filtering. You select one subscription to view its resources.

4. **Cluster Discovery:**
   The plugin enumerates all Azure DocumentDB clusters available in your selected subscriptions.

5. **Connection Options:**
   - You can connect to a cluster by expanding its entry in the tree view.
   - You can save a cluster to your `DocumentDB Connections` list using the context menu or by clicking the save icon next to its name.
   - When connecting or saving, the extension detects the authentication methods supported by the cluster (e.g., **Username/Password** or **Entra ID**). If multiple are available, you will be prompted to choose your preferred method.

For an overview of how service discovery works, see the [Service Discovery](./service-discovery) documentation. For details on managing your Azure accounts and subscriptions, refer to the [Managing Azure Subscriptions](./managing-azure-discovery) guide.

## Managing Credentials and Filters

This provider supports the following management features:

- **Manage Credentials**: View and manage Azure accounts used for service discovery. Right-click the provider or click the gear icon.
- **Filter Resources**: Control which tenants and subscriptions are displayed. Click the funnel icon next to the provider name.
- **Refresh**: Reload the resource list after making changes. Click the refresh icon.

For detailed instructions on these features, see [Managing Azure Discovery (Accounts, Tenants, and Subscriptions)](./managing-azure-discovery).

## Feedback and Contributions

If you have suggestions for improving this plugin or would like to see support for additional Azure resource types, please [join the discussion board](https://github.com/microsoft/vscode-documentdb/discussions) and share your feedback.

---
