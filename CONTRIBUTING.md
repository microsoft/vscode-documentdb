# Contributing to DocumentDB for VS Code

Thank you for your interest in contributing to the **DocumentDB for VS Code** extension. This guide helps you set up your development environment and configure Visual Studio Code to effectively contribute to the extension.

The document consists of two sections:

1. [Machine Setup](#1-machine-setup)
2. [VS Code Configuration](#2-vs-code-configuration)

## 1. Machine Setup

Follow these instructions to configure your machine for JavaScript/TypeScript development using Windows Subsystem for Linux (WSL2) and Visual Studio Code.

> This setup assumes you're using WSL2 on Windows. However, you can use a Linux or Windows setup exclusively if preferred.

### 1.1. Install Ubuntu 22.\* on Windows

- Install **Ubuntu 22.\*** from the Microsoft Store and launch it to configure your Linux user account.

  - Your development environment and tools will reside within `WSL2`.
  - VS Code integrates seamlessly with `WSL2` instances, enabling smooth development from your Windows machine.

- For the latest information about WSL2, visit: [Using WSL on Managed Windows Devices](https://microsoft.sharepoint.com/sites/DeviceExperience/SitePages/Device%20Experience%20-%20Linux%20-%20Apps.aspx#using-wsl-on-managed-windows-devices)

### 1.2. Update Ubuntu Packages

Open your Ubuntu terminal and run:

```bash
sudo apt update
sudo apt upgrade
```

### 1.3. Install Node.js with FNM (Fast Node Manager)

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

### 1.4. Install TypeScript Globally (optional)

You can install TypeScript globally:

```bash
npm install -g typescript
```

## 2. VS Code Configuration

This section explains how to clone the **DocumentDB for VS Code** repository and set up Visual Studio Code for development and debugging.

### 2.1. Steps to Clone and Set Up Repository

1. Ensure you have completed the [Machine Setup](#1-machine-setup) steps.

2. Fork or directly clone the official repository:

   - [DocumentDB for VS Code (vscode-documentdb)](https://github.com/microsoft/vscode-documentdb)

3. Open your **WSL2** terminal and clone the repository:

```bash
cd ~
git clone https://github.com/microsoft/vscode-documentdb
```

4. Install dependencies and build the project:

```bash
cd ~/vscode-documentdb
npm install
npm run build
```

### 2.2. Launching and Debugging in VS Code

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
