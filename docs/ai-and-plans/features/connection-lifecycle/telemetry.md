---
feature: connection-lifecycle
kind: notes
status: active
created: 2026-11-25
---

# Connection lifecycle telemetry

**Pending ingestion verification.** Run these queries in the extension's Application Insights Logs workspace.
Paste the common setup before any one query body. Set the actual extension version (including
the prerelease suffix for CP-5) and UTC window to inspect.

```kusto
let StartAt = startofday(ago(7d));
let EndAt = StartAt + 7d;
let ReleaseVersion = "1.2.0";
let Events =
    customEvents
    | where timestamp >= StartAt and timestamp < EndAt
    | extend version = coalesce(tostring(customDimensions["common.extversion"]),
        tostring(customDimensions.extensionVersion), tostring(column_ifexists("application_Version", "")), "(missing)")
    | where version == ReleaseVersion
    | extend eventScope = tolower(extract(@"([^/]+)$", 1, name)),
             sdkResult = tolower(tostring(customDimensions.result));
let Operations =
    Events
    | extend parentContext = tostring(customDimensions.parentNodeContext)
    | extend family = case(
        eventScope == "connect", "connect",
        eventScope startswith "documentdb.rpc.", "rpc",
        (eventScope == "getchildren" or eventScope endswith ".getchildren")
            and isnotempty(parentContext) and parentContext !~ "root", "getchildren",
        "")
    | where isnotempty(family)
    | extend connectionResult = tolower(tostring(customDimensions.connectionResult))
    | extend operationResult = case(
        sdkResult == "canceled" or connectionResult in ("canceled", "cancelled"), "canceled",
        sdkResult == "failed" or connectionResult == "failed", "failed",
        sdkResult == "succeeded" or connectionResult == "success", "succeeded",
        "(missing)")
    | extend ageMs = todouble(customMeasurements.connectionAgeMs),
             generation = tolong(customMeasurements.clientGeneration),
             failureKind = tostring(customDimensions.connectionFailureKind),
             failureType = tostring(customDimensions.causeType),
             recoveryRows = tostring(customDimensions.usedCachedErrorNode) =~ "true"
                or tostring(customDimensions.cachedErrorNode) =~ "true"
    | extend signature = case(
        operationResult != "failed", "",
        family != "rpc", "notClassified",
        failureType in~ ("18", "391", "AuthenticationFailed", "Unauthorized",
            "EntraSignInRequiredError", "EntraIdentityMismatchError"), "auth",
        failureType in~ ("MongoNotConnectedError", "MongoTopologyClosedError"), "closedClient",
        failureType in~ ("MongoNetworkError", "MongoNetworkTimeoutError", "ECONNRESET", "EPIPE"), "socket",
        "otherOrUnclassified");
```

## Daily database token lookups and lifetime

`connection.tokenRenewal` counts post-startup Entra database token lookup outcomes. For `extension`,
`returned` means the token passed the host callback's checks. For `shell` and `playground`, it means
the host checked and sent a token response; the worker can still reject or discard it before its
callback completes. On any surface, `returned` does **not** mean the token changed, MSAL made a
network request, or the database accepted the token. Lifetime is the
JWT's positive `exp − iat` in seconds, not its remaining validity. An opaque or invalid lifetime is
missing, not zero. Compare returned rows with and without a lifetime; failures don't have one.

```kusto
Events
| where eventScope == "connection.tokenrenewal"
| extend surface = coalesce(tostring(customDimensions.surface), "(missing)"),
         outcome = coalesce(tostring(customDimensions.renewalOutcome), "(missing)"),
         lifetime = todouble(customMeasurements.tokenLifetimeSeconds)
| extend lifetime = iff(lifetime > 0, lifetime, real(null))
| summarize lookups = count(),
    lifetimeSamples = countif(isnotnull(lifetime)),
    missingLifetime = countif(isnull(lifetime)),
    percentiles(lifetime, 50, 90)
    by version, day = bin(timestamp, 1d), surface, outcome
| order by day asc, surface asc, outcome asc
```

This is background activity: exclude `connection.tokenrenewal` from active-use event scopes.
Expect roughly one lookup per active Entra client-hour, not one per operation. Use daily counts by
surface to check the observed volume against the telemetry budget. No lookups means no evidence.

## Observed outcomes by client age and entry generation

`successfulExpansionsEnteringGen2Plus` counts successful cluster expansions that reported
generation 2 or later **at entry** and did not return first-time or cached recovery rows. It
does not count an expansion that enters on generation 1 and replaces it during the operation.
Discovery expansions do not report a generation here. The count is neither unique recoveries nor
proof that renewal triggered them. Other operations are shown for context only: an RPC can return a
typed unavailable result without reporting an SDK failure. Missing ages and generations are shown
explicitly.

```kusto
Operations
| extend ageBand = case(
    isnull(ageMs) or ageMs < 0, "(missing)",
    ageMs < 3600000, "<1h", ageMs < 7200000, "1–2h", ageMs < 14400000, "2–4h", "4h+"),
    generationBand = case(isnull(generation) or generation < 1, "(missing)", generation == 1, "1", "2+"),
    lifecycleKind = coalesce(failureKind, "(missing)")
| summarize operations = count(),
    successfulExpansionsEnteringGen2Plus = countif(
        family == "getchildren" and tolower(parentContext) matches regex @"\btreeitem_documentdbcluster\b"
        and operationResult == "succeeded" and generation >= 2 and not(recoveryRows))
    by version, family, ageBand, generationBand, operationResult, lifecycleKind, signature
| order by family asc, ageBand asc, generationBand asc
```

## Cross-release comparison deferred

In 1.2.0, a database RPC can return auth or closed-client unavailability as a normal
response, recorded as `Succeeded` without `causeType`. Older versions could report the same
outcome as an RPC failure. Matching procedures and signatures therefore does not make the
counts comparable. Use the queries here to describe a single release and verify ingestion,
not to claim that late failures fell. The comparison and any additional instrumentation are
deferred; see [decision 0020](./decisions.md#0020-defer-the-cross-release-comparison-of-late-failures).

## ARM challenge versus final operation result

Use the existing Azure SDK challenge dimensions and the final framework `result` on the **same**
event. A token was acquired when `challengeSuccess=true`; count `true` with `succeeded` separately
from `true` with `failed`, `canceled`, or a missing result. For a scope that wraps multiple requests
or both ARM and database work, this is the enclosing operation's result, not a per-request ARM
status. Use an ARM-only single-request scope when verifying that ARM accepted the retried request.
Zero observed challenges is inconclusive.

```kusto
Events
| where tostring(customDimensions.challenge) =~ "true"
| extend challengeOutcome = tolower(tostring(customDimensions.challengeSuccess))
| extend challengeOutcome = case(challengeOutcome == "true", "tokenAcquired",
    challengeOutcome == "false", "noToken", "(missing)"),
    finalResult = coalesce(sdkResult, "(missing)")
| summarize challengedOperations = count()
    by version, day = bin(timestamp, 1d), eventScope, challengeOutcome, finalResult
| order by day asc, eventScope asc
```
