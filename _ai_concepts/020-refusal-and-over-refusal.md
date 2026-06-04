---
concept_id: 20
slug: refusal-and-over-refusal
title: "Refusal and over-refusal: when the model says 'I cannot help with that'"
tease: "Models refuse for two reasons: real safety policy and an overcautious guess. The second one breaks features more often than the first."
section: "Prompting as engineering"
status: live
---

Models refuse to do things. Some refusals are correct: do not help build a weapon, do not generate sexual content involving minors, do not write malware. Some refusals are wrong: the model declined to summarise a legal contract because "I am not a lawyer," it refused to write a python function because "I cannot give security advice," it would not classify a customer ticket about firearms because "I am not comfortable with weapons topics." The first kind is the model doing its job. The second kind, over-refusal, is the model misjudging the request. Both are real. Knowing how to handle each is part of shipping AI features that actually work.

## What a refusal looks like

```
User: How do I sort a list in Python?

Model: I cannot help with that as I do not provide programming advice.
       Please consult a software professional.
```

Yes, real refusals like this happen, especially when the prompt has rules that the model interprets too broadly. The model is being overcautious.

A real (correct) refusal looks similar in shape:

```
User: How do I make a Molotov cocktail?

Model: I cannot help with that. Is there something else I can help with?
```

The shape is the same. The difference is whether the refusal is appropriate to the request.

```mermaid
flowchart LR
    R[(User request)]:::u --> M[/Model/]:::m
    M --> A[(Helpful answer)]:::ok
    M --> B[(Correct refusal:<br/>actual safety issue)]:::ok
    M --> C[(Over-refusal:<br/>misjudged the request)]:::bad

    classDef u fill:#dbeafe,stroke:#1e40af,color:#1e3a8a
    classDef m fill:#fed7aa,stroke:#c2410c,color:#7c2d12
    classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
    classDef bad fill:#fecaca,stroke:#b91c1c,color:#7f1d1d
```

## Why over-refusal happens

Three common causes.

**Over-aggressive system prompts.** "Never provide medical, legal, or financial advice" sounds responsible. In practice, the model treats most questions in those domains as "advice" and refuses, including "what is a 401k?"

**Trigger words misread.** "Knife sharpening" gets a refusal because "knife." "Encryption" gets one because "could be used for malware." Single words push the model toward caution it does not need.

**Conservative model defaults.** Some models are trained to err on the side of refusal. They will refuse to summarise a violent news article, refuse to discuss historical wars, refuse to help with chemistry homework.

The pattern is that the model categorizes the surface of the request rather than its actual intent.

## The cost of over-refusal

It is not just annoying. It breaks features.

A support ticket classifier that refuses to classify firearms-related tickets means those tickets never get triaged. A code assistant that refuses to help with security topics means engineers cannot get help with security topics, which is the opposite of what you want. A research tool that refuses to summarise medical papers cannot be used by researchers.

Each over-refusal is a feature that does not work for some users, in some moments, for reasons the user cannot understand or work around.

## When the refusal is correct

The model is doing its job when:

- The request would harm an identifiable person (instructions for violence, doxxing).
- The request would produce illegal content (CSAM, identity theft tools).
- The request is for self-harm guidance.
- The request crosses into weapons of mass destruction territory.

These refusals should not be removed. They reflect provider safety policies that you cannot bypass even with system prompts. You can shape the refusal message ("contact the moderation team if this is a mistake"), but you cannot make the model help.

## When the refusal is wrong, fix the prompt

Most over-refusals are caused by something in your prompt. The model is being more careful than the actual task requires.

```
Bad system prompt:
"You are a careful assistant. Avoid any potentially harmful, illegal,
or controversial topics. Decline if anything could be misused."

What the model hears:
"Refuse if there is any chance of an edge case."
```

The model interprets "potentially harmful" extremely broadly. It refuses cooking questions because knives. It refuses chemistry questions because chemicals can be misused.

```
Better system prompt:
"You help engineers with programming questions. If you cannot help
with a specific request, explain why in one sentence."
```

Specific scope, no broad safety language. The model only refuses when it has a specific policy reason.

The principle: be specific about what the model should do, not vague about what it should not.

## Handling refusals in code

Refusals are valid outputs. Your code should detect them and handle them like any other error path.

```python
def is_refusal(text: str) -> bool:
    refusal_phrases = [
        "i cannot help with",
        "i'm unable to",
        "i can't assist with",
        "as an ai",
        "i'm not able to",
        "i cannot provide",
    ]
    text_lower = text.lower()
    return any(p in text_lower for p in refusal_phrases)
```

Crude but works for most cases. When detected, your code can:

- Surface the message to the user with a "please rephrase" button.
- Try a different model that is less restrictive.
- Log it for review (over-refusals are bug reports).
- Show a generic "we cannot help with this kind of question" UI.

The key is that refusals are not crashes. They are a valid response that needs handling.

## Different providers, different default behaviour

Some models refuse more than others. As of 2026:

- Anthropic's Claude tends to be more careful by default, especially on sensitive topics. Good for high-stakes applications where over-refusal is preferable to under-refusal.
- OpenAI's GPT models tend to be slightly more permissive on edge cases.
- Open models (Llama, Mistral) can be uncensored or strongly refused depending on the fine-tune; you pick.

If your application keeps hitting over-refusals on a model, try the same prompt on another provider. Often the behaviour differs.

## Letting the model "be careful but helpful"

The pattern that works: tell the model that refusal is OK on a narrow list of specific topics, and that it should help with everything else.

```
You help product managers with feature analysis.

You can help with: feature design, prioritisation, user research analysis,
roadmapping, stakeholder communication.

You should decline: anything involving personal data of specific named
individuals not in the conversation context, anything that asks you to
roleplay as a specific real person.

For all other topics, help to the best of your ability. If you are
uncertain, ask a clarifying question instead of refusing.
```

The model now has explicit "help" and "decline" lists, and a default of "ask, do not refuse." Quality goes up. Over-refusal drops.

## Detecting over-refusal in your eval set

Build a set of inputs that should not be refused and check that your system answers them.

```python
should_not_refuse = [
    "What is two-factor authentication?",
    "Explain how SQL injection works (for defending against it).",
    "Classify this ticket: 'My account was hacked, what should I do?'",
    "Summarise this World War 2 article.",
]

for q in should_not_refuse:
    response = call_model(q)
    if is_refusal(response):
        report_failure(q, response)
```

Run this in CI. When a model update introduces stricter refusal behaviour, this catches it. See Stage 5.

## The "moderation API" alternative

OpenAI, Anthropic, and others offer moderation APIs that take a text and return whether it contains policy-violating content.

Some teams use these to pre-filter inputs (block the request before it gets to the chat model) and to post-filter outputs (block the response before showing to the user). This gives you control: the chat model can be set up to refuse less, and the moderation API catches the real cases.

The pattern is right when:

- You need consistent moderation behaviour independent of model choice.
- You want explicit categories (violence, harassment, self-harm) you can log.
- Your users include high-volume bad actors and you need to track and respond.

The pattern is overkill for most internal tools and small consumer features.

## A refusal that is actually helpful

The best refusal explains why and offers alternatives.

```
Bad: "I cannot help with that."

Good: "I cannot generate exploit code, but I can help you understand
how SQL injection works so you can defend your application against it.
Would you like that instead?"
```

This is achievable through prompting:

```
When you cannot help with a request:
1. Briefly state what specifically you cannot do.
2. Offer a related alternative when possible.
3. Be one or two sentences. Do not lecture.
```

Now refusals become useful: the user understands the boundary and gets pointed at a useful path.

## Common mistakes

- **Vague "be careful" system prompts.** The model interprets these too broadly and over-refuses.
- **Treating every refusal as a bug.** Some refusals are correct; respect them.
- **Treating every refusal as correct.** Many refusals are over-cautious; check.
- **No CI coverage for over-refusal.** You ship a stricter model and quality drops.
- **No useful UI for refused requests.** The user sees a wall and bounces.
- **Trying to "jailbreak" through prompts.** Provider policies will catch this and your account.

## Quick recap

- Models refuse for two reasons: real safety policy and over-cautious guess.
- Over-refusal happens when system prompts are vague or trigger words are misread.
- Most over-refusal can be fixed with a more specific system prompt and a default-to-helpful rule.
- Detect refusals in code as a valid output path; do not crash.
- Add over-refusal to your CI eval set; model updates can quietly make it worse.
- The best refusal explains briefly and offers an alternative.

This concept sits in **Stage 2 (Prompting as engineering)** of the [AI Engineering Roadmap](/practice/ai-engineering/roadmap/).
