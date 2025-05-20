<!-- Learn More Section Badge or Breadcrumb -->

> **Learn More** &mdash; [Back to Local Connection](./local-connection)

---

# Azure CosmosDB for MongoDB (RU) Emulator

The **Azure CosmosDB for MongoDB (RU) Emulator** allows you to develop and test applications locally using an environment that closely matches the Azure CosmosDB for MongoDB (RU) API. This is useful for development and testing without incurring cloud costs or requiring an active Azure subscription.

## How to Use

- Install the Azure CosmosDB Emulator on your local machine.
  [Official documentation and download](https://learn.microsoft.com/azure/cosmos-db/local-emulator)
- Start the emulator. It will expose a local endpoint for MongoDB connections.
- In DocumentDB for VS Code, choose the **Azure CosmosDB for MongoDB (RU) Emulator** option from the local connection area.
- The extension will pre-fill the connection string and handle any required configuration.

## Features

- Simulates the Azure CosmosDB for MongoDB (RU) API locally.
- Supports most features available in the cloud version.
- Allows for rapid development and testing cycles.

## Notes

- The emulator is intended for development and testing only.
- Some cloud-specific features may not be available or may behave differently in the emulator.

For more details, refer to the [Azure CosmosDB Emulator documentation](https://learn.microsoft.com/azure/cosmos-db/local-emulator).
