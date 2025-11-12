> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Service Discovery in DocumentDB for VS Code

**DocumentDB for VS Code** is built with an open architecture. While the extension focuses on developer productivity-such as data exploration, running queries, and importing/exporting data-the core connectivity is centered around connection strings.

![Service Discovery Providers Location](./images/service-discovery-introduction.png)

## How Service Discovery Works

A **Service Discovery plugin** is designed to understand a specific vendor environment. Its responsibilities include:

- **Authentication:** Handling the process of logging in or obtaining credentials for the target platform.
- **Navigation:** Guiding the user through the internal platform, systems, or APIs to locate relevant resources.
- **Discovery:** Identifying available database services or endpoints.
- **Connection Sharing:** Once discovery is complete, the plugin provides a connection string to DocumentDB for VS Code. From there, the extension manages the connection and enables you to work with your data.

This approach allows you to connect to a variety of platforms without needing to manually gather connection details. The plugin handles the complexity of each environment, so you can focus on your development tasks.

## Available Service Discovery Plugins

Currently, the following service discovery plugins are available:

- **[Azure CosmosDB for MongoDB (RU)](./service-discovery-azure-cosmosdb-for-mongodb-ru)**
- **[Azure DocumentDB](./service-discovery-azure-cosmosdb-for-mongodb-vcore)**
- **[Azure VMs (DocumentDB)](./service-discovery-azure-vms)**

We are actively working to integrate more platforms and welcome contributions from the community.

## API and Extensibility

The Service Discovery API is under active development and refinement. At present, service providers are implemented directly within our repository. Once the API stabilizes, we plan to make it even easier to add new providers through a pluggable architecture.

If you are interested in contributing, now is a great time to get involved and help shape the direction of this feature.

## Get Involved

Would you like to add your own service discovery provider? Would you like to suggest a provider to be added? Do you have feedback or suggestions about the existing plugins?

We encourage you to [join the discussion board](https://github.com/microsoft/vscode-documentdb/discussions) and share your ideas or questions. Collaboration and feedback from developers like you are essential to making DocumentDB for VS Code more useful and adaptable to a wide range of environments.
