# BigBlueButton Discussion Assistant Chrome Extension

## Overview

Build a **Chrome Extension (Manifest V3)** that acts as a **discussion assistant for BigBlueButton (BBB) sessions**.

The project already contains:

- React
- Vite
- TypeScript
- `@crxjs/vite-plugin`
- a basic `manifest.json`

Your task is to implement the **extension architecture and chat-monitoring system**.

---

# Goal

The extension monitors the **BigBlueButton chat during a live session**, detects when the **professor asks a question**, analyzes the **responses from students**, and generates a **new synthesized response** that can be inserted into the chat input.

The extension should:

1. Observe chat messages in real time
2. Extract structured messages
3. Detect professor questions
4. Collect answers from participants
5. Generate a synthesized answer
6. Autofill the chat input field

⚠️ The extension should **NOT send messages automatically yet** — only autofill.

---

# Architecture

The extension consists of **three main components**.

## 1. Content Script

Runs **inside the BigBlueButton page**.

### Responsibilities

- Detect the chat container
- Observe new chat messages using `MutationObserver`
- Extract message data:
  - username
  - message text
  - timestamp (if available)
- Send structured messages to the background service worker
- Receive generated responses from the background script
- Autofill the chat input field

### Location

 - src/content/content.ts
---

## 2. Background Service Worker

Acts as the **logic layer of the extension**.

### Responsibilities

- Maintain chat state
- Detect questions
- Aggregate responses
- Generate synthesized answers
- Send generated responses back to the content script

### Location

- src/background/background.ts

---

## 3. Popup UI (React)

Provides a **minimal debugging interface**.

### Responsibilities

Display:

- extension status
- last detected question
- number of collected responses
- generated answer preview

### Location

- src/popup/Popup.tsx

---

# Chat Message Model

Create a message interface containing:

- `id`
- `username`
- `text`
- `timestamp`

Example structure:

ChatMessage
	•	id: string
	•	username: string
	•	text: string
	•	timestamp: number

---

# Question Detection

A message is considered a **question** if:

- it comes from the **professor**
- it contains a **question mark**
- OR it begins with question words such as:
    - what
    - why
    - how
    - which
    - who
    - when

### Professor Detection

The professor can be detected by:

- username patterns:
  - `prof`
  - `teacher`
  - `dr`
- OR configurable later in the popup UI.

---

# Question Thread Model

Maintain a thread structure containing:

- the **question message**
- a list of **answer messages**
- a **start timestamp**

### Logic

1. When a professor asks a question → create a new thread
2. Collect answers from students
3. Stop collecting answers when:
   - a **new professor question appears**
   - OR **60 seconds pass**

---

# Answer Generation

Implement a **simple synthesis algorithm**.

### Input

- question
- list of answers

### Algorithm

1. Remove duplicate answers
2. Extract key sentences
3. Generate a summarized response combining the main ideas

Example output format:



> "Several participants mentioned that X and Y. The main idea is that ..."

⚠️ Do **NOT call external APIs yet**.

Create a summarizer module at:

src/background/summarizer.ts

---

# Message Flow

### Content Script

1. Observe DOM mutations in the chat container
2. Detect new chat messages
3. Parse message content
4. Send messages to the background service worker

### Background Service Worker

1. Receive chat messages
2. Update question threads
3. Detect when enough answers are collected
4. Generate summarized response
5. Send generated response back to the content script

### Content Script

1. Receive generated response
2. Insert response into chat input field

---

# Chat Input Autofill

The content script should:

1. Find the chat input textarea
2. Insert the generated response
3. Trigger the correct input event so BBB detects the change

⚠️ Do **NOT automatically submit the message**.

---

# DOM Monitoring

Use `MutationObserver` to detect new messages.

### Requirements

- Ignore system messages
- Ignore duplicates
- Assign unique message IDs
- Maintain internal message log

---

# Extension Messaging

Use:

- `chrome.runtime.sendMessage`
- `chrome.runtime.onMessage`

Define message types such as:

- NEW_CHAT_MESSAGE
- NEW_QUESTION
- GENERATED_RESPONSE

---

# Project Folder Structure

src
│
├── background
│   ├── background.ts
│   └── summarizer.ts
│
├── content
│   ├── content.ts
│   └── chatParser.ts
│
├── popup
│   └── Popup.tsx
│
├── types
│   └── chat.ts


---

# Performance Requirements

The extension must:

- Handle **100+ chat messages**
- Avoid memory leaks
- Use an efficient `MutationObserver`
- Avoid repeatedly scanning the entire DOM

---

# Error Handling

Handle cases where:

- chat container cannot be found
- chat input cannot be found
- duplicate messages appear

Retry DOM lookup periodically if necessary.

---

# Debug Logging

Use structured logs with prefixes:

- [ContentScript]
- [Background]
- [Parser]

Enable verbose logging in development.

---

# Manifest Requirements

Ensure the extension manifest includes:

- background service worker
- content script
- permissions:
  - `storage`
  - `activeTab`
  - `scripting`

---

# Deliverables

Implement the following components:

1. Chat DOM observer
2. Message extraction system
3. Background messaging pipeline
4. Question detection
5. Answer aggregation
6. Response summarization
7. Chat input autofill
8. Popup debugging interface

---

# Implementation Requirements

- All code must be written in **TypeScript**
- Code should be **modular and well structured**
- Avoid fragile selectors where possible
- Write **clean, typed, maintainable code**

The implementation should be **production-quality** and robust against minor DOM structure changes.
