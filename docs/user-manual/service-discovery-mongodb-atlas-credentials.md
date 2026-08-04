> **User Manual** | [MongoDB Atlas Service Discovery](./service-discovery-mongodb-atlas) | [Back to User Manual](../index#user-manual)

---

# Manage MongoDB Atlas Credentials

MongoDB Atlas Service Discovery supports Atlas API Keys and Atlas Service Accounts. These credentials are used to browse Atlas resources. They are separate from the database username and password used to connect to a cluster.

## Add a credential

Open **Manage MongoDB Atlas Credentials** from the MongoDB Atlas discovery item, then select **Add a credential…**.

Choose one of these methods:

| Method          | Enter                       | Suitable for                                |
| --------------- | --------------------------- | ------------------------------------------- |
| API Key         | Public Key and Private Key  | Individual or operational Atlas API access. |
| Service Account | Client ID and Client Secret | Automation or shared operational access.    |

The extension verifies the credential with the Atlas Admin API before saving it. If verification fails, the credential is not saved.

For instructions on creating access credentials and assigning roles, see the [MongoDB Atlas API access documentation](https://www.mongodb.com/docs/atlas/configure-api-access/).

## Add credentials for more organizations

Each Atlas API Key and Service Account belongs to one organization. Add a credential for every organization whose projects you need to browse.

Adding another credential does not replace existing credentials. The extension queries all configured credentials and preserves resources that remain available when one credential fails.

## Review a credential

In **Manage MongoDB Atlas Credentials**, select a credential to see these actions:

| Action                | Use it when                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Retry                 | You corrected an Atlas role, access-list rule, or temporary network issue for this credential. |
| Open in MongoDB Atlas | You need to review the API Key, Service Account roles, or IP access list in Atlas.             |
| Update credentials…   | You rotated the credential secret.                                                             |
| Sign out              | You no longer want this credential stored in the extension.                                    |

Use **Retry all** to recheck all configured credentials. Use **Sign out of all** to remove every stored Atlas discovery credential.

## Update a rotated secret

Use **Update credentials…** after rotating an Atlas Private Key or Client Secret.

1. Select the existing credential in **Manage MongoDB Atlas Credentials**.
2. Select **Update credentials…**.
3. Enter the replacement Private Key or Client Secret.
4. Complete the validation step.

The credential identity stays the same during an update. The extension keeps the existing credential until the replacement secret is accepted. To use a different Public Key or Client ID, add it as a new credential and then sign out of the old one.

## Storage and token refresh

Credential secrets are stored in VS Code Secret Storage. The extension stores only non-secret information needed to identify and display a credential with the extension settings.

Service Account access tokens expire. When possible, the extension refreshes a Service Account token using its stored Client ID and Client Secret. If Atlas still rejects the credential, review the credential in Atlas and use **Retry** after correcting the issue.

## Least privilege

Assign only the Atlas access needed for the organizations and projects you intend to discover. A credential that can authenticate but has no access to a project cannot make that project appear in Service Discovery.

Keep database-user credentials separate from API Keys and Service Account secrets. Do not place any of these credentials in source control.

## Next steps

- [Browse Atlas resources and connect to a cluster](./service-discovery-mongodb-atlas-browse)
- [Troubleshoot MongoDB Atlas Service Discovery](./service-discovery-mongodb-atlas-troubleshooting)
