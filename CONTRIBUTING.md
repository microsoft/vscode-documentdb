# Contributing to DocumentDB for VS Code

Thank you for your interest in contributing to the **DocumentDB for VS Code** extension. This guide helps you set up your development environment and configure Visual Studio Code to effectively contribute to the extension.

The document consists of three sections:

1. [Branching Strategy](#1-branching-strategy)
2. [Machine Setup](#2-machine-setup)
3. [VS Code Configuration](#3-vs-code-configuration)

## 1. Branching Strategy

The repository follows a structured branching strategy to ensure smooth development and release processes:

- **`main`** — Production-ready code. All releases are tagged here.
- **`next`** — Staging for the upcoming release. Completed features are merged here.
- **`dev/<user>/<feature>`** — Individual feature branches for personal development.
- **`feature/<big-feature>`** — Shared branches for large features requiring collaboration.

### Pull Requests and GitHub Actions

GitHub Actions are configured to perform automated checks on the repository. The intensity of these checks depends on the target branch:

1. **Push to `next`, `dev/*`, or `feature/*` branches**:

   - Runs basic code quality checks and tests.
   - Skips resource-intensive jobs like integration tests and packaging to focus on code validation.

2. **Pull Requests to `main` or `next`**:

   - Executes all jobs, including code checks, tests, and packaging.
   - Ensures complete validation before merging, including artifact generation.

3. **Push to `main`**:
   - Runs the full workflow for release validation and artifact generation.

This setup ensures that contributions are thoroughly validated while optimizing resource usage during development.

## 2. Machine Setup

Follow these instructions to configure your machine for JavaScript/TypeScript development using Windows Subsystem for Linux (WSL2) and Visual Studio Code.

> This setup assumes you're using WSL2 on Windows. However, you can use a Linux or Windows setup exclusively if preferred.

### 2.1. Install Ubuntu 22.\* on Windows

- Install **Ubuntu 22.\*** from the Microsoft Store and launch it to configure your Linux user account.

  - Your development environment and tools will reside within `WSL2`.
  - VS Code integrates seamlessly with `WSL2` instances, enabling smooth development from your Windows machine.

### 2.2. Update Ubuntu Packages

Open your Ubuntu terminal and run:

```bash
sudo apt update
sudo apt upgrade
```

### 2.3. Install Node.js with FNM (Fast Node Manager)

- `FNM` helps with installing and switching Node.js versions easily. This is useful for testing compatibility across different Node.js versions.

Run the following commands:

```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22
fnm use 22
fnm default 22
node --version
```

### 2.4. Install TypeScript Globally (optional)

You can install TypeScript globally:

```bash
npm install -g typescript
```

## 3. VS Code Configuration

This section explains how to clone the **DocumentDB for VS Code** repository and set up Visual Studio Code for development and debugging.

### 3.1. Steps to Clone and Set Up Repository

1. Ensure you have completed the [Machine Setup](#2-machine-setup) steps.

2. Fork or directly clone the official repository:

   - [DocumentDB for VS Code (vscode-documentdb)](https://github.com/microsoft/vscode-documentdb)

   - Open your **WSL2** terminal and clone the repository:

```bash
cd ~
git clone https://github.com/microsoft/vscode-documentdb
```

3. Install dependencies and build the project:

```bash
cd ~/vscode-documentdb
npm install
npm run build
```

### 3.2. Launching and Debugging in VS Code

To effectively isolate development environments, it is beneficial to create and use a separate VS Code profile.

1. Open the cloned repository in VS Code:

```bash
cd ~/vscode-documentdb
code .
```

2. Start debugging the extension:
   - Switch to the `Run and Debug` panel.
   - Select `Launch Extension (webpack)`.
   - Press `F5`.

## You're Ready to Contribute! 🎉

You've now successfully set up your development environment and are ready to contribute to **DocumentDB for VS Code**. We appreciate your contributions!
