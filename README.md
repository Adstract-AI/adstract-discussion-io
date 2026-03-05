<h1 style="display:flex;align-items:center;gap:12px;">
  <img src="./public/discuss-io-logo.png" alt="Discussion.IO Logo" width="40" />
  <span>Discussion.IO</span>
</h1>

Discussion.IO is a Chrome Extension (Manifest V3) for helping students participate in live BigBlueButton discussions.

It captures recent chat context, infers the likely discussion question, and helps draft concise participation messages directly into BBB chat.

## Purpose

This tool is built for educational support during live class discussions:

- help users understand current discussion context
- reduce friction when writing responses
- support participation with suggestions and follow-up questions
- keep full discussion/session history locally for review

It is not a tool for academic misconduct. Users are responsible for using it according to institutional policies.

## Who Is Behind This

<p align="left">
  <img src="./public/adstract-logo.png" alt="Adstract Logo" width="150" />
</p>

Discussion.IO is an experimental project by **Adstract**.

Adstract focuses on AI-native infrastructure and conversational systems.  
Learn more: [https://www.adstract.ai](https://www.adstract.ai)

## Current Capabilities

- Manual context capture (no always-on live listening)
- Session-based workflow:
  - create, end, restore, delete sessions
  - browse old sessions in read-only mode
- Discussion flow:
  - analyze last X chat messages
  - proceed as new discussion or continue previous discussion
  - participation options:
    - don’t participate
    - get suggestion
    - get similar question
- AI settings:
  - model selection (`gpt-5.2`, `gpt-5.3-chat-latest`, `gpt-5-mini`, `gpt-5-nano`)
  - language selection
  - prompt semantics editing

## Supported Pages

The extension is scoped to BBB join URLs only:

- `https://bbb-23.finki.ukim.mk/html5client/join*`
- `https://bbb-24.finki.ukim.mk/html5client/join*`

On unsupported pages, controls are disabled and a compatibility warning is shown.

## Tech Stack

- React + TypeScript + Vite

## Quickstart (Local)

### 1) Install dependencies

```bash
npm install
```

### 2) Build extension

```bash
npm run build
```

### 3) Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder from this project

### 4) Test on BBB

1. Open a supported BBB join URL
2. Open the extension popup
3. Create a session
4. Configure API key in Settings > AI
5. Click Analyze Discussion and continue flow

## Basic User Flow

1. Open popup on supported BBB page
2. Accept Legal (Terms + Privacy) on first gated action
3. Create session
4. Analyze Discussion (captures configured context window)
5. Choose:
   - Proceed to New Discussion
6. Use participation actions or write manually
7. Confirm send with `Enter`, then `Enter` again
8. Review history in Sessions

## Data and Privacy Notes

- Session/discussion history is stored locally in browser extension storage.
- AI requests are sent to OpenAI only when you configure an API key and invoke AI actions.
- See:
  - [`TERMS_OF_SERVICE.md`](TERMS_OF_SERVICE.md)
  - [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md)

## Status

This is an active experimental project and UX/workflow details are evolving quickly.

## Community Contribution and Disclaimer

Anyone can participate in this project by contributing through the repository and implementing their own features, improvements, and experiments.

By using this repository, you acknowledge that **Adstract is not responsible or liable for anything in or outside of this repository**, including any code, integrations, modifications, usage outcomes, or third-party effects.
