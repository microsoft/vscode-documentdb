# Task Service UI Components

This folder contains optional UI services that integrate with the TaskService to provide visual feedback during task execution.

## Services

### TaskProgressReportingService

Displays VS Code notification progress dialogs for running tasks. Automatically attaches to the TaskService and monitors all registered tasks. Shows progress percentage, status messages, and allows task cancellation via the notification.

**Activation:** Automatically attached during extension initialization.

## Design Principles

1. **Separation from TaskService** - These services consume TaskService events but don't modify its core behavior
2. **Optional activation** - Not all tasks require all UI services
3. **Cleanup guarantee** - All visual indicators are cleared when tasks reach terminal states
4. **Throttled updates** - High-frequency updates are throttled to prevent excessive UI refreshes
