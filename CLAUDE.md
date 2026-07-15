# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

A monorepo of independent Claude API quickstart projects. Each subdirectory is a self-contained demo with its own dependencies, stack, and README. Projects do not share code across directories.

| Project | Stack | Purpose |
|---|---|---|
| `agents/` | Python | Minimal educational agent loop with tool use and MCP |
| `autonomous-coding/` | Python + Claude Agent SDK | Two-agent pattern for multi-session app generation |
| `browser-use-demo/` | Python + Playwright + Docker | Browser automation via DOM element references |
| `computer-use-best-practices/` | Python + pyautogui + Playwright | macOS desktop automation with caching/pruning patterns |
| `computer-use-demo/` | Python + Docker + Streamlit | Containerized desktop control via Claude computer use |
| `customer-support-agent/` | TypeScript + Next.js | Full-stack support agent web app |
| `financial-data-analyst/` | TypeScript + Next.js + Recharts | Financial chat with interactive visualizations |

## Legal

When changes are made to files that have a copyright notice, add them to that subdirectory's `CHANGELOG.md`.

## Architecture Patterns

### Python projects
- Tools inherit from `BaseAnthropicTool` (computer-use-demo) or are plain callables passed into agent loops
- Sampling loops call `client.messages.create` in a while loop, executing tools until no tool calls remain
- `computer-use-best-practices` uses prompt caching, interval-based image pruning, and batched tool calls (`computer_batch`, `browser_batch`) to reduce cost/latency
- `autonomous-coding` persists state across sessions via git commits and a JSON feature-list file; a security allowlist restricts bash commands

### TypeScript/Next.js projects
- API routes in `app/api/` call Claude using the Anthropic SDK server-side
- UI in `app/` uses shadcn/ui components and React hooks
- `customer-support-agent` supports three layout variants (left sidebar, right sidebar, chat-only) via separate npm scripts

## Computer-Use Demo

### Setup & Development

- **Setup environment**: `./setup.sh`
- **Build Docker**: `docker build . -t computer-use-demo:local`
- **Run container**: `docker run -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -v $(pwd)/computer_use_demo:/home/computeruse/computer_use_demo/ -v $HOME/.anthropic:/home/computeruse/.anthropic -p 5900:5900 -p 8501:8501 -p 6080:6080 -p 8080:8080 -it computer-use-demo:local`

### Testing & Code Quality

- **Lint**: `ruff check .`
- **Format**: `ruff format .`
- **Typecheck**: `pyright`
- **Run tests**: `pytest`
- **Run single test**: `pytest tests/path_to_test.py::test_name -v`

### Code Style

- **Python**: snake_case for functions/variables, PascalCase for classes
- **Imports**: Use isort with combine-as-imports
- **Error handling**: Use custom `ToolError` for tool errors
- **Types**: Add type annotations for all parameters and returns
- **Classes**: Use dataclasses and abstract base classes
- Signed commits required; pre-commit hooks enforce ruff + pyright

## Computer-Use Best Practices

### Setup & Development

- **Install dependencies**: `pip install -r requirements.txt` (Python 3.11+ required)
- **Run**: `python -m computer_use "<task>"`
- **Run tests**: `pytest`
- Requires macOS Screen Recording + Accessibility permissions; run in a VM

## Browser Use Demo

### Setup & Development

- **Run**: `docker-compose up --build` (requires Docker and `.env` with `ANTHROPIC_API_KEY`)
- Streamlit UI at `localhost:8080`, NoVNC at `localhost:6080`

## Autonomous Coding Agent

### Setup & Development

- **Install dependencies**: `pip install -r requirements.txt` and `npm install -g @anthropic-ai/claude-code`
- **Run**: `python autonomous_agent_demo.py --project-dir <dir>`

## Agents (Educational)

### Setup & Development

- **Install dependencies**: `pip install -r requirements.txt`
- See `agent_demo.ipynb` for usage examples

## Customer Support Agent

### Setup & Development

- **Install dependencies**: `npm install`
- **Run dev server**: `npm run dev` (full UI)
- **UI variants**: `npm run dev:left` (left sidebar), `npm run dev:right` (right sidebar), `npm run dev:chat` (chat only)
- **Lint**: `npm run lint`
- **Build**: `npm run build` (full UI), see package.json for variants

### Code Style

- **TypeScript**: Strict mode with proper interfaces
- **Components**: Function components with React hooks
- **Formatting**: Follow ESLint Next.js configuration
- **UI components**: Use shadcn/ui components library

## Financial Data Analyst

### Setup & Development

- **Install dependencies**: `npm install`
- **Run dev server**: `npm run dev`
- **Lint**: `npm run lint`
- **Build**: `npm run build`

### Code Style

- **TypeScript**: Strict mode with proper type definitions
- **Components**: Function components with type annotations
- **Visualization**: Use Recharts library for data visualization
- **State management**: React hooks for state
