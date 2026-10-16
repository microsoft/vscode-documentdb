> **User Manual** | [MongoDB Atlas Service Discovery](./service-discovery-mongodb-atlas) | [Back to User Manual](../index#user-manual)

---

# Troubleshoot MongoDB Atlas Service Discovery

This guide separates discovery problems from database connection problems. Atlas API Keys and Service Accounts control discovery. Atlas database usernames and passwords control database access.

## A credential needs attention

When one or more credentials fail, the MongoDB Atlas root item shows a recovery action. Healthy resources found through other credentials remain visible.

| Recovery action                   | What to do                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Click here to retry               | Use this for a temporary network, service, or rate-limit failure.                                              |
| Click here to revisit credentials | Open credential management when a credential is invalid, lacks permission, or requires a more detailed review. |

In credential management, use **Retry** for one credential or **Retry all** for every credential. A retry fetches fresh resource information and rechecks Service Account access.

## No organizations, projects, or clusters appear

Check the following:

1. The intended Atlas API Key or Service Account is stored in **Manage MongoDB Atlas Credentials**.
2. The credential belongs to the Atlas organization that owns the resources.
3. The credential has an Atlas role that can list the intended projects and clusters.
4. The organization contains projects and the project contains clusters.
5. You refreshed discovery after changing a role, project membership, or credential.

Add another credential when the resources are in a different Atlas organization.

## Atlas rejects the discovery credential

Review the Public Key and Private Key for an API Key, or the Client ID and Client Secret for a Service Account. Then update the credential or add it again.

An Atlas `401` response usually means the credential cannot be authenticated. An Atlas `403` response usually means Atlas accepted the credential but the credential lacks access to the requested resource. Both cases can also require changes to Atlas network access rules.

Use **Open in MongoDB Atlas** from credential management to review the affected API Key or Service Account. The [Atlas API access documentation](https://www.mongodb.com/docs/atlas/configure-api-access/) describes API Key and Service Account setup.

## Atlas IP access list or network restrictions

Atlas can restrict requests by source IP address. If Atlas reports that the current address is not allowed, add the appropriate address or network range in Atlas, then use **Retry**.

The required rule depends on the type of request:

| Request                                        | Access to check                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Resource discovery through the Atlas Admin API | The network and access restrictions that apply to the API credential.                      |
| Database connection to a cluster               | The Atlas project IP access list and any private networking configuration for the cluster. |

See [Configure IP Access List Entries](https://www.mongodb.com/docs/atlas/security/ip-access-list/) in the Atlas documentation for the current Atlas configuration steps.

## A discovered cluster cannot be opened

Check the cluster status first. A paused, creating, updating, repairing, or deleting cluster is not ready for a connection. Resume the cluster or wait for the Atlas operation to complete.

If the cluster is ready but connection fails, check:

1. The database username and password are correct.
2. The database user has access to the intended database.
3. Your machine can reach the Atlas endpoint.
4. The Atlas project IP access list allows the connection.
5. Private endpoint, VPC peering, firewall, DNS, and TLS settings match the cluster's network configuration.

A TLS handshake error indicates that the connection did not complete at the transport layer. It does not, by itself, prove that the database username or password is incorrect. Review the cluster state, network path, and TLS configuration before replacing database credentials.

## Rate limits and temporary failures

Atlas can temporarily reject or delay requests because of a rate limit, a network interruption, or a service failure. Wait briefly and use the retry action. Retrying a single credential does not recheck the other configured credentials.

## Get help

When reporting a problem, include:

- Whether the issue occurs during discovery or after selecting a cluster.
- The displayed Atlas error message and status, without including secrets.
- Whether the failure affects one credential or every configured credential.
- The cluster state and the network path you use to reach the cluster.

Never include Private Keys, Client Secrets, database passwords, access tokens, or full connection strings in a support request.

## Related documentation

- [MongoDB Atlas Service Discovery](./service-discovery-mongodb-atlas)
- [Manage MongoDB Atlas credentials](./service-discovery-mongodb-atlas-credentials)
- [Browse Atlas resources and connect to a cluster](./service-discovery-mongodb-atlas-browse)
