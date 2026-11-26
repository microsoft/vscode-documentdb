---
feature: connection-lifecycle
kind: notes
status: active
created: 2026-11-25
---

# Connection lifecycle telemetry

**Pending ingestion verification.** Run these queries in the extension's Application Insights Logs workspace.
Paste the common setup before any one query body. Set the deployment timestamp and actual extension versions
for the two cohorts. Use equal, complete UTC windows, with a gap if the rollout was gradual.

```kusto
let ReleaseAt = startofday(ago(7d)); // Replace with rollout boundary for this comparison.
let Window = 7d;
let RolloutGap = 0d;
let BaselineVersion = "1.1.0";
let ReleaseVersion = "1.2.0";
let BeforeEnd = ReleaseAt - RolloutGap;
let AfterStart = ReleaseAt + RolloutGap;
let Warmup = 1d;
let Events =
    customEvents
    | where timestamp >= BeforeEnd - Window - Warmup and timestamp < AfterStart + Window
    | extend version = coalesce(tostring(customDimensions["common.extversion"]),
        tostring(customDimensions.extensionVersion), tostring(column_ifexists("application_Version", "")), "(missing)")
    | extend cohort = case(
        version == BaselineVersion and timestamp >= BeforeEnd - Window - Warmup and timestamp < BeforeEnd, "before",
        version == ReleaseVersion and timestamp >= AfterStart - Warmup and timestamp < AfterStart + Window, "after", "")
    | where isnotempty(cohort)
    | extend inWindow = iff(cohort == "before", timestamp >= BeforeEnd - Window, timestamp >= AfterStart)
    | extend eventScope = tolower(extract(@"([^/]+)$", 1, name)),
             sdkResult = tolower(tostring(customDimensions.result));
let Operations =
    Events
    | where inWindow
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
| where inWindow and eventScope == "connection.tokenrenewal"
| extend surface = coalesce(tostring(customDimensions.surface), "(missing)"),
         outcome = coalesce(tostring(customDimensions.renewalOutcome), "(missing)"),
         lifetime = todouble(customMeasurements.tokenLifetimeSeconds)
| extend lifetime = iff(lifetime > 0, lifetime, real(null))
| summarize lookups = count(),
    lifetimeSamples = countif(isnotnull(lifetime)),
    missingLifetime = countif(isnull(lifetime)),
    percentiles(lifetime, 50, 90)
    by cohort, version, day = bin(timestamp, 1d), surface, outcome
| order by day asc, surface asc, outcome asc
```

This is background activity: exclude `connection.tokenrenewal` from active-use event scopes.
Expect roughly one lookup per active Entra client-hour, not one per operation. Use daily counts by
surface to check the observed volume against the telemetry budget. No lookups means no evidence.

## Post-release outcomes by client age and generation

The replacement count uses successful cluster expansions that did not return first-time or
cached recovery rows. Other operations are shown for context only: for example, an RPC can
return a typed unavailable result without reporting an SDK failure. The count is neither
unique recoveries nor proof that renewal triggered them. Not every operation reports client
age or generation; show missing values explicitly.

```kusto
Operations
| where cohort == "after"
| extend ageBand = case(
    isnull(ageMs) or ageMs < 0, "(missing)",
    ageMs < 3600000, "<1h", ageMs < 7200000, "1–2h", ageMs < 14400000, "2–4h", "4h+"),
    generationBand = case(isnull(generation) or generation < 1, "(missing)", generation == 1, "1", "2+"),
    lifecycleKind = coalesce(failureKind, "(missing)")
| summarize operations = count(),
    successfulClusterExpansionsOnReplacement = countif(
        family == "getchildren" and tolower(parentContext) matches regex @"\btreeitem_documentdbcluster\b"
        and operationResult == "succeeded" and generation >= 2 and not(recoveryRows))
    by version, family, ageBand, generationBand, operationResult, lifecycleKind, signature
| order by family asc, ageBand asc, generationBand asc
```

## Comparable late failures before and after release

The baseline lacks client age and generation. Compare the same database RPC scopes in versions
that report the same `causeType` scheme. Do not use tree `connect` or expansion counts for this
comparison: their redaction and reporting of failures as recovery rows make the cohorts
incomparable. These are rates of reported RPC failure signatures, not all database failures.

Use the **same exposure on both versions**: recorded non-canceled calls to each selected
procedure at least one hour after the most recent preceding successful database startup in a
VS Code session whose successful startups all used Entra ID. Only existing session metadata
is used; no session key or raw failure data is returned. The warmup is identical for both cohorts.
This is a session-age proxy, not per-client age or a causal estimate.

```kusto
let Startups = materialize(
    Events
    | where eventScope == "connect.startup" and tostring(customDimensions.startupOutcome) =~ "succeeded"
    | extend sessionKey = coalesce(tostring(customDimensions.VSCodeSessionId),
        tostring(customDimensions["common.vscodesessionid"])),
        authMethod = tostring(customDimensions.authMethod)
    | where isnotempty(sessionKey)
    | project cohort, version, sessionKey, startupAt = timestamp, authMethod
);
let EntraSessions =
    Startups
    | summarize otherAuth = countif(authMethod !~ "MicrosoftEntraID") by cohort, version, sessionKey
    | where otherAuth == 0
    | project cohort, version, sessionKey;
Operations
| where operationResult in ("succeeded", "failed")
| where eventScope in ("documentdb.rpc.query.mongoclusters.collectionview.runfindquery",
    "documentdb.rpc.query.mongoclusters.documentview.getdocumentbyid")
| extend sessionKey = coalesce(tostring(customDimensions.VSCodeSessionId),
    tostring(customDimensions["common.vscodesessionid"]))
| where isnotempty(sessionKey)
| project cohort, version, sessionKey, timestamp, eventScope, operationResult, signature
| serialize operationRow = row_number()
| join kind=inner (Startups | join kind=leftsemi (EntraSessions) on cohort, version, sessionKey)
    on cohort, version, sessionKey
| where startupAt <= timestamp
| summarize arg_max(startupAt, *) by operationRow
| where timestamp - startupAt >= 1h
| summarize exposureOperations = count(),
    failedOperations = countif(operationResult == "failed"),
    lateAuth = countif(signature == "auth"),
    lateSocket = countif(signature == "socket"),
    lateClosedClient = countif(signature == "closedClient"),
    otherOrUnclassified = countif(signature == "otherOrUnclassified")
    by cohort, version, eventScope
| extend authPer1000 = 1000.0 * lateAuth / exposureOperations,
    socketPer1000 = 1000.0 * lateSocket / exposureOperations,
    closedClientPer1000 = 1000.0 * lateClosedClient / exposureOperations
| order by eventScope asc, cohort asc
```

Compare the same procedure across cohorts and inspect counts, including unclassified failures,
alongside rates. Missing exposure, or cohorts without comparable signatures, are insufficient
evidence, not zero failures.

## ARM challenge versus final operation result

Use the existing Azure SDK challenge dimensions and the final framework `result` on the **same**
event. A token was acquired when `challengeSuccess=true`; count `true` with `succeeded` separately
from `true` with `failed`, `canceled`, or a missing result. For a scope that wraps multiple requests
or both ARM and database work, this is the enclosing operation's result, not a per-request ARM
status. Use an ARM-only single-request scope when verifying that ARM accepted the retried request.
Zero observed challenges is inconclusive.

```kusto
Events
| where inWindow and tostring(customDimensions.challenge) =~ "true"
| extend challengeOutcome = tolower(tostring(customDimensions.challengeSuccess))
| extend challengeOutcome = case(challengeOutcome == "true", "tokenAcquired",
    challengeOutcome == "false", "noToken", "(missing)"),
    finalResult = coalesce(sdkResult, "(missing)")
| summarize challengedOperations = count()
    by cohort, version, day = bin(timestamp, 1d), eventScope, challengeOutcome, finalResult
| order by day asc, eventScope asc
```
