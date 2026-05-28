> **User Manual** - [Back to User Manual](../index#user-manual)

---

# AI Performance Insights: Model and Billing

The **AI Performance Insights** feature in the Query Insights panel sends your query shape and execution statistics to a GitHub Copilot model and returns concrete optimization recommendations. This page explains which model is used, why it was chosen, what it costs, and how the extension is designed to keep that cost as low as possible.

**Table of Contents**

- [What is a utility model?](#what-is-a-utility-model)
- [Which model does the extension use?](#which-model-does-the-extension-use)
- [What does it cost?](#what-does-it-cost)
  - [Paid GitHub Copilot plans](#paid-github-copilot-plans)
  - [GitHub Copilot Free](#github-copilot-free)
  - [Enterprise and custom billing](#enterprise-and-custom-billing)
  - [A note on billing changes](#a-note-on-billing-changes)
- [How we optimize prompts for the utility model](#how-we-optimize-prompts-for-the-utility-model)
- [Which model was actually used?](#which-model-was-actually-used)
- [Further reading](#further-reading)

---

## What is a utility model?

GitHub Copilot offers a range of AI models with different capabilities, response speeds, and costs. At the top end sit frontier models designed for complex, multi-step reasoning. At the other end sit **utility (or included) models**: fast, efficient models that GitHub makes available to all plan holders without consuming any premium request quota.

As of mid-2026, GitHub designates several models as **included models** with a request multiplier of 0, meaning requests to them are covered by the plan subscription and do not draw down a user's monthly premium request allowance. Examples include GPT-4o, GPT-4.1, and GPT-5 mini.

> **Source**: [Requests in GitHub Copilot - Model multipliers](https://docs.github.com/en/copilot/concepts/billing/copilot-requests#model-multipliers)

The term "utility model" in this extension refers specifically to this tier: models suitable for well-structured, bounded tasks that do not require the depth of a frontier model, and that GitHub includes in every plan.

---

## Which model does the extension use?

The extension requests models through the [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model), the same stable API used by other VS Code extensions that integrate GitHub Copilot. It does not talk to the GitHub Copilot API directly.

The extension tries models in the following order, stopping at the first one available in your environment:

| Priority | Model family      | Notes                                                                    |
| -------- | ----------------- | ------------------------------------------------------------------------ |
| 1        | `gpt-4o`          | Preferred; strong reasoning, included on paid plans                     |
| 2        | `gpt-4o-mini`     | Fallback; faster, lighter, also included on paid plans                  |
| 3        | `copilot-utility` | Final fallback; the generic utility model exposed by the VS Code LM API |

The model that was ultimately selected for a response is shown in the **"Powered by"** byline that appears below the AI suggestions after a successful analysis.

If none of these models is available in your environment (for example, GitHub Copilot is not signed in, or your organization has disabled LM API access for extensions), the AI Performance Insights feature will not activate.

---

## What does it cost?

### Paid GitHub Copilot plans

For users on **Copilot Pro**, **Copilot Pro+**, **Copilot Business**, or **Copilot Enterprise**, GPT-4o, GPT-4.1, and GPT-5 mini all carry a **multiplier of 0**, meaning they do not consume any of your monthly premium request allowance. Running AI Performance Insights against your query costs nothing beyond your existing plan subscription.

This is by design. The extension specifically targets these low-cost models so that developers can run the analysis without worrying about depleting a finite credit pool.

### GitHub Copilot Free

If you are on **Copilot Free**, all chat-style AI interactions, including requests made by VS Code extensions via the Language Model API, count against your monthly allowance of **50 premium requests**. Copilot Free is intended as a trial tier; if you find yourself regularly using AI Performance Insights, upgrading to a paid plan removes the quota constraint.

### Enterprise and custom billing

Enterprise agreements, educational licences, and reseller-managed accounts may have different billing terms than the standard plans described above. If your organization has enabled custom usage controls, the AI Performance Insights requests will follow whatever policy your Copilot administrator has set. Check with your GitHub organization owner or Copilot administrator if you are unsure.

### A note on billing changes

GitHub began migrating all Copilot plans from **request-based billing** (a fixed number of premium requests per month) to **usage-based billing** (GitHub AI Credits, where 1 credit = $0.01 USD) in June 2026.

Under usage-based billing, the cost of a model interaction depends on the number of tokens consumed and the per-token rate for the model used. Included models (such as GPT-4o) continue to have a 0 multiplier, which under the AI Credits system means their per-token cost is zero, effectively free to use for paid subscribers, as it was under the earlier request model.

The extension targets the lightest capable model and minimises tokens per request, keeping costs neutral under both billing systems.

> **Source**: [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)

---

## How we optimize prompts for the utility model

Utility models are fast and cost-efficient, but they have smaller context windows and narrower reasoning budgets than frontier models. The extension is built around these constraints:

**We send the minimum necessary context.**
The prompt contains only the query shape (operator structure, without actual data values), the execution plan summary, index usage statistics, and collection metadata. No document contents are ever sent. This keeps the prompt small and focused, well within the context window of the models we target.

**We use structured prompts with a clear task boundary.**
Each request is formatted as a compact JSON block with labelled sections: query, plan, statistics, collection info. Structured input helps lightweight models parse and use context efficiently without a lengthy preamble.

**We target the model's context window.**
The extension reads `maxInputTokens` from the selected model's metadata and uses it to enforce a hard ceiling on prompt size. If the query plan or statistics exceed the budget, they are truncated before the request is sent, ensuring the model always receives a syntactically complete, well-formed prompt rather than a truncated one.

**We ask for a bounded, machine-readable response.**
The response format requested is a structured JSON object with a defined schema (recommendations, severity, rationale). Asking for a short, structured response rather than an open-ended essay keeps output token usage predictable and reduces the chance of drift on smaller models.

**We fall back gracefully.**
If the preferred model is not available, the extension steps down to the next lightest available model. The fallback chain (GPT-4o → GPT-4o-mini → copilot-utility) is ordered so that the cheapest capable model is always preferred over a more expensive one.

---

## Which model was actually used?

After a successful AI analysis, a small **"Powered by"** byline appears at the bottom of the results panel:

> _No additional cost for most GitHub Copilot subscribers. [Learn more about the utility model used.](../user-manual/ai-utility-model)_
> _Powered by copilot-gpt-4o via GitHub Copilot_

The model identifier shown there is the exact `id` returned by the VS Code Language Model API for the model that handled your request. It reflects the actual model used (not a pre-invocation guess), so you always know what processed your query.

---

## Further reading

- [Requests in GitHub Copilot](https://docs.github.com/en/copilot/concepts/billing/copilot-requests): GitHub's authoritative reference for request types, model multipliers, and plan allowances
- [Plans for GitHub Copilot](https://docs.github.com/en/copilot/get-started/plans): Compare what is included in each plan
- [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals): How AI Credits work under the June 2026 billing model
- [Usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises): The same for Business and Enterprise plans
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model): The stable API this extension uses to talk to Copilot
