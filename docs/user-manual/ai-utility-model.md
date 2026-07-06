> **User Manual** - [Back to User Manual](../index#user-manual)

---

# AI Features: Utility Model and Pricing

The AI-assisted features in this extension, such as AI Performance Insights in the Query Insights panel, use GitHub Copilot to analyse your queries and return optimization recommendations. All of these features are designed to be **cost-neutral for most GitHub Copilot subscribers**: they exclusively use utility (included) models that do not consume your monthly premium request allowance.

**Table of Contents**

- [Utility Model Pricing](#utility-model-pricing)
- [Which model does the extension use?](#which-model-does-the-extension-use)
- [Which model was actually used?](#which-model-was-actually-used)
- [Further reading](#further-reading)

---

## Utility Model Pricing

The extension targets utility models specifically because they are **included in all paid GitHub Copilot plans at no extra charge**.

### What GitHub documents about utility model pricing

GitHub designates a set of models as **included models** with a request multiplier of **0x**. Requests to these models do not consume your monthly premium request allowance. The exact set of included models changes over time as GitHub updates its lineup, but the `copilot-utility` alias always resolves to a current included model.

> **Source**: [Requests in GitHub Copilot - Model multipliers](https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers)

Under the usage-based billing model that GitHub began rolling out in June 2026, included models continue to have a 0x per-token rate, effectively free to paid subscribers, as they were under the earlier request model.

> **Source**: [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)

### What this means for each plan

| Plan                                        | Cost of AI features                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Copilot Pro, Pro+, Business, Enterprise** | No additional cost; all preferred models are 0x multiplier                                                                                  |
| **Copilot Free**                            | Counts against your 50 monthly premium requests; the extension tries to use 0x models, but Copilot Free may route some requests differently |
| **Enterprise / custom agreements**          | Follows your organization's Copilot billing policy; check with your Copilot administrator if unsure                                         |

### The disclosure label in the extension

The cost-neutral disclosure row that appears in AI results panels ("No additional cost for most GitHub Copilot subscribers") reflects the 0x multiplier designation described above. We say "most" rather than "all" because enterprise agreements, educational licences, and reseller-managed accounts may have different terms.

### A note on billing changes

GitHub's billing model is evolving. If GitHub changes the pricing tier for the `copilot-utility` alias or the models it resolves to, we will update both the extension and this page. Follow the [Further reading](#further-reading) links below for the latest GitHub documentation.

---

## Which model does the extension use?

The extension requests the **`copilot-utility` model alias** from the VS Code Language Model API. This alias is GitHub Copilot's stable, version-independent way of pointing third-party extensions at an included (0x multiplier) model. GitHub Copilot resolves the alias to whichever current model it considers best for structured, bounded tasks (query analysis, index recommendations, and similar workloads) and updates that mapping transparently as its lineup evolves.

This design is intentional: by targeting the alias rather than a specific model family, the extension always routes to a cost-neutral model without needing to be updated every time GitHub refreshes its model lineup. GitHub's own guidance for third-party extensions recommends this approach.

> **See also**: [GitHub Copilot utility models](https://docs.github.com/en/copilot/concepts/models/utility-models)

If the `copilot-utility` alias is not available in your environment (for example, GitHub Copilot is not signed in, or your organization has disabled LM API access for third-party extensions), the AI features will not activate.

---

## Which model was actually used?

After a successful AI analysis, a small **"Powered by"** byline appears at the bottom of the results panel:

> _No additional cost for most GitHub Copilot subscribers. [Learn more about the utility model used.](https://aka.ms/vscode-documentdb-copilot-utility-model)_
> _Powered by GPT-4o via GitHub Copilot_

The name shown is the human-readable display name of the model that actually produced the response, not a pre-invocation guess. The stable internal identifier (e.g. `copilot-gpt-4o`) is captured in the extension's output channel and telemetry for diagnostics.

The underlying model backing the `copilot-utility` alias is chosen by GitHub Copilot and may differ between environments or over time. The byline always reflects whichever model actually produced the response, so it is the authoritative record of what ran, regardless of what the alias resolved to.

---

## Further reading

- [Requests in GitHub Copilot](https://docs.github.com/en/copilot/concepts/billing/copilot-requests): GitHub's authoritative reference for request types, model multipliers, and plan allowances
- [Plans for GitHub Copilot](https://docs.github.com/en/copilot/get-started/plans): Compare what is included in each plan
- [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals): How AI Credits work under the June 2026 billing model
- [Usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises): The same for Business and Enterprise plans
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model): The stable API this extension uses to talk to Copilot
