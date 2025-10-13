> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Azure VMs (DocumentDB) Service Discovery Plugin

The **Azure VMs (DocumentDB)** plugin is available as part of the [Service Discovery](./service-discovery) feature in DocumentDB for VS Code. This plugin helps you locate and connect to your virtual machines hosted in Azure that are running self-hosted DocumentDB or MongoDB instances.

> **📘 Managing Azure Resources**: This provider shares common Azure management features with other Azure-based providers. See [Managing Azure Discovery (Accounts, Tenants, and Subscriptions)](./managing-azure-discovery) for detailed information about:
>
> - Managing Azure accounts and credentials
> - Filtering by tenants and subscriptions
> - Troubleshooting common issues

## How to Access

You can access this plugin in two ways:

- Through the `Service Discovery` panel in the extension sidebar.
- When adding a new connection, select the `Azure VMs (DocumentDB)` option.

![Service Discovery Activation](./images/service-discovery-activation-vm.png)

## How It Works

When you use the Azure VMs (DocumentDB) plugin, the following steps are performed:

1. **Authentication:**
   The plugin authenticates you with Azure using your credentials. See [Managing Azure Accounts](./managing-azure-discovery#managing-azure-accounts) for details on managing your Azure accounts.

2. **Resource Filtering (Service Discovery Panel):**
   When accessing this plugin from the Service Discovery panel, you can control which resources are displayed by filtering tenants and subscriptions. Click the funnel icon next to the provider name to configure filters. See [Filtering Azure Resources](./managing-azure-discovery#filtering-azure-resources) for more information.

3. **Subscription Discovery:**
   - **From Service Discovery Panel**: The plugin lists subscriptions based on your configured filters, allowing you to browse VMs within selected subscriptions.
   - **From Add New Connection Wizard**: All subscriptions from all tenants are shown without pre-filtering. You select one subscription to view its resources.

4. **VM Filtering by Tag:**
   The plugin searches for virtual machines within your selected subscriptions that have a specific tag assigned.
   - **Default Tag**: By default, the tag is set to `DocumentDB`
   - **Custom Tags**: When using Service Discovery from within the `DocumentDB Connections` area (via "Add New Connection"), you'll be prompted to confirm or change the tag used for filtering
   - **Service Discovery Panel**: The Service Discovery panel works with the default `DocumentDB` tag, but you can change this using the filter feature

   > **💡 Tip**: To use this plugin effectively, ensure your Azure VMs running DocumentDB or MongoDB instances are tagged appropriately. You can add or modify tags in the Azure Portal under the VM's "Tags" section.

5. **Connection Options:**
   - You can connect to a VM by expanding its entry in the tree view.
   - You can save a VM to your `DocumentDB Connections` list using the context menu or by clicking the save icon next to its name.
   - When connecting, you'll be prompted to provide connection details for the DocumentDB/MongoDB instance running on the VM.

For an overview of how service discovery works, see the [Service Discovery](./service-discovery) documentation. For details on managing your Azure accounts and subscriptions, refer to the [Managing Azure Subscriptions](./managing-azure-discovery) guide.

## Managing Credentials and Filters

This provider supports the following management features:

- **Manage Credentials**: View and manage Azure accounts used for service discovery. Right-click the provider or click the gear icon.
- **Filter Resources**: Control which tenants and subscriptions are displayed, and customize the VM tag filter. Click the funnel icon next to the provider name.
- **Refresh**: Reload the resource list after making changes. Click the refresh icon.

For detailed instructions on account and subscription management, see [Managing Azure Discovery (Accounts, Tenants, and Subscriptions)](./managing-azure-discovery).

### VM-Specific Filtering

In addition to the standard tenant and subscription filtering, the Azure VMs provider includes tag-based filtering:

```
Filter Flow for Azure VMs:

Step 1: Select Tenants (if multi-tenant)
Step 2: Select Subscriptions
Step 3: Configure VM Tag Filter
┌────────────────────────────────────────────┐
│ Enter the tag name to filter VMs          │
├────────────────────────────────────────────┤
│ DocumentDB                                 │  ← Default value
└────────────────────────────────────────────┘
```

The tag filter is also persisted and will be pre-filled with your last selection when you reopen the filter wizard.

## Feedback and Contributions

If you have suggestions for improving this plugin or would like to see support for additional VM filtering options, please [join the discussion board](https://github.com/microsoft/vscode-documentdb/discussions) and share your feedback.

---
