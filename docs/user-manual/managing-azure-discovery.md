> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Managing Azure Discovery (Accounts, Tenants, and Subscriptions)

When using Azure-based service discovery providers in DocumentDB for VS Code, you have access to shared features for managing your Azure credentials and filtering which resources are displayed. These features are consistent across all Azure service discovery providers:

- [Azure Cosmos DB for MongoDB (RU)](./service-discovery-azure-cosmosdb-for-mongodb-ru)
- [Azure Cosmos DB for MongoDB (vCore)](./service-discovery-azure-cosmosdb-for-mongodb-vcore)
- [Azure VMs (DocumentDB)](./service-discovery-azure-vms)

For a general overview of service discovery, see the [Service Discovery](./service-discovery) documentation.

---

## Managing Azure Accounts

The **Manage Credentials** feature allows you to view and manage which Azure accounts are being used for service discovery within the extension.

### How to Access

You can access the credential management feature in two ways:

1. **From the context menu**: Right-click on an Azure service discovery provider and select `Manage Credentials...`
2. **From the Service Discovery panel**: Click the `key icon` next to the service discovery provider name

### Available Actions

When you open the credential management wizard, you can:

1. **View signed-in accounts**: See all Azure accounts currently authenticated in VS Code and available for service discovery
2. **Sign in with a different account**: Add additional Azure accounts for accessing more resources
3. **View active account details**: See which account is currently being used for a specific service discovery provider
4. **Exit without changes**: Close the wizard without making modifications

### Account Selection

```
┌────────────────────────────────────────────┐
│ Azure accounts used for service discovery  │
├────────────────────────────────────────────┤
│ 👤 user1@contoso.com                       │
│ 👤 user2@fabrikam.com                      │
├────────────────────────────────────────────┤
│ 🔐 Sign in with a different account…       │
│ ✖️  Exit without making changes            │
└────────────────────────────────────────────┘
```

### Signing Out from an Azure Account

The credential management wizard does **not** provide a sign-out option. If you need to sign out from an Azure account:

1. Click on the **"Accounts"** icon in the VS Code Activity Bar (bottom left corner)
2. Select the account you want to sign out from
3. Choose **"Sign Out"**

> **⚠️ Important**: Signing out from an Azure account in VS Code will sign you out globally across VS Code, not just from the DocumentDB for VS Code extension. This may affect other extensions that use the same Azure account.

---

## Filtering Azure Resources

The **Filter** feature allows you to control which Azure resources are displayed in the Service Discovery panel by selecting specific tenants and subscriptions.

### How to Access

You can access the filtering feature by clicking the **funnel icon** next to the service discovery provider name in the Service Discovery panel.

### Filtering Flow

The filtering wizard guides you through selecting which Azure resources to display:

#### Single-Tenant Scenario

If you have access to only one Azure tenant, the wizard will skip tenant selection and proceed directly to subscription filtering:

```
┌────────────────────────────────────────────┐
│ Select subscriptions to include in         │
│ service discovery                          │
├────────────────────────────────────────────┤
│ ☑️ Production Subscription                 │
│   (sub-id-123) (Contoso)                   │
│ ☑️ Development Subscription                │
│   (sub-id-456) (Contoso)                   │
│ ☐ Test Subscription                        │
│   (sub-id-789) (Contoso)                   │
└────────────────────────────────────────────┘
```

#### Multi-Tenant Scenario

If you have access to multiple Azure tenants, the wizard will first ask you to select tenants, then filter subscriptions based on your tenant selection:

```
Step 1: Select Tenants
┌────────────────────────────────────────────┐
│ Select tenants to include in subscription  │
│ discovery                                  │
├────────────────────────────────────────────┤
│ ☑️ Contoso                                 │
│   (tenant-id-123) contoso.onmicrosoft.com  │
│ ☑️ Fabrikam                                │
│   (tenant-id-456) fabrikam.onmicrosoft.com │
│ ☐ Adventure Works                          │
│   (tenant-id-789) adventureworks.com       │
└────────────────────────────────────────────┘

Step 2: Select Subscriptions (filtered by selected tenants)
┌────────────────────────────────────────────┐
│ Select subscriptions to include in         │
│ service discovery                          │
├────────────────────────────────────────────┤
│ ☑️ Contoso Production                      │
│   (sub-id-123) (Contoso)                   │
│ ☑️ Contoso Development                     │
│   (sub-id-456) (Contoso)                   │
│ ☑️ Fabrikam Production                     │
│   (sub-id-789) (Fabrikam)                  │
└────────────────────────────────────────────┘
```

### Filter Persistence

Your filtering selections are **automatically saved and persisted** across VS Code sessions. When you reopen the filtering wizard, your previous selections will be pre-selected, making it easy to adjust your filters incrementally.

### How Filtering Works in Different Contexts

The filtering behavior differs depending on how you access service discovery:

#### From the Service Discovery Panel

When working within the **Service Discovery** panel in the sidebar:

- Your filter selections (tenants and subscriptions) are **applied automatically**
- Only resources from selected tenants and subscriptions are displayed
- The filter persists until you change it

#### From the "Add New Connection" Wizard

When adding a new connection via the **"Add New Connection"** wizard:

- **No filtering is applied** by default
- You will see **all subscriptions from all tenants** you have access to
- You must select one subscription to continue, but the full list is available
- This ensures you can always access any resource when explicitly adding a connection

## Related Documentation

- [Service Discovery Overview](./service-discovery)
- [Azure CosmosDB for MongoDB (RU) Service Discovery](./service-discovery-azure-cosmosdb-for-mongodb-ru)
- [Azure CosmosDB for MongoDB (vCore) Service Discovery](./service-discovery-azure-cosmosdb-for-mongodb-vcore)
- [Azure VMs (DocumentDB) Service Discovery](./service-discovery-azure-vms)
