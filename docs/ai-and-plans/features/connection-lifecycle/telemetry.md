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
let BaselineVersion = "1.1.1";
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
    | extend family = case(
        eventScope == "connect", "connect",
        eventScope startswith "documentdb.rpc.", "rpc",
        (eventScope == "getchildren" or eventScope endswith ".getchildren")
            and isnotempty(tostring(customDimensions.parentNodeContext))
            and tostring(customDimensions.parentNodeContext) !~ "root"
            and tostring(customDimensions.usedCachedErrorNode) !~ "true", "getchildren",
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
             failureType = coalesce(tostring(customDimensions.causeType), tostring(customDimensions.error)),
             failureMessage = tostring(customDimensions.errorMessage)
    | extend signature = case(
        operationResult != "failed", "",
        failureType in~ ("18", "391", "AuthenticationFailed", "Unauthorized",
            "EntraSignInRequiredError", "EntraIdentityMismatchError"), "auth",
        failureType in~ ("MongoNotConnectedError", "MongoTopologyClosedError"), "closedClient",
        failureType in~ ("MongoNetworkError", "MongoNetworkTimeoutError", "ECONNRESET", "EPIPE")
            or failureMessage matches regex @"(?i)\bconnection \d+ to .+ closed\b", "socket",
        "otherOrUnclassified");
```

## Daily database token lookups and lifetime

`connection.tokenRenewal` counts completed post-startup Entra database token lookups on the extension,
Shell, and Playground. `returned` means a token passed the callback's checks; it does **not** mean the
token changed, MSAL made a network request, or the database accepted the token. Lifetime is the
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

Successes on generation 2 or above show the replacement served an operation; they are not a count
of unique recoveries or proof that renewal triggered recovery. Show missing age and generation
explicitly: not every operation has a published client to report. `transient` is broader than
socket failures, so this drilldown keeps the lifecycle kind and the comparable signature separate.

```kusto
Operations
| where cohort == "after"
| extend ageBand = case(
    isnull(ageMs) or ageMs < 0, "(missing)",
    ageMs < 3600000, "<1h", ageMs < 7200000, "1–2h", ageMs < 14400000, "2–4h", "4h+"),
    generationBand = case(isnull(generation) or generation < 1, "(missing)", generation == 1, "1", "2+"),
    lifecycleKind = coalesce(failureKind, "(missing)")
| summarize operations = count(),
    successfulOnReplacement = countif(operationResult == "succeeded" and generation >= 2)
    by version, family, ageBand, generationBand, operationResult, lifecycleKind, signature
| order by family asc, ageBand asc, generationBand asc
```

## Comparable late failures before and after release

The baseline lacks client age and generation. Use the **same exposure on both versions**: recorded
non-canceled operations at least one hour after the most recent preceding successful database
startup in a VS Code session whose successful startups all used Entra ID. Only existing session
metadata is used for this historical attribution; no session key or raw failure data is returned.
The warmup is the same on both sides. This is a session-age proxy, not a per-client age or a causal
estimate. It can miss sparse telemetry, mixed-auth sessions, and versions that don't report the
same failure signatures. Do not mix new lifecycle-only classifications into the comparison.

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
| extend sessionKey = coalesce(tostring(customDimensions.VSCodeSessionId),
    tostring(customDimensions["common.vscodesessionid"]))
| where isnotempty(sessionKey)
| project cohort, version, sessionKey, timestamp, family, operationResult, signature
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
    by cohort, version, family
| extend authPer1000 = 1000.0 * lateAuth / exposureOperations,
    socketPer1000 = 1000.0 * lateSocket / exposureOperations,
    closedClientPer1000 = 1000.0 * lateClosedClient / exposureOperations
| order by family asc, cohort asc
```

Compare like families and inspect counts along with rates. A missing cohort/family or no later
operations is insufficient exposure, not a zero failure rate.

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
