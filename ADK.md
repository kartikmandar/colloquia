# Google Agent Development Kit (ADK) - Comprehensive Guide

**Last Updated:** March 2026
**Version:** Latest (as of 2026)

---

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Core Concepts & Architecture](#core-concepts--architecture)
4. [Agent Types](#agent-types)
5. [Installation Guide](#installation-guide)
6. [Quick Start](#quick-start)
7. [Building Agents](#building-agents)
8. [Tools & Integrations](#tools--integrations)
9. [Multi-Agent Systems](#multi-agent-systems)
10. [Model Support](#model-support)
11. [Deployment](#deployment)
12. [Evaluation & Testing](#evaluation--testing)
13. [Observability & Monitoring](#observability--monitoring)
14. [Advanced Topics](#advanced-topics)
15. [Best Practices](#best-practices)
16. [Resources & References](#resources--references)

---

## Overview

**Agent Development Kit (ADK)** is a flexible, modular, open-source framework for building, evaluating, and deploying sophisticated AI agents with control and flexibility. Designed to make agent development feel like software development, ADK enables developers to create, orchestrate, and deploy agentic architectures ranging from simple tasks to complex multi-agent workflows.

### Key Philosophy

ADK emphasizes:
- **Code-First Development** - Direct control and transparency in agent logic
- **Developer Experience** - Streamlined tools and intuitive APIs
- **Production Readiness** - Built for scalable, observable deployment
- **Framework Flexibility** - Model-agnostic and deployment-agnostic architecture
- **Developer Productivity** - From concept to production in minimal time

### Primary Use Cases

- Autonomous research assistants
- Multi-step workflow automation
- Complex reasoning tasks with tool integration
- Voice-powered AI applications (via Gemini Live API)
- Enterprise AI solutions
- Real-time interactive agents
- Knowledge management systems
- Code generation and execution

---

## Key Features

### 1. **Flexible Orchestration**
- **Workflow Agents**: Sequential, Parallel, and Loop patterns for deterministic pipelines
- **LLM-Driven Routing**: Dynamic agent routing via LlmAgent transfer for adaptive behavior
- **Hierarchical Composition**: Build complex systems from simpler agent components

### 2. **Multi-Agent Architecture**
- Compose specialized agents working together in hierarchical structures
- Delegate tasks between agents seamlessly
- Enable modular, scalable application design
- Support for agent-to-agent communication

### 3. **Rich Tool Ecosystem**
- **Pre-Built Tools**: Search, Code Execution, and more out-of-the-box
- **Custom Functions**: Integrate your own APIs and business logic
- **Agents as Tools**: Use other agents as tools within larger systems
- **Third-Party Integrations**: Direct integration with popular services
- **External Data**: Query databases, APIs, and knowledge bases

### 4. **Native Streaming Capabilities**
- Bidirectional streaming for real-time interactions
- Full support for Gemini Live API with audio and text
- Efficient token usage for long-running conversations
- Progressive response generation

### 5. **Multiple Language Support**
- Python (primary, most mature)
- TypeScript/JavaScript
- Go
- Java

### 6. **Developer Tools**
- **CLI Interface**: Interactive development environment
- **Browser-Based UI**: Visual agent development and testing
- **Local Development**: Test agents before deployment
- **Debugging Tools**: Trace execution and troubleshoot issues

### 7. **Built-in Evaluation Framework**
- Create multi-turn evaluation datasets
- Measure agent quality and performance
- Guide iterative improvements
- Systematic benchmarking

### 8. **Observability & Monitoring**
- OpenTelemetry integration for tracing
- Integration with Google Cloud Observability
- Support for Arize, Langfuse, and other platforms
- Comprehensive logging and instrumentation

### 9. **Flexible Deployment**
- Local execution
- Containerized deployment (Docker)
- Cloud Run integration
- Vertex AI Agent Engine (fully managed auto-scaling)
- Custom infrastructure support

---

## Core Concepts & Architecture

### Fundamental Building Blocks

#### **Agents**
The core worker unit in ADK, responsible for specific tasks:
- **LlmAgent**: Language model-powered reasoning and decision-making
- **SequentialAgent**: Execute tasks in order
- **ParallelAgent**: Execute multiple tasks simultaneously
- **LoopAgent**: Repeat tasks based on conditions
- **Custom Agents**: Extend `BaseAgent` for specialized logic

#### **Tools**
Extend agent capabilities beyond conversation:
- Interact with external APIs and services
- Search information and retrieve data
- Execute code and run computations
- Access databases and knowledge bases
- Trigger workflows and actions
- Call other agents

#### **Sessions & State**
Manage conversation context and data:
- **Session**: Maintains conversation history and context
- **Events**: Track agent actions and decisions
- **State**: Working memory for storing temporary data
- **Memory**: Persistent context across multiple sessions

#### **Callbacks**
Custom code execution at specific points:
- Run validation checks
- Log activity and metrics
- Modify behavior dynamically
- Integrate external systems
- Monitor execution flow

#### **Models**
Language model backends powering agents:
- Optimized for Google Gemini
- Support for Claude, GPT-4o, Mistral
- Custom model integration via LiteLLM
- Model fallback mechanisms

#### **Artifacts**
Generated content from agents:
- Text responses
- Code artifacts
- Structured outputs
- File generation

### Architectural Patterns

```
┌─────────────────────────────────────────────┐
│           User Application                   │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│      Agent Development Kit (ADK)             │
│  ┌─────────────────────────────────────┐   │
│  │    Agent Layer                       │   │
│  │  ├─ LLMAgent (reasoning)            │   │
│  │  ├─ WorkflowAgent (orchestration)   │   │
│  │  └─ CustomAgent (specialized)       │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │    Tools & Integration Layer        │   │
│  │  ├─ Search                          │   │
│  │  ├─ Code Execution                  │   │
│  │  ├─ Custom Functions                │   │
│  │  └─ Agent as Tool                   │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │    State & Session Management       │   │
│  │  ├─ Session Context                 │   │
│  │  ├─ Memory (persistent)             │   │
│  │  └─ Events Log                      │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │    Model Integration                │   │
│  │  ├─ Gemini (primary)                │   │
│  │  ├─ Claude, GPT-4o, Mistral        │   │
│  │  └─ Custom Models                   │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│    Runtime Environments                      │
│  ├─ Local Development                       │
│  ├─ Cloud Run                               │
│  ├─ Vertex AI Agent Engine                  │
│  └─ Custom Infrastructure                   │
└─────────────────────────────────────────────┘
```

---

## Agent Types

### 1. **LLM Agents (LlmAgent)**

Utilize Large Language Models for reasoning, planning, and dynamic decision-making.

**Characteristics:**
- Flexible and adaptive
- Understand natural language
- Reason through complex problems
- Dynamically decide on actions
- Learn from interaction context

**Best For:**
- Open-ended conversations
- Complex reasoning tasks
- Dynamic problem-solving
- Creative tasks
- Adaptive workflows

**Example Pattern:**
```python
from google.adk.agents import LlmAgent
from google.adk.tools import tool

@tool
def search_web(query: str) -> str:
    """Search the web for information"""
    pass

agent = LlmAgent(
    model="gemini-2.5-pro",
    tools=[search_web],
    system_prompt="You are a research assistant..."
)
```

### 2. **Workflow Agents**

Deterministic, structured execution following predefined patterns.

#### **SequentialAgent**
Execute tasks one after another in order.

**Use Cases:**
- Linear workflows
- Step-by-step processes
- Dependent task execution
- Data pipelines

#### **ParallelAgent**
Execute multiple tasks simultaneously.

**Use Cases:**
- Independent task batch processing
- Concurrent operations
- Performance optimization
- Resource utilization

#### **LoopAgent**
Repeat tasks based on conditions.

**Use Cases:**
- Iterative refinement
- Retry logic
- Conditional processing
- Data processing loops

**Best For Workflow Agents:**
- Structured, predictable processes
- High reliability requirements
- Performance-sensitive operations
- Clear step-by-step logic

### 3. **Custom Agents**

Extend `BaseAgent` for specialized implementations.

**When to Use:**
- Unique operational logic
- Specialized integrations
- Performance optimization
- Domain-specific behavior

---

## Installation Guide

### Prerequisites

- Python 3.10+ (for Python SDK)
- Node.js 16+ (for TypeScript/JavaScript)
- Go 1.19+ (for Go SDK)
- Java 11+ (for Java SDK)
- A Google Cloud Project (for deployment features)
- API keys for selected models (Gemini, Claude, etc.)

### Python Installation

```bash
# Create virtual environment
python3 -m venv adk-env
source adk-env/bin/activate  # On Windows: adk-env\Scripts\activate

# Install ADK
pip install google-adk

# Verify installation
python -c "import google.adk; print('ADK installed successfully')"
```

### TypeScript/JavaScript Installation

```bash
# Create new project
mkdir my-adk-agent
cd my-adk-agent
npm init -y

# Install dependencies
npm install @google/adk @google/adk-devtools
npm install --save-dev typescript ts-node @types/node

# Initialize TypeScript
npx tsc --init
```

### Go Installation

```bash
# Create module
go mod init github.com/username/adk-agent

# Install ADK
go get google.golang.org/adk
```

### Java Installation

```xml
<!-- Add to pom.xml -->
<dependency>
    <groupId>com.google</groupId>
    <artifactId>adk</artifactId>
    <version>0.6.0</version>
</dependency>
```

Or for Gradle:

```gradle
dependencies {
    implementation 'com.google:adk:0.6.0'
}
```

### Environment Configuration

```bash
# Set up environment variables
export GOOGLE_API_KEY="your-gemini-api-key"
export GEMINI_API_KEY="your-gemini-api-key"

# For Claude
export ANTHROPIC_API_KEY="your-claude-api-key"

# For deployment
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

---

## Quick Start

### Create Your First Agent (Python)

#### Step 1: Set Up

```bash
# Create project directory
mkdir my-first-agent
cd my-first-agent

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install ADK
pip install google-adk
```

#### Step 2: Create Agent

Create `main.py`:

```python
import asyncio
from google.adk import agent as agent_lib
from google.adk.tools import google_search_tool

async def main():
    # Create agent with search capability
    my_agent = agent_lib.LlmAgent(
        model="gemini-2.5-flash",
        tools=[google_search_tool.GoogleSearchTool()],
        system_prompt="You are a helpful research assistant. Use the search tool to find current information."
    )

    # Run agent
    session = agent_lib.Session()
    response = await my_agent.run(
        session=session,
        input="What are the latest developments in AI in 2026?"
    )

    print(f"Agent Response: {response}")

if __name__ == "__main__":
    asyncio.run(main())
```

#### Step 3: Run

```bash
python main.py
```

### Quick Start with TypeScript

Create `agent.ts`:

```typescript
import { LlmAgent, Session } from "@google/adk";
import { GoogleSearchTool } from "@google/adk-tools";

async function main() {
  const agent = new LlmAgent({
    model: "gemini-2.5-flash",
    tools: [new GoogleSearchTool()],
    systemPrompt: "You are a helpful research assistant."
  });

  const session = new Session();
  const response = await agent.run({
    session,
    input: "What are the latest AI developments?"
  });

  console.log("Agent Response:", response);
}

main();
```

---

## Building Agents

### 1. Define System Prompt

```python
system_prompt = """
You are an expert research assistant specializing in machine learning and AI.
Your role is to:
- Analyze complex papers and research
- Break down technical concepts
- Provide citations and references
- Suggest related work

When answering questions:
1. Search for current information if needed
2. Cite your sources
3. Provide multiple perspectives
4. Suggest next steps for research
"""
```

### 2. Create Custom Tools

```python
from google.adk.tools import tool
import requests

@tool
def fetch_arxiv_paper(paper_id: str) -> str:
    """Fetch a paper from arXiv given its ID"""
    url = f"https://arxiv.org/abs/{paper_id}"
    response = requests.get(url)
    return response.text

@tool
def analyze_sentiment(text: str) -> dict:
    """Analyze sentiment of given text"""
    # Your sentiment analysis logic
    return {
        "sentiment": "positive",
        "score": 0.85,
        "key_phrases": []
    }

@tool
def database_query(query_type: str, params: dict) -> str:
    """Query internal database"""
    # Your database logic
    pass
```

### 3. Configure Agent

```python
from google.adk.agents import LlmAgent

agent = LlmAgent(
    model="gemini-2.5-pro",
    tools=[
        fetch_arxiv_paper,
        analyze_sentiment,
        database_query,
        # Include pre-built tools
        google_search_tool,
        code_execution_tool
    ],
    system_prompt=system_prompt,
    temperature=0.7,
    max_tokens=4096,
    # Callbacks for logging/monitoring
    callbacks=[logging_callback, monitoring_callback]
)
```

### 4. Create Session & Run

```python
from google.adk import Session

async def run_agent():
    session = Session()

    # First interaction
    response = await agent.run(
        session=session,
        input="Analyze the latest transformer architecture papers"
    )

    # Session maintains context
    response2 = await agent.run(
        session=session,
        input="Summarize the key differences you found"
    )

    return response, response2
```

### 5. Handle Agent Responses

```python
# Access response components
print(f"Main Response: {response.message}")
print(f"Tool Calls: {response.tool_calls}")
print(f"Artifacts: {response.artifacts}")

# Stream responses for long operations
async for chunk in agent.run_stream(
    session=session,
    input="Generate a comprehensive report..."
):
    print(chunk)
```

---

## Tools & Integrations

### Pre-Built Tools

#### **Google Search Tool**
```python
from google.adk.tools import google_search_tool

search = google_search_tool.GoogleSearchTool()
results = await search.search("climate change mitigation strategies")
```

#### **Code Execution Tool**
```python
from google.adk.tools import code_execution_tool

executor = code_execution_tool.CodeExecutionTool(language="python")
result = await executor.execute("import math; print(math.sqrt(16))")
```

#### **Web Scraping Tool**
```python
from google.adk.tools import web_scraper

scraper = web_scraper.WebScraperTool()
content = await scraper.scrape("https://example.com")
```

### Custom Function Integration

```python
from google.adk.tools import tool

@tool
def custom_operation(input_data: str, threshold: float = 0.5) -> dict:
    """
    Process custom operations

    Args:
        input_data: Input to process
        threshold: Processing threshold

    Returns:
        Processed result dictionary
    """
    # Your implementation
    return {
        "processed": True,
        "result": input_data.upper(),
        "metadata": {"threshold": threshold}
    }
```

### Third-Party Integrations

ADK now supports integrations with:
- **Hugging Face**: Access models and datasets
- **GitHub**: Code repository access and workflows
- **Slack**: Team communication and notifications
- **Zapier**: Connect to 7000+ apps
- **LangChain**: Extended ecosystem
- **OpenAI/Anthropic**: Alternative model providers
- **Data Platforms**: BigQuery, Datadog, etc.

### Using Agents as Tools

```python
# Define sub-agent
analysis_agent = LlmAgent(
    model="gemini-2.5-flash",
    tools=[fetch_arxiv_paper],
    system_prompt="You are a paper analysis specialist"
)

# Use as tool in main agent
main_agent = LlmAgent(
    model="gemini-2.5-pro",
    tools=[
        agent_lib.AgentTool(analysis_agent, name="analyze_papers"),
        google_search_tool
    ],
    system_prompt="You are a research coordinator..."
)
```

---

## Multi-Agent Systems

### Architecture Patterns

#### **Sequential Agent Team**
Tasks executed in order, each building on previous results.

```python
from google.adk.agents import SequentialAgent

workflow = SequentialAgent(
    agents=[
        research_agent,      # Gather information
        analysis_agent,      # Analyze findings
        report_agent         # Generate report
    ]
)

result = await workflow.run(
    session=session,
    input="Write comprehensive report on AI trends"
)
```

#### **Parallel Agent Team**
Independent tasks executed simultaneously.

```python
from google.adk.agents import ParallelAgent

parallel_analysis = ParallelAgent(
    agents=[
        technical_analyst,
        business_analyst,
        market_analyst
    ]
)

results = await parallel_analysis.run(
    session=session,
    input="Analyze this startup's potential"
)
```

#### **Hierarchical Multi-Agent System**

```python
# Specialist agents
web_researcher = LlmAgent(model="gemini-2.5-flash", ...)
pdf_analyzer = LlmAgent(model="gemini-2.5-flash", ...)
summarizer = LlmAgent(model="gemini-2.5-pro", ...)

# Coordinator agent
coordinator = LlmAgent(
    model="gemini-2.5-pro",
    tools=[
        agent_lib.AgentTool(web_researcher, name="research"),
        agent_lib.AgentTool(pdf_analyzer, name="analyze"),
        agent_lib.AgentTool(summarizer, name="summarize")
    ],
    system_prompt="Coordinate research tasks and synthesize findings"
)

result = await coordinator.run(
    session=session,
    input="Research and analyze the latest quantum computing advances"
)
```

#### **Loop Agent for Iterative Tasks**

```python
from google.adk.agents import LoopAgent

refinement_loop = LoopAgent(
    agent=writing_agent,
    termination_condition="quality_score >= 0.9",
    max_iterations=5,
    instructions="Refine the document until quality threshold is met"
)

final_document = await refinement_loop.run(
    session=session,
    input="Write a research paper draft"
)
```

### Agent Communication

```python
# Agents share context through Session
session = Session()

# Agent 1 produces output
output1 = await agent1.run(
    session=session,
    input="Generate initial hypothesis"
)

# Agent 2 accesses session context
output2 = await agent2.run(
    session=session,
    input="Test hypothesis and provide feedback"
)

# Access shared memory
memories = session.get_memory()
shared_context = session.get_state()
```

### Scaling Considerations

- Use `ParallelAgent` for independent work
- Implement `SequentialAgent` for dependent tasks
- Monitor token usage across agents
- Implement rate limiting for API calls
- Use callbacks for cross-agent logging

---

## Model Support

### Primary Models

#### **Google Gemini (Optimized)**

```python
# Latest models
"gemini-2.5-pro"              # Most capable
"gemini-2.5-flash"            # Fast and capable
"gemini-3.1-flash-lite"       # Lightweight
"gemini-2.5-flash-native-audio-latest"  # For audio/voice
```

**Best For:**
- Complex reasoning
- Multi-step tasks
- Voice interactions (audio models)
- Production workloads

#### **Alternative Models (via LiteLLM)**

```python
# Claude
"claude-opus-4-6"             # Most capable
"claude-sonnet-4-6"           # Balanced
"claude-haiku-4-5"            # Lightweight

# OpenAI
"gpt-4o"                      # Multimodal
"gpt-4-turbo"                 # Fast

# Mistral
"mistral-large"               # General purpose
"mistral-medium"              # Balanced

# Other providers
"meta-llama-3"                # Open source
```

### Model Configuration

```python
# Configure specific model
agent = LlmAgent(
    model="gemini-2.5-pro",
    temperature=0.7,          # Creativity (0-1)
    top_p=0.95,              # Diversity
    max_tokens=4096,         # Response length
    top_k=40,                # Token sampling
)

# Model fallback chain
agent = LlmAgent(
    model="gemini-2.5-pro",
    fallback_models=[
        "gemini-2.5-flash",
        "gpt-4o",
        "claude-opus-4-6"
    ]
)
```

### Voice Models for Audio

```python
# For voice interactions with Gemini Live API
agent = LlmAgent(
    model="gemini-2.5-flash-native-audio-latest",
    response_modalities=["AUDIO"],
    audio_config={
        "sample_rate_hertz": 16000,
        "voice_name": "en-US-Neural2-C"
    }
)
```

---

## Deployment

### Local Development

```bash
# Run agent interactively
adk run main.py

# Use browser-based UI
adk dev  # Opens at localhost:3000
```

### Docker Containerization

Create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

ENV GOOGLE_API_KEY=${GOOGLE_API_KEY}
ENV ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

CMD ["python", "main.py"]
```

Build and run:

```bash
docker build -t my-adk-agent .
docker run -e GOOGLE_API_KEY=$GOOGLE_API_KEY my-adk-agent
```

### Cloud Run Deployment

```bash
# Build and push to Artifact Registry
gcloud builds submit --tag gcr.io/PROJECT_ID/adk-agent

# Deploy to Cloud Run
gcloud run deploy adk-agent \
  --image gcr.io/PROJECT_ID/adk-agent \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_API_KEY=$GOOGLE_API_KEY
```

### Vertex AI Agent Engine (Recommended for Production)

```bash
# Deploy using Agent Engine
gcloud ai agents deploy my-agent \
  --source . \
  --display-name "My ADK Agent" \
  --region us-central1 \
  --runtime adk-runtime-v1
```

**Benefits:**
- Fully managed auto-scaling
- Built-in monitoring and logging
- High availability
- Pay-per-use pricing
- Seamless integration with Google Cloud

### Environment Variables

```bash
# Critical for security
GOOGLE_API_KEY               # Gemini API key
ANTHROPIC_API_KEY           # Claude API key
OPENAI_API_KEY              # GPT API key
GOOGLE_CLOUD_PROJECT        # GCP project ID

# Optional
LANGFUSE_SECRET_KEY         # For observability
DEBUG=true                  # Enable debug logging
LOG_LEVEL=DEBUG            # Logging level
```

---

## Evaluation & Testing

### Create Evaluation Dataset

```python
from google.adk.eval import EvaluationDataset, EvaluationCase

# Define test cases
test_cases = [
    EvaluationCase(
        input="What is machine learning?",
        expected_output="Machine learning is a subset of AI...",
        tags=["definition", "ml"]
    ),
    EvaluationCase(
        input="Compare supervised and unsupervised learning",
        expected_output="Supervised learning requires labeled data...",
        tags=["comparison", "ml"]
    ),
]

dataset = EvaluationDataset(
    name="ml_fundamentals",
    cases=test_cases
)
```

### Run Evaluation

```python
from google.adk.eval import Evaluator, MetricConfig

evaluator = Evaluator(
    agent=my_agent,
    dataset=dataset,
    metrics=[
        MetricConfig(
            name="accuracy",
            metric_type="semantic_similarity",
            threshold=0.8
        ),
        MetricConfig(
            name="relevance",
            metric_type="relevance",
            threshold=0.75
        ),
        MetricConfig(
            name="latency",
            metric_type="latency",
            threshold_ms=5000
        )
    ]
)

results = await evaluator.evaluate()
print(f"Accuracy: {results.accuracy}")
print(f"Avg Latency: {results.avg_latency}ms")
```

### Unit Testing

```python
import unittest
from google.adk import Session

class TestMyAgent(unittest.TestCase):
    def setUp(self):
        self.agent = LlmAgent(
            model="gemini-2.5-flash",
            tools=[my_tool]
        )
        self.session = Session()

    async def test_agent_response(self):
        response = await self.agent.run(
            session=self.session,
            input="Test input"
        )
        self.assertIsNotNone(response.message)
        self.assertTrue(len(response.message) > 0)

    async def test_tool_invocation(self):
        response = await self.agent.run(
            session=self.session,
            input="Use the tool"
        )
        self.assertTrue(any(tc.name == "my_tool" for tc in response.tool_calls))
```

---

## Observability & Monitoring

### OpenTelemetry Integration

```python
from google.adk.observability import setup_tracing
from google.cloud.trace_v2 import TraceServiceClient

# Enable tracing to Google Cloud Trace
setup_tracing(
    project_id="my-project",
    service_name="adk-agent",
    trace_exporter="google_cloud_trace"
)

# Your agent code automatically instrumented
agent = LlmAgent(...)
```

### Custom Callbacks for Logging

```python
from google.adk.agents import Callback
import logging

logger = logging.getLogger(__name__)

class LoggingCallback(Callback):
    async def on_agent_start(self, agent, input_text):
        logger.info(f"Agent starting with input: {input_text}")

    async def on_tool_call(self, tool_name, args):
        logger.info(f"Tool called: {tool_name} with {args}")

    async def on_agent_end(self, agent, response):
        logger.info(f"Agent finished with response length: {len(response.message)}")

    async def on_error(self, error):
        logger.error(f"Agent error: {error}", exc_info=True)

agent = LlmAgent(
    model="gemini-2.5-pro",
    callbacks=[LoggingCallback()]
)
```

### Metrics Collection

```python
from prometheus_client import Counter, Histogram, start_http_server

# Create metrics
agent_calls = Counter('agent_calls_total', 'Total agent calls')
response_time = Histogram('agent_response_seconds', 'Response time')
tool_calls = Counter('tool_calls_total', 'Total tool calls', ['tool_name'])

class MetricsCallback(Callback):
    async def on_agent_start(self, agent, input_text):
        agent_calls.inc()

    async def on_tool_call(self, tool_name, args):
        tool_calls.labels(tool_name=tool_name).inc()

# Start Prometheus endpoint
start_http_server(8000)
```

### Langfuse Integration

```python
from google.adk.observability import setup_langfuse

setup_langfuse(
    secret_key="your-langfuse-secret",
    public_key="your-langfuse-public",
    host="https://cloud.langfuse.com"
)

# All agent runs automatically traced to Langfuse
agent = LlmAgent(...)
```

---

## Advanced Topics

### State Management Across Sessions

```python
from google.adk import Memory

# Create persistent memory
memory = Memory(
    type="persistent",
    backend="firestore",  # or "postgres", "redis"
    project_id="my-project"
)

# Store information across sessions
await memory.set("user_123_preferences", {
    "language": "english",
    "max_response_length": 1000
})

# Retrieve in future sessions
prefs = await memory.get("user_123_preferences")
```

### Function Calling with Streaming

```python
# Stream tool calls and responses
async for event in agent.run_stream(
    session=session,
    input="Generate a comprehensive analysis..."
):
    if event.type == "tool_call":
        print(f"Calling: {event.tool_name}")
    elif event.type == "tool_result":
        print(f"Tool result received")
    elif event.type == "text_chunk":
        print(event.text, end="", flush=True)
    elif event.type == "complete":
        print(f"\nTotal tokens: {event.usage.total_tokens}")
```

### Dynamic Agent Routing

```python
# Create specialized agents
qa_agent = LlmAgent(
    model="gemini-2.5-flash",
    system_prompt="Answer questions concisely"
)

analysis_agent = LlmAgent(
    model="gemini-2.5-pro",
    system_prompt="Perform detailed analysis"
)

# Coordinator routes to appropriate agent
router = LlmAgent(
    model="gemini-2.5-flash",
    tools=[
        AgentTool(qa_agent, name="quick_answer"),
        AgentTool(analysis_agent, name="detailed_analysis")
    ],
    system_prompt="Route user requests to appropriate agent"
)
```

### Artifact Generation

```python
# Agents can generate artifacts (code, documents, etc.)
response = await agent.run(
    session=session,
    input="Generate Python code for web scraping"
)

# Access generated artifacts
for artifact in response.artifacts:
    if artifact.type == "code":
        print(f"Language: {artifact.language}")
        print(f"Code:\n{artifact.content}")

        # Save to file
        with open(f"generated.{artifact.language}", "w") as f:
            f.write(artifact.content)
```

### Error Handling & Retries

```python
from google.adk.errors import AgentError, ToolError
from tenacity import retry, stop_after_attempt, wait_exponential

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10)
)
async def run_with_retry(agent, session, input_text):
    try:
        response = await agent.run(
            session=session,
            input=input_text
        )
        return response
    except ToolError as e:
        logger.error(f"Tool failed: {e}")
        raise
    except AgentError as e:
        logger.error(f"Agent error: {e}")
        raise
```

### Caching Responses

```python
from google.adk.cache import ResponseCache

cache = ResponseCache(
    backend="redis",
    ttl_seconds=3600  # 1 hour
)

# Configure agent with cache
agent = LlmAgent(
    model="gemini-2.5-flash",
    cache=cache
)

# Identical requests within TTL use cached response
response1 = await agent.run(session=session, input="Same question")
response2 = await agent.run(session=session, input="Same question")  # From cache
```

---

## Best Practices

### 1. **System Prompts**
- Be specific and detailed
- Include role definition
- Define behavior constraints
- Provide examples
- Update based on evaluation results

```python
system_prompt = """
You are an expert financial advisor with 20 years of experience.
Your role is to provide personalized investment advice.

Guidelines:
- Always disclose potential risks
- Cite data sources
- Recommend diversification
- Consider client risk tolerance
- Avoid guarantees

Format responses with:
1. Executive Summary
2. Risk Assessment
3. Recommendations
4. Next Steps
"""
```

### 2. **Tool Design**
- Keep tools focused and single-purpose
- Provide clear documentation
- Include type hints
- Handle errors gracefully
- Set timeouts for external calls

```python
@tool
def search_database(
    query: str,
    filters: Optional[dict] = None,
    limit: int = 10
) -> list[dict]:
    """
    Search internal database with optional filters.

    Args:
        query: Search text
        filters: Optional dict of field:value pairs
        limit: Max results (default 10, max 100)

    Returns:
        List of matching records

    Raises:
        ValueError: If query is empty or limit > 100
        TimeoutError: If search takes > 30 seconds
    """
    if not query:
        raise ValueError("Query cannot be empty")
    if limit > 100:
        raise ValueError("Limit cannot exceed 100")

    # Your implementation...
```

### 3. **Session Management**
- Create new sessions for independent conversations
- Preserve sessions for context continuation
- Manage session memory limits
- Clean up old sessions

```python
# Each user gets their own session
sessions = {}

async def handle_user_input(user_id: str, input_text: str):
    # Create session if new user
    if user_id not in sessions:
        sessions[user_id] = Session(user_id=user_id)

    session = sessions[user_id]
    response = await agent.run(session=session, input=input_text)

    return response
```

### 4. **Error Handling**
- Catch specific exceptions
- Log errors with context
- Provide user-friendly messages
- Implement fallbacks

```python
async def safe_agent_run(agent, session, input_text):
    try:
        response = await agent.run(session=session, input=input_text)
        return response
    except ToolError as e:
        logger.error(f"Tool {e.tool_name} failed: {e.details}")
        return "I encountered a technical issue. Please try again."
    except RateLimitError as e:
        logger.warning(f"Rate limited: {e}")
        return "System is busy. Please wait a moment and try again."
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return "An unexpected error occurred. Please contact support."
```

### 5. **Testing Strategy**
- Unit test tools independently
- Integration test agent workflows
- Evaluate with realistic datasets
- Monitor production performance

### 6. **Token Optimization**
- Use appropriate models for task complexity
- Implement caching for repeated queries
- Stream responses for long content
- Summarize context when needed

### 7. **Security**
- Store API keys in environment variables
- Implement authentication/authorization
- Validate tool inputs
- Audit agent decisions
- Implement rate limiting

```python
# Secure configuration
import os
from dotenv import load_dotenv

load_dotenv()

agent = LlmAgent(
    model="gemini-2.5-pro",
    api_key=os.getenv("GOOGLE_API_KEY"),
    tools=[secured_tool],
    callbacks=[audit_callback]
)
```

### 8. **Performance Optimization**
- Use parallel agents for independent tasks
- Implement caching where appropriate
- Choose efficient models
- Monitor and optimize token usage
- Use streaming for real-time interaction

---

## Resources & References

### Official Documentation
- **Main Docs**: https://google.github.io/adk-docs/
- **Google Cloud Docs**: https://docs.cloud.google.com/agent-builder/agent-development-kit/overview
- **Python Repository**: https://github.com/google/adk-python
- **Sample Projects**: https://github.com/google/adk-samples

### Learning Resources
- **ADK Crash Course**: https://codelabs.developers.google.com/onramp/instructions
- **Building Multi-Agent Systems**: https://cloud.google.com/blog/topics/developers-practitioners/building-collaborative-ai-a-developers-guide-to-multi-agent-systems-with-adk
- **Google Codelabs**: https://codelabs.developers.google.com/
- **DataCamp Tutorial**: https://www.datacamp.com/tutorial/agent-development-kit-adk

### Blog Posts & Guides
- **Google Developers Blog**: https://developers.googleblog.com/en/agent-development-kit-easy-to-build-multi-agent-applications/
- **Complete Guide**: https://www.siddharthbharath.com/the-complete-guide-to-googles-agent-development-kit-adk/
- **Comprehensive Guide**: https://www.firecrawl.dev/blog/google-adk-multi-agent-tutorial

### Community & Support
- **GitHub Issues**: https://github.com/google/adk-python/issues
- **Stack Overflow**: Tag with `google-adk`
- **Google Cloud Community**: https://www.googlecloudcommunity.com/

### Related Tools & Frameworks
- **Gemini API**: https://ai.google.dev/
- **Vertex AI Agent Engine**: https://cloud.google.com/vertex-ai/docs/agent-engine
- **LiteLLM** (Multi-model support): https://litellm.ai/
- **LangChain**: https://www.langchain.com/
- **LangFuse** (Observability): https://langfuse.com/

### Version Information
- **Latest Version**: Check [github.com/google/adk-python/releases](https://github.com/google/adk-python/releases)
- **Python Minimum**: 3.10
- **Supported Languages**: Python, TypeScript, Go, Java

---

## Changelog & Updates

### 2026 Updates
- **TypeScript SDK**: Full parity with Python SDK
- **ADK Integrations Ecosystem**: Partnerships with Hugging Face, GitHub, Slack
- **Vertex AI Agent Engine**: Production-ready deployment platform
- **Advanced Observability**: OpenTelemetry, Langfuse integration
- **Streaming Improvements**: Better real-time performance
- **Java SDK**: Version 0.6.0 with enhanced features

---

## Quick Reference

### Installation Command Cheatsheet
```bash
# Python
pip install google-adk

# TypeScript
npm install @google/adk @google/adk-devtools

# Go
go get google.golang.org/adk

# Java (Maven)
# Add to pom.xml or use gradle
```

### Common Commands
```bash
# Local development
adk run main.py           # Run agent
adk dev                   # Browser UI
adk test                  # Run tests
adk eval                  # Evaluate agent

# Deployment
adk build                 # Build Docker image
adk deploy               # Deploy to Cloud Run
```

### Quick Code Templates

**Basic Agent**
```python
from google.adk.agents import LlmAgent

agent = LlmAgent(model="gemini-2.5-pro")
response = await agent.run(session=session, input="...")
```

**Agent with Tools**
```python
agent = LlmAgent(
    model="gemini-2.5-pro",
    tools=[tool1, tool2, tool3]
)
```

**Multi-Agent Workflow**
```python
from google.adk.agents import SequentialAgent

workflow = SequentialAgent(agents=[agent1, agent2, agent3])
```

---

## Frequently Asked Questions

### Q: Which model should I use?
**A**: Use `gemini-2.5-pro` for complex reasoning, `gemini-2.5-flash` for speed, or specific models based on your needs.

### Q: How do I manage costs?
**A**: Use caching, stream responses, choose appropriate models, and monitor token usage through callbacks.

### Q: Can I use other LLMs?
**A**: Yes, ADK supports Claude, GPT-4o, Mistral, and others through LiteLLM integration.

### Q: How do I deploy to production?
**A**: Use Vertex AI Agent Engine for fully managed deployment, or containerize with Docker/Cloud Run.

### Q: How do I debug agents?
**A**: Use the browser UI (`adk dev`), enable logging callbacks, and use OpenTelemetry tracing.

### Q: Can agents have memory across sessions?
**A**: Yes, use the Memory component with persistent backends like Firestore or PostgreSQL.

### Q: How do I evaluate agent quality?
**A**: Use ADK's evaluation framework with metrics like semantic similarity and relevance.

---

**Document Version**: 1.0 | **Last Updated**: March 2026
**Maintained By**: Claude Code | **Status**: Current & Comprehensive
