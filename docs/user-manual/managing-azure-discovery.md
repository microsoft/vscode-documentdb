> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Managing Azure Discovery (Accounts, Tenants, and Subscriptions)

When using Azure-based service discovery providers in DocumentDB for VS Code, you have access to shared features for managing your Azure credentials and filtering which resources are displayed. These features are consistent across all Azure service discovery providers:

- [Azure Cosmos DB for MongoDB (RU)](./service-discovery-azure-cosmosdb-for-mongodb-ru)
- [Azure DocumentDB](./service-discovery-azure-cosmosdb-for-mongodb-vcore)
- [Azure VMs (DocumentDB)](./service-discovery-azure-vms)

For a general overview of service discovery, see the [Service Discovery](./service-discovery) documentation.

---

## Managing Azure Accounts and Tenants

The **Manage Credentials** feature allows you to view your Azure accounts, sign in to specific tenants, and add new accounts for service discovery.

### How to Access

You can access the credential management feature in two ways:

1. **From the context menu**: Right-click on an Azure service discovery provider and select `Manage Credentials...`
2. **From the Service Discovery panel**: Click the `key icon` next to the service discovery provider name.

### Account and Tenant Management Flow

The wizard provides options to manage your Azure authentication state.

#### Step 1: Select an Account

First, you'll see a list of all Azure accounts currently authenticated in VS Code. For each account, you can see how many tenants are available and how many you are currently signed in to.

You can:

- Select an existing account to manage its tenants.
- Choose `Sign in with a different account…` to add a new Azure account.

```
┌───────────────────────────────────────────────────────────┐
│ Azure accounts used for service discovery                 │
├───────────────────────────────────────────────────────────┤
│ 👤 user@contoso.com                                       │
│    2 tenants available (1 signed in)                      │
│ 👤 user@fabrikam.com                                      │
│    1 tenant available (1 signed in)                       │
├───────────────────────────────────────────────────────────┤
│ 🔐 Sign in with a different account…                      │
│ ✖️ Exit                                                   │
└───────────────────────────────────────────────────────────┘
```

#### Step 2: Manage Tenants for the Selected Account

After selecting an account, you will see a list of all tenants associated with that account, along with their sign-in status.

```
┌───────────────────────────────────────────────────────────┐
│ Tenants for "user@contoso.com"                            │
├───────────────────────────────────────────────────────────┤
│ Experiments                                               │
│ ✅ Signed in                                              │
│ Production                                                │
│ 🔐 Select to sign in                                      │
├───────────────────────────────────────────────────────────┤
│ ⬅️ Back to account selection                              │
│ ✖️ Exit                                                   │
└───────────────────────────────────────────────────────────┘
```

- **Sign in to a tenant**: Select any tenant marked with `$(sign-in) Select to sign in`. The extension will authenticate you for that specific tenant, making its subscriptions available for discovery.
- **Already signed-in tenants**: Selecting a tenant that is already signed in will simply confirm your status and allow you to return to the list.

### Signing Out from an Azure Account

The credential management wizard does **not** provide a sign-out option. If you need to sign out from an Azure account:

1. Click on the **"Accounts"** icon in the VS Code Activity Bar (bottom left corner)
2. Select the account you want to sign out from
3. Choose **"Sign Out"**

> **⚠️ Important**: Signing out from an Azure account in VS Code will sign you out globally across VS Code, not just from the DocumentDB for VS Code extension. This may affect other extensions that use the same Azure account.

---

## Filtering Azure Resources

The **Filter** feature allows you to control which Azure resources are displayed in the Service Discovery panel by selecting from your **currently signed-in tenants** and their corresponding subscriptions.

### How to Access

You can access the filtering feature by clicking the **funnel icon** next to the service discovery provider name in the Service Discovery panel.

### Filtering Flow

The filtering wizard guides you through selecting which Azure resources to display. The flow adapts based on your Azure environment.

#### Single-Tenant Scenario

If you have access to only one Azure tenant (or are only signed in to one), the wizard will skip tenant selection and proceed directly to subscription filtering:

```
┌───────────────────────────────────────────────────────────┐
│ Select subscriptions to include in service discovery      │
├───────────────────────────────────────────────────────────┤
│ ☑️ Demos (Experiments)                                    │
│   (sub-id-123)                                            │
│ ☑️ TestRuns (Experiments)                                 │
│   (sub-id-456)                                            │
└───────────────────────────────────────────────────────────┘
```

#### Multi-Tenant Scenario

If you have access to multiple Azure tenants, the wizard will first ask you to select tenants, then filter subscriptions based on your tenant selection:

**Step 1: Select Tenants**

The wizard first asks you to select from the tenants you are currently signed in to. Only tenants authenticated via the "Manage Credentials" flow will appear here.

```
┌───────────────────────────────────────────────────────────┐
│ Select tenants (manage accounts to see more)              │
├───────────────────────────────────────────────────────────┤
│ ☑️ Experiments                                            │
│   (tenant-id-123)                                         │
│ ☑️ Production                                             │
│   (tenant-id-456)                                         │
└───────────────────────────────────────────────────────────┘
```

**Step 2: Select Subscriptions**

Next, you'll see a list of subscriptions belonging to the tenants you selected in the previous step.

```
┌───────────────────────────────────────────────────────────┐
│ Select subscriptions to include in service discovery      │
├───────────────────────────────────────────────────────────┤
│ ☑️ Demos (Experiments)                                    │
│   (sub-id-123)                                            │
│ ☑️ Portal (Production)                                    │
│   (sub-id-789)                                            │
└───────────────────────────────────────────────────────────┘
```

### Filter Persistence

Your filtering selections are **automatically saved and persisted** across VS Code sessions. When you reopen the filtering wizard, your previous selections will be pre-selected, making it easy to adjust your filters incrementally.

### How Filtering Works in Different Contexts

The filtering behavior differs depending on how you access service discovery:

#### From the Service Discovery Panel

When working within the **Service Discovery** panel in the sidebar:

- Your filter selections (tenants and subscriptions) are **applied automatically**.
- Only resources from selected tenants and subscriptions are displayed.
- The filter persists until you change it.

#### From the "Add New Connection" Wizard

When adding a new connection via the **"Add New Connection"** wizard:

- **No filtering is applied** by default.
- You will see **all subscriptions from all tenants** you have access to, regardless of your filter settings or sign-in status for each tenant.
- This ensures you can always access any resource when explicitly adding a connection.

## Related Documentation

- [Service Discovery Overview](./service-discovery)
- [Azure Cosmos DB for MongoDB (RU) Service Discovery](./service-discovery-azure-cosmosdb-for-mongodb-ru)
- [Azure DocumentDB Service Discovery](./service-discovery-azure-cosmosdb-for-mongodb-vcore)
- [Azure VMs (DocumentDB) Service Discovery](./service-discovery-azure-vms)
