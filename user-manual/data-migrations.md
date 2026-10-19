---
title: 'Data Migrations'
parent: 'Data Management'
nav_order: 2
---

# Data Migrations in the DocumentDB extension for Visual Studio Code

The **DocumentDB extension for Visual Studio Code** provides a powerful and extensible data migration framework that enables seamless data movement between different database systems, cloud platforms, and local environments. This feature is designed to simplify complex migration scenarios while maintaining full control over the migration process.

## How Data Migrations Work

The migration system in the extension is built on a **provider-based architecture**. Each migration provider is a specialized extension that understands how to handle migrations for specific platforms, tools, or migration scenarios.

## How to Use Data Migrations

### Starting a Migration

When you initiate the migration feature from your database connection, the extension will:

1. **Display Available Providers**: All registered migration providers will be listed for you to choose from
2. **Provider Selection**: Select the migration provider that best fits your migration needs

### Provider Behavior

Once you've selected a migration provider, one of two things will happen:

#### Direct Action

- The provider immediately starts its migration procedure
- Control is handed over to the provider for the entire migration workflow

#### Action Selection

- The provider presents you with a list of available migration actions
- You can choose the specific action you want to perform (e.g., "Migrate Current Collection", "Migrate Entire Database")
- Once selected, control is handed over to the provider for that specific action

### Provider Control

Migration providers implement their own:

- User interfaces and dialogs
- Views and controls
- Migration workflows and progress tracking
- Error handling and validation
- Authentication mechanisms

Once a migration action has been started, the provider takes full control of the migration process. This allows each provider to provide specialized functionality tailored to specific migration scenarios, database types, and target platforms while maintaining a consistent entry point through the DocumentDB extension.

## Provider Architecture

The migration system is designed to be extensible, allowing third-party developers to create custom migration providers that integrate seamlessly with the DocumentDB extension. Each provider can provide unique migration capabilities while maintaining a consistent user experience through the extension's provider framework.

### Context-Aware Operations

Migration providers receive full context about your database connection, including:

- Connection string details
- Current database and collection selection
- Authentication state
- Extended properties for custom scenarios

This context allows providers to offer intelligent, targeted migration options based on your current selection and connection state.

## API Documentation

> **Provider API preview**
>
> The migration provider API remains experimental and restricted to registered extensions.
> To request access for a provider extension, [open an issue](https://github.com/microsoft/vscode-documentdb/issues)
> with the extension ID and a short description of the provider.

For detailed API documentation, plugin development information, and technical specifications, please refer to:

**[Migration API Documentation](https://github.com/microsoft/vscode-documentdb/blob/main/api/README.md)**

The API documentation includes:

- Complete interface specifications
- Implementation examples
- Authentication patterns
- Advanced usage scenarios
- Integration guidelines
