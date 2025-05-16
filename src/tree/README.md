# Tree Structure Overview

_Last update: April 30, 2025_

This directory contains the tree view implementations for the DocumentDB for VS Code extension. The extension provides multiple ways to visualize and interact with CosmosDB resources.

## View Types

The extension offers two primary views for displaying CosmosDB resources:

- **Azure Resources View** (`azure-resources-view/`): Displays DocumentDB resources in the Azure Resources view.
- **Connections View** (`workspace-view/`): Displays DocumentDB resources in a local workspace view.
- **Discovery View** (`discovery-view/`): Displays DocumentDB resources in a local workspace view.

Dedicated data providers need to be implemented for both views. This is why there are two different "\*-view" directories.

## Shared Tree Item Implementations

The following folders contain shared tree item implementations that are used by both view data providers:

- `documentdb/`: Tree items for Document DB resources (MongoDB RU and MongoDB vCore)
