---
title: 'Diagnose a Connection'
parent: 'Connecting to Databases'
nav_order: 7
---

# Diagnose a Connection

When a connection fails, the driver usually reports a single error, such as `ECONNREFUSED`, a server
selection timeout or a TLS alert. **Diagnose connection** in the DocumentDB extension for
Visual Studio Code takes the connection apart and checks it one step at a time: the connection
settings, the server address, the network connection, the secure connection, the server's first reply,
sign-in and database access. It says which step stopped the connection and what to try next.

It works for connections that succeed, too. A working connection ends with **Connection successful**,
and each step's **Details** show what was found, such as the server version and which server answered.

**Table of Contents**

- [Open connection diagnosis](#open-connection-diagnosis)
- [What the checks do](#what-the-checks-do)
- [Where the checks run](#where-the-checks-run)
- [Sign-in is never prompted](#sign-in-is-never-prompted)
- [Read the result](#read-the-result)
- [Time limits and retries](#time-limits-and-retries)
- [Firewalls and IP allowlists](#firewalls-and-ip-allowlists)
- [Share diagnostics safely](#share-diagnostics-safely)
- [What connection diagnosis does not do](#what-connection-diagnosis-does-not-do)

## Open connection diagnosis

There are three ways to open it:

- **From a failed connection.** When a cluster fails to connect, the tree shows recovery items under
  it. Select **Diagnose this connection…**.
- **From any cluster.** Right-click a cluster in the Connections, Discovery or Azure view and select
  **Diagnose Connection…**. This works whether or not the cluster is connected. It is not offered
  on the Local Quick Start instance node.
- **From the Command Palette.** Run **DocumentDB: Diagnose Connection…** and pick a saved
  connection.

Each cluster has one connection diagnosis panel. Opening it again brings the existing panel to the front and
offers to run the check again.

## What the checks do

The panel shows the same eight steps for every connection, from the moment it opens. They settle from
top to bottom, so you always know where the check is:

| Step                     | What it checks                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Diagnosis setup          | Where the checks run: this computer or a remote host, the operating system and versions                                                    |
| Connection settings      | The connection string, its options, stored credentials, and any preparation such as a Kubernetes port forward                              |
| Server address (DNS)     | SRV and TXT records for `mongodb+srv://` strings, and name resolution for each host, including private endpoints                           |
| Network connection (TCP) | Whether each host accepts a connection on its port                                                                                         |
| Secure connection (TLS)  | The TLS handshake and the server certificate, using the same certificate settings as the connection                                        |
| Server greeting (hello)  | The server's first reply, before any password or token is sent: server type, API compatibility, accepted compressors, and the server clock |
| Authentication           | A real sign-in with the method you chose for this connection                                                                               |
| Database access          | A ping, your reported roles and whether databases can be listed                                                                            |

Each step's detail line says what was done and what was found, for example
"3 of 3 hosts reachable · Port 10260" or "Not used: TLS is off for this connection". A step that does
not apply is shown as skipped, with the reason.

When a finished step has more to say, its detail line ends with **Details**. Select it to see why the
step has its status, and what was found behind its detail line, for example which addresses a host
name resolved to or which connection string options were used. A step with a warning or an error
always explains it there. If your computer's own name lookup and a direct query to your DNS servers
give different answers, for example with a VPN, split DNS or a hosts file entry, **Server address (DNS)**
shows both. These details show your real host names and user names; **Hide identifiers in the report**
changes only the report.

The network steps run on their own, before the real sign-in. If one of them fails, connection diagnosis
still tries the real connection, because the driver may reach a different server. A failed network
step is evidence, not the final answer.

## Where the checks run

The first step says where the checks run. On a remote setup (WSL, SSH, a dev container or Codespaces),
the checks run on the remote host, not on your computer. Network rules, DNS and VPN settings of that
remote host are the ones that matter.

When you sign in with Microsoft Entra ID from a remote host, VS Code's sign-in still happens on your
local computer; the database connection and a managed identity's token request happen on the remote
host.

## Sign-in is never prompted

Connection diagnosis tests the authentication method you already chose for the connection, with the
credentials the extension already has. It never asks for a password and never opens a Microsoft Entra
ID sign-in. It also does not save anything to your connection.

So the **Authentication** step is skipped, and the result says **Connection not tested**, when:

- no authentication method was chosen for the connection,
- a username and password connection has no stored password, or
- Microsoft Entra ID has no sign-in available without a prompt.

In those cases, connect to the cluster once in the usual way, then run the check again.

A sign-in without a prompt cannot tell "not signed in" apart from a consent or permission problem in
Microsoft Entra ID. When this applies, the report says so and names the VS Code log to check
(**Developer: Show Logs…**, then **Microsoft Authentication**, or **Microsoft Sovereign Cloud
Authentication** for sovereign clouds). If a sign-in for this connection failed earlier in the session,
the result mentions it.

Problems that a real connection would fail on, rather than ask about, are reported as failures. For
example, a cloud setting that does not match the cluster's cloud fails the Authentication step and
names the setting to change. See [Sovereign Clouds](./sovereign-clouds).

The connection details are read without prompts or notifications too. If they cannot be read, for
example because the Azure sign-in expired, access to the resource was denied, the Kubernetes API is
unreachable or a MongoDB Atlas cluster is paused, the **Connection settings** step says so and the
check stops there. Show report has the details.

Azure VM discovery is an exception for the connection details, not for sign-in: the VM's discovery
data does not include the DocumentDB port, so the extension asks for it, as when you connect. If you
already entered the port for that VM in this session, it is used without asking. If you close the
prompt, the result says **Connection not tested**; **Cancel** also closes it.

For a Kubernetes service reached through port forwarding, the check uses the port-forward tunnel that
is already running for the service, or starts one on the local port the extension would suggest when
you connect. It never asks for a port. If that local port is used by another program, the
**Connection settings** step names the port instead of offering to use it. A tunnel the check started
or used is shared with your other connections to that service and stays open after the check; the
report says so.

## Read the result

When the check ends, a result card appears below the list:

- **Connection successful** means the real connection worked: "All checks passed. Sign-in succeeded
  and the database answered." If a step ended with a warning or failed, the title counts it, for
  example **Connection successful, with 1 warning**, and the card lists each such step with what was
  found. Select **Details** on that step to see why and what to do. A warning, or a failed check of a
  single server, never turns a successful connection into a failure. The server version, ping and the
  server that answered are in the **Details** of **Server greeting (hello)** and **Database access**.
- **Connection works, but sign-in is required** means the server answered, but the connection is set
  to **No authentication** and the server will not list databases until you sign in, so the
  extension cannot show anything for it. **Database access** is marked as a warning ("listing
  databases needs sign-in"). Choose an authentication method for the connection with **Update
  Credentials…**, then run the diagnosis again. A server without access control that lists databases
  with No authentication still shows **Connection successful**.
- **Connection failed at …** names the step where the connection stopped, then what failed, why, and
  what to try next. Earlier evidence that explains the failure is listed after it.
  When the server cannot be reached at all, the card names the network step that failed, for example
  **Connection failed at Network connection (TCP)** with "Network connection timed out", and adds
  "The driver also could not reach a server." The **Authentication** step then says "Could not reach
  a server": the credentials were never tried, so they are not the problem.
- **Connection not tested** means the real sign-in did not run because a required input was missing.
  It does not mean the server is unreachable.
- **Diagnosis stopped at the time limit** means the time limit was reached before sign-in was tried.
  It does not mean the server is unreachable; the card offers the retries described below.
- **Diagnosis cancelled** keeps the results so far. A cancelled check has no report.

For a failed connection, the card ends with: "Contacting support? Use Share report at the bottom of
the page to copy or save the report." **Show report**, next to it, is for reviewing it. Copying the
report shows a notification once the report is on the clipboard.

## Time limits and retries

Every step has a time limit, so a check that cannot reach the server ends instead of waiting forever:

| Work                                                  | Time limit | With **Retry with longer timeouts** |
| ----------------------------------------------------- | ---------- | ----------------------------------- |
| Whole check                                           | 5 minutes  | 10 minutes                          |
| Preparation (for example a port forward)              | 15 seconds | 30 seconds                          |
| SRV and TXT lookup                                    | 10 seconds | 20 seconds                          |
| Each DNS, TCP, TLS and server-response step, per host | 10 seconds | 20 seconds                          |
| Authentication                                        | 45 seconds | 90 seconds                          |
| Each command after connecting                         | 5 seconds  | 10 seconds                          |

A step that reaches its time limit is reported as having not finished in time. That alone does not
prove that a firewall blocks the connection or that the server is down. A network connection (TCP)
step that reaches its limit says "Network connection timed out", and a server-response step "No
server response".

When a time limit cut the check short, the result offers:

- **Retry with longer timeouts**, which doubles every time limit for one run, and
- **Retry without diagnostic timeouts**, which removes the diagnostic time limits for one run.
  This may wait until you cancel it; **Cancel** stays available.

A retry is a new run with a new report. It does not change your saved connection, and reports you
already opened or saved stay as they were. Time limits configured on the connection itself (for
example `connectTimeoutMS`) still apply; if one of them was the limit, the result says that the
connection setting must be changed first. Limits of the operating system, DNS resolver and driver also
still apply, and so do the diagnostic size limits (16 hosts, 8 addresses per host).

## Firewalls and IP allowlists

When a connection is refused, times out or cannot be routed, the result says that a firewall or IP
allowlist may be blocking it, and asks you to check access from the computer or remote host where the
checks ran, including VPN and network rules. This is a possibility, not a confirmed cause: connection diagnosis
does not inspect cloud firewall rules. It does not add this hint to a certificate problem or a rejected
password.

An Azure private-link alias resolving to a public address is information, not a warning: it is normal
outside the cluster's private network and does not prove a private endpoint exists. If the connection
fails with a network problem for that host, the result adds a conditional hint: if the cluster allows
only private access, connect from its virtual network or a network that resolves the private endpoint
(VPN, peering or a private DNS zone). A successful connection does not show that hint.

## Share diagnostics safely

The **Connection Diagnostics** header describes the task. Below it, the page names the connection
being checked and shows “Checking the connection…” while running, without a timer. After completion,
it shows when the connection was checked: “Checked a few seconds ago”, “Checked less than a minute
ago”, then “Checked 1 minute ago” or “Checked 2 minutes ago”, later in hours, and after a day the date
and time, updating as time passes. Cancelled or
stopped checks show their status instead. Real durations stay in the report.

- **Show report** opens a readable Markdown report in VS Code's Markdown preview. You can also open
  its source to select and copy parts of it. Each panel keeps one live report: Show report updates
  and reveals the same preview, or opens it again if you closed it. During Re-run it keeps the old
  report until the new run completes, then switches to the new report without moving focus.
  Tab names are neutral (“Connection diagnostics”, then “Connection diagnostics (2)”, etc.), even
  when identifiers are visible; the connection name appears inside the report instead.
- **Share report** opens a menu with two choices:
  - **Copy report to clipboard** copies the same Markdown.
  - **Save report to file…** saves it as Markdown, or as JSON for tools.

While a check runs, the footer offers **Cancel**, not **Re-run**. **Re-run** appears after it ends.
Report actions appear in the footer only after a check finishes, not as disabled buttons while it runs.

In the Markdown report, absolute times (including the run start and finish, certificate validity
and server clock) use your VS Code language and local time zone, followed by UTC ISO 8601 in
parentheses, for example `Nov 2, 2026, 3:12:08 PM UTC (2026-11-02T15:12:08.123Z)`.
The zone and ISO value let support correlate events across time zones. JSON keeps machine-readable
ISO timestamps without localized text. Hiding identifiers does not change timestamps or durations.

All three show the same completed run; none of them connects again. Each run also writes a short trace
to the **DocumentDB** output channel, with a run ID that also appears in the report.

Passwords, tokens and proxy credentials never appear in the panel, the report, the output channel or
telemetry.

The report does include identifiers: host names and addresses, user and account names, tenant IDs,
replica set names, certificate subjects, database names, and Kubernetes service and namespace names.
Before you share a report outside your organization, select **Hide identifiers in the report** in the
footer's info text. The inline link changes to **Show identifiers in the report** so you can switch
back. Hiding replaces those values with placeholders such as `host-1` and `user-1`, consistently
across the whole report, and keeps versions, timings and error codes. It applies to **Show report**,
**Copy report to clipboard** and **Save report to file…**, and immediately updates and reveals a report already
open from this panel. It does not open a preview if none is open. It changes only the report: the page itself
always shows the real values, so you can investigate with them.

If you copy or save a report while its identifiers are included, a dialog first says that the report
includes host and identity details. Select **Copy report** or **Save report** to continue, or
**Cancel** to stop; then select **Hide identifiers in the report** and share again. **Show report**
does not ask, because it only opens the report for you to read.

## What connection diagnosis does not do

It does not probe every member a server advertises, check whether this computer is online in general,
audit permissions, check cluster health, change firewall rules or upload reports anywhere.
Cloud-platform-specific firewall helpers are planned for a later release.
