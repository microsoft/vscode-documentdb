> **User Manual** | [Back to Service Discovery](./service-discovery) | [Back to User Manual](../index#user-manual)

---

# MongoDB Atlas Service Discovery

MongoDB Atlas Service Discovery lets you browse Atlas organizations, projects, and clusters from DocumentDB for VS Code. You can then create a connection from a discovered cluster without manually copying its endpoint.

Use MongoDB Atlas Service Discovery from either location:

- The **Service Discovery** view in the extension sidebar.
- **New Connection** > **Service Discovery** > **MongoDB Atlas**.

## Before you start

You need two kinds of access:

| Purpose                     | What you need                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Browse Atlas resources      | An Atlas API Key or Service Account that can list the organizations, projects, and clusters you need. |
| Connect to an Atlas cluster | An Atlas database user with a username and password, plus network access to the cluster.              |

The Atlas API Key or Service Account is used only to discover resources. It is not a database login. You enter a database username and password when you connect to a cluster.

## Connect to your first cluster

1. Open **Service Discovery** and expand **MongoDB Atlas**.
2. Select **Sign in to view MongoDB Atlas clusters**.
3. Choose one authentication method:
   - **API Key**: enter an Atlas Public Key and Private Key.
   - **Service Account**: enter an Atlas Client ID and Client Secret.
4. Complete the verification step. The extension saves the credential only after Atlas accepts it.
5. Expand an organization, then a project, and select a cluster that is ready to connect.
6. Enter the Atlas database username and password when prompted.
7. Save the connection or open the cluster to work with its databases and collections.

The extension prefers the Atlas SRV connection string when Atlas provides one. The saved result is a regular DocumentDB for VS Code connection.

## What to do next

- [Browse Atlas resources and connect to a cluster](./service-discovery-mongodb-atlas-browse)
- [Manage MongoDB Atlas credentials](./service-discovery-mongodb-atlas-credentials)
- [Troubleshoot MongoDB Atlas Service Discovery](./service-discovery-mongodb-atlas-troubleshooting)

## Multiple organizations

An Atlas API Key or Service Account belongs to one Atlas organization. To browse clusters in more than one organization, add a credential for each organization. The extension combines resources found through all configured credentials. When more than one credential can access the same resource, the resource is shown once.

## Related documentation

- [Service Discovery](./service-discovery)
- [Connecting with a URL](./how-to-construct-url)
- [Copy Connection String](./copy-connection-string)
