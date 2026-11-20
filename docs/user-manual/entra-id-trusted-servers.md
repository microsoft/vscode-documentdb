---
title: 'Microsoft Entra ID Trusted Servers'
parent: 'Connecting to Databases'
nav_order: 7
permalink: /user-manual/entra-id-trusted-servers/
---

# Microsoft Entra ID Trusted Servers

Microsoft Entra ID tokens are sent only to recognized Azure DocumentDB service host names or an
explicitly trusted, narrow service suffix. This applies to **account sign-in and managed identity**,
whether a connection comes from a link, a pasted string, a saved or edited connection, the shell,
or the Query Playground. Username/password and no-authentication connections are unchanged.

The authentication method you select is authoritative. When you select Username and Password
or No Authentication, conflicting URI options that would make the driver perform OIDC are removed
from the runtime connection. Other native authentication options and TLS settings are preserved.

If you see **Microsoft Entra ID isn't allowed for this server**, check the connection string
before changing any setting. Choosing **Learn More** opens this page; it does not grant trust or
fill in settings.

When the server address is unrecognized, the authentication picker shows **Microsoft Entra ID** as
_not enabled for this address_. Select it for guidance. This is a server-address check, not a sign-in
failure.

## Recognized service names

The built-in suffixes are:

| Cloud               | Service host name                         |
| ------------------- | ----------------------------------------- |
| Azure public cloud  | `<cluster>.mongocluster.cosmos.azure.com` |
| Azure US Government | `<cluster>.mongocluster.cosmos.azure.us`  |
| Azure China         | `<cluster>.mongocluster.cosmos.azure.cn`  |

These are destination rules, not a guarantee of service availability or successful sign-in in every
cloud. See [Sovereign Clouds](../sovereign-clouds) for cloud selection and sign-in limitations.

Every host in the connection string must qualify; one recognized host does not authorize the
others. Matching is case-insensitive, on whole DNS labels, and requires a host before the suffix.
SRV answers, discovered servers, and reconnects must stay within the approved suffixes for that
connection and pass certificate validation.

A name ending in `azure.com`, `azure.us`, or `azure.cn` alone is **not** enough. Those domains
also contain customer-hosted servers that must not receive database tokens.

## Why the destination matters

The token's audience is the shared **Azure OSS RDBMS** resource, not a particular cluster or a
DocumentDB-only resource. A server receiving a token could reuse it against Azure DocumentDB,
Azure Database for PostgreSQL, or Azure Database for MySQL where that identity has database roles.
Expiry, network access, and applicable access policies still limit its use. A successful account
sign-in, or a valid certificate for an unrelated Azure server, does not establish that the server
should receive your token.

## Check the connection first

1. Compare **every host** with the connection string shown for your cluster in the **Azure portal**.
   For a link, verify the destination independently rather than trusting its publisher.
   If you cannot view the resource, ask the cluster owner for the portal connection string;
   database users do not need Azure Resource Manager permissions just to use this policy.
2. Prefer that service connection string. Use **Update Connection String** to correct a saved
   connection, then **Update Credentials** if you need to choose authentication again.
   Editing to an untrusted destination clears a previously selected Entra or managed-identity
   method; it does not silently switch to another method.
3. If the portal's service endpoint is still unrecognized, [report a missing endpoint
   form](https://github.com/microsoft/vscode-documentdb/issues) before adding trust. Include the
   extension version, cloud, error, and a redacted example preserving the service suffix. Do not
   post tokens, passwords, full connection strings, or resource identifiers.
4. Only after confirming the endpoint belongs to Azure DocumentDB, consider the existing
   [machine-scoped suffix setting](#trust-a-confirmed-service-suffix). If the cluster permits
   username/password authentication, that remains an alternative; choose it explicitly.

## Trust a confirmed service suffix

`documentDB.customEnvironment.hostnameSuffix` is **one string**, not a list. It applies to every
Entra connection on the machine, in any cloud. Microsoft Entra ID tokens are sent to servers ending
with this suffix. **Add only a suffix you have confirmed belongs to Azure DocumentDB.**

Use the narrowest service suffix that covers the verified hosts. For example,
`.data.contoso.example` covers `db1.data.contoso.example`, but not `data.contoso.example` itself
or `db1.data.contoso.example.other.example`. This is an illustration, not a suffix to copy without
verification.

Open **Preferences: Open User Settings (JSON)**, or **Preferences: Open Remote Settings (JSON)**
when the extension runs remotely, and add only the confirmed property to the existing object:

```json
{
    "documentDB.customEnvironment": {
        "hostnameSuffix": ".data.contoso.example"
    }
}
```

Keep any existing `ossrdbmsEndpoint` property. It chooses the token audience; `hostnameSuffix`
does not. See [Sovereign Clouds](../sovereign-clouds#the-settings) for those independent settings.

- Use valid DNS labels, optionally preceded by a dot. Wildcards, URLs, ports, paths, IP addresses,
  trailing dots, bare top-level domains, and common public suffixes such as `com.cn` are rejected.
- Broad Azure domains and parents of the built-in service suffixes are rejected, including
  `azure.com`, `azure.us`, `azure.cn`, and `cosmos.azure.com`.
- Customer-hosting namespaces cannot grant trust: a suffix containing a `cloudapp` label is
  rejected, as are parents of the known public and sovereign customer-hosting namespaces, such as
  `usgovcloudapi.net` and `chinacloudapi.cn`.
- The existing built-in service suffixes need no override.

This setting has **machine scope**. Workspace/folder settings and Settings Sync cannot grant this
trust. In a remote window, only the remote machine's setting is used, not your local User value.
Remove the property or leave it empty to withdraw custom trust. New connection attempts and
new sockets on existing connections recheck current trust, including when a token is cached.
Token requests also recheck after acquisition, before returning a token. An already authenticated
socket is not forcibly disconnected. A shell or playground session using custom trust is
permanently revoked when that suffix changes; restart the session after confirming the new setting,
even if you restore the original suffix. Open sessions retain their original destination restrictions,
identity and token audience rather than adopting replacement trust in place.

The DocumentDB output records the custom suffix when it admits a connection, never the token or
connection string. Review the suffix for private information before sharing output.

## Certificates and private endpoints

A custom suffix does **not** relax TLS. Every server must still present a valid certificate for
the host name used in the connection. A CNAME pointing to a recognized service is not enough if its
alias is untrusted or the certificate does not cover that alias.

Use the portal's service FQDN for private connectivity where possible. Do not replace it with an IP
address, `localhost`, or a tunnel address; those destinations are not accepted for Entra
authentication. A host with a trailing dot is also rejected.

Certificate/hostname-validation bypasses are ignored for Entra authentication, including saved
bypasses and options embedded in a link or pasted string. URI-supplied CA or proxy overrides do not
establish trust either. A custom alias cannot be rescued by disabling TLS checks. These rules also
apply to managed identity and to shell/playground connections; they do not change the existing
local TLS options for username/password or no authentication.
