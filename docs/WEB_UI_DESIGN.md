# Web-based Testing Framework UI - Design Document

> **Status:** Optional Future Enhancement  
> **Priority:** Low  
> **Complexity:** High

## Overview

This document outlines the design for an optional web-based UI that extends the AI Testing Framework into a deployable, shared testing service. This would allow teams to collaboratively test AI features without requiring individual VS Code setups.

## Vision

Transform the command-line testing framework into a web-based service where:

- Multiple users can access a shared testing interface
- Tests can be scheduled and run automatically
- Results are stored and can be compared over time
- Test configurations are versioned and shared
- AI model performance is tracked across versions

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Web Browser                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          React-based Frontend                        │  │
│  │                                                       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │  │
│  │  │  Test        │  │  Results     │  │  Config   │  │  │
│  │  │  Dashboard   │  │  Viewer      │  │  Manager  │  │  │
│  │  └──────────────┘  └──────────────┘  └───────────┘  │  │
│  │                                                       │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │  │
│  │  │  Test        │  │  Comparison  │  │  Admin    │  │  │
│  │  │  Execution   │  │  Tool        │  │  Panel    │  │  │
│  │  └──────────────┘  └──────────────┘  └───────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────────┘
                         │ REST API / WebSocket
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                     Backend Server (Node.js/Express)         │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  API Layer                               ││
│  │                                                          ││
│  │  /api/tests              - Test execution endpoints     ││
│  │  /api/results            - Result retrieval             ││
│  │  /api/configs            - Configuration management     ││
│  │  /api/comparisons        - Result comparison            ││
│  │  /ws/test-progress       - Real-time updates            ││
│  └─────────────────────────────────────────────────────────┘│
│                           │                                  │
│  ┌────────────────────────┼────────────────────────────────┐│
│  │                    Business Logic                       ││
│  │                                                          ││
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────┐  ││
│  │  │  Test        │  │  Result       │  │  Config    │  ││
│  │  │  Executor    │  │  Processor    │  │  Manager   │  ││
│  │  └──────────────┘  └───────────────┘  └────────────┘  ││
│  │                                                          ││
│  │  ┌──────────────┐  ┌───────────────┐  ┌────────────┐  ││
│  │  │  Scheduler   │  │  Comparison   │  │  User      │  ││
│  │  │  Service     │  │  Engine       │  │  Auth      │  ││
│  │  └──────────────┘  └───────────────┘  └────────────┘  ││
│  └──────────────────────────────────────────────────────────┘│
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │
          ┌─────────────────┼──────────────────┐
          │                 │                  │
          ▼                 ▼                  ▼
┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐
│   Database       │  │  VS Code     │  │  File Storage    │
│   (PostgreSQL)   │  │  Extension   │  │  (Test Results)  │
│                  │  │  (via RPC)   │  │                  │
│  - Tests         │  │              │  │  - CSV files     │
│  - Results       │  │              │  │  - Logs          │
│  - Configs       │  │              │  │  - Exports       │
│  - Users         │  │              │  │                  │
│  - Schedules     │  │              │  │                  │
└──────────────────┘  └──────────────┘  └──────────────────┘
```

## Features

### 1. Test Dashboard

**Purpose:** Central hub for viewing and managing tests

**Features:**
- List all test configurations
- View test history and status
- Quick actions: Run, Edit, Clone, Delete
- Filter and search capabilities
- Test execution queue status

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│  🧪 AI Testing Dashboard                       [+ New Test] │
├─────────────────────────────────────────────────────────────┤
│  Filters: [All Clusters ▼] [All Databases ▼] [Search...]   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📊 Index Advisor Tests - Production                        │
│  ├─ Cluster: prod-cluster-01                                │
│  ├─ Database: sales_db                                      │
│  ├─ Last Run: 2 hours ago                                   │
│  ├─ Status: ✅ PASSED (8/10)                                │
│  └─ [▶️ Run] [📝 Edit] [📋 Clone] [🗑️ Delete] [📊 History]  │
│                                                              │
│  📊 Query Generation Tests - Staging                        │
│  ├─ Cluster: staging-cluster                                │
│  ├─ Database: analytics_db                                  │
│  ├─ Last Run: 1 day ago                                     │
│  ├─ Status: ⚠️  FAILED (5/10)                               │
│  └─ [▶️ Run] [📝 Edit] [📋 Clone] [🗑️ Delete] [📊 History]  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2. Test Configuration Manager

**Purpose:** Create and manage test configurations

**Features:**
- Visual configuration editor (no JSON editing required)
- Upload CSV test cases or use table editor
- Template library for common scenarios
- Configuration versioning
- Share configurations with team

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│  📝 Edit Test Configuration: "Index Advisor - Production"   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Connection Settings                                         │
│  ├─ Cluster: [prod-cluster-01        ▼]                     │
│  └─ Database: [sales_db              ▼]                     │
│                                                              │
│  AI Model Settings                                           │
│  ├─ Preferred Model: [gpt-4          ▼]                     │
│  └─ Prompt Template: [Default        ▼] [Custom...]         │
│                                                              │
│  Test Cases                                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ID       │ Collection │ Query                  │ ... │   │
│  ├──────────┼────────────┼─────────────────────────┼─────┤   │
│  │ test_1   │ orders     │ db.orders.find({...    │ ... │   │
│  │ test_2   │ products   │ db.products.find({...  │ ... │   │
│  │ [+ Add Row]                                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  [Upload CSV] [Download Template] [Import from...]          │
│                                                              │
│  [Cancel] [Save Draft] [Save & Run]                         │
└─────────────────────────────────────────────────────────────┘
```

### 3. Test Execution View

**Purpose:** Monitor running tests in real-time

**Features:**
- Real-time progress updates via WebSocket
- Live log streaming
- Pause/Resume/Cancel capabilities
- Individual test case status
- Performance metrics visualization

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│  ▶️  Test Execution: "Index Advisor - Production"           │
│  Progress: ████████░░ 80% (8/10 tests)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ✅ test_1: orders - Range Query          [45ms → 12ms]     │
│  ✅ test_2: products - Text Search        [87ms → 23ms]     │
│  ✅ test_3: customers - Compound Filter   [52ms → 15ms]     │
│  ✅ test_4: inventory - Sort Query        [63ms → 18ms]     │
│  ✅ test_5: sessions - Count Query        [29ms → 8ms]      │
│  ✅ test_6: events - Aggregation          [125ms → 45ms]    │
│  ✅ test_7: logs - Nested Field           [98ms → 31ms]     │
│  ✅ test_8: tags - Array Query            [71ms → 22ms]     │
│  ⏳ test_9: locations - Geospatial        [Running...]      │
│  ⏸️  test_10: metrics - Time Series                          │
│                                                              │
│  Live Logs:                                                  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ [11:23:45] Starting test_9: locations                │   │
│  │ [11:23:46] Connecting to cluster...                  │   │
│  │ [11:23:47] Executing baseline query...               │   │
│  │ [11:23:49] Sending to Copilot (gpt-4)...            │   │
│  │ [11:23:52] Received AI recommendations...            │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  [⏸️ Pause] [⏹️ Cancel] [📊 View Partial Results]            │
└─────────────────────────────────────────────────────────────┘
```

### 4. Results Viewer

**Purpose:** View and analyze test results

**Features:**
- Tabular and graphical result views
- Filter and sort capabilities
- Export to CSV, JSON, Excel
- Detailed AI recommendation viewer
- Performance charts

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│  📊 Test Results: "Index Advisor - Production"              │
│  Run: Dec 19, 2025 11:30 AM  |  Status: ✅ PASSED (8/10)   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Summary                                                     │
│  ├─ Total Tests: 10                                         │
│  ├─ Passed: 8                                               │
│  ├─ Failed: 2                                               │
│  ├─ Pass Rate: 80%                                          │
│  ├─ Avg Performance Gain: 68.5%                             │
│  └─ Model Used: gpt-4                                       │
│                                                              │
│  Performance Improvement Chart                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  100ms│                                              │   │
│  │   80ms│ ███                                          │   │
│  │   60ms│ ███ ███                ███                   │   │
│  │   40ms│ ███ ███ ███ ███ ███   ███ ███ ███           │   │
│  │   20ms│ ▓▓▓ ▓▓▓ ▓▓▓ ▓▓▓ ▓▓▓   ▓▓▓ ▓▓▓ ▓▓▓           │   │
│  │    0ms└─────────────────────────────────────────     │   │
│  │         t1  t2  t3  t4  t5   t6  t7  t8             │   │
│  │         ███ Before  ▓▓▓ After                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Detailed Results                      [Export ▼]           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Test ID │ Collection │ Status │ Before │ After │ ... │   │
│  ├─────────┼────────────┼────────┼────────┼───────┼─────┤   │
│  │ test_1  │ orders     │ ✅     │ 45ms   │ 12ms  │ 👁️  │   │
│  │ test_2  │ products   │ ✅     │ 87ms   │ 23ms  │ 👁️  │   │
│  │ test_3  │ customers  │ ✅     │ 52ms   │ 15ms  │ 👁️  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5. Comparison Tool

**Purpose:** Compare results across test runs

**Features:**
- Side-by-side comparison
- Trend analysis over time
- Model performance comparison
- Regression detection
- Diff view for AI recommendations

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│  🔍 Compare Test Results                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Run A: Dec 18, 2025 (gpt-4)     Run B: Dec 19, 2025 (gpt-4)│
│  ┌──────────────────────────┐   ┌──────────────────────────┐│
│  │ Pass Rate: 70%           │   │ Pass Rate: 80%      ↑10%││
│  │ Avg Improvement: 62.3%   │   │ Avg Improvement: 68.5% ↑6%││
│  │ Total Time: 2m 15s       │   │ Total Time: 2m 08s  ↓7s││
│  └──────────────────────────┘   └──────────────────────────┘│
│                                                              │
│  Test-by-Test Comparison                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Test    │ Run A    │ Run B    │ Change   │ Status   │   │
│  ├─────────┼──────────┼──────────┼──────────┼──────────┤   │
│  │ test_1  │ 45→15ms  │ 45→12ms  │ +3ms ✅  │ Better   │   │
│  │ test_2  │ FAILED   │ 87→23ms  │ FIXED ✅ │ Fixed    │   │
│  │ test_3  │ 52→14ms  │ 52→15ms  │ -1ms ⚠️  │ Worse    │   │
│  │ test_4  │ 63→19ms  │ 63→18ms  │ +1ms ✅  │ Better   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Recommendations Diff (test_2)                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Run A: (Failed - No recommendations)                 │   │
│  │                                                       │   │
│  │ Run B: db.products.createIndex({category: 1})       │   │
│  │        db.products.createIndex({price: 1, rating: 1})│   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 6. Test Scheduler

**Purpose:** Automate recurring test execution

**Features:**
- Cron-based scheduling
- Event-based triggers (e.g., schema changes)
- Email/Slack notifications
- Failure alerting
- Schedule history

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│  ⏰ Test Schedules                            [+ New Schedule]│
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📅 Daily Production Index Review                           │
│  ├─ Test: "Index Advisor - Production"                      │
│  ├─ Schedule: Every day at 2:00 AM UTC                      │
│  ├─ Next Run: Today at 2:00 AM (in 14h 23m)                │
│  ├─ Notifications: email@example.com, #alerts-channel       │
│  ├─ Last Run: Yesterday at 2:00 AM (✅ PASSED)             │
│  └─ [✏️ Edit] [⏸️ Pause] [🗑️ Delete]                         │
│                                                              │
│  📅 Weekly Staging Validation                               │
│  ├─ Test: "Query Generation - Staging"                      │
│  ├─ Schedule: Every Monday at 9:00 AM UTC                   │
│  ├─ Next Run: Monday at 9:00 AM (in 3d 22h)                │
│  ├─ Notifications: slack://team-channel                     │
│  ├─ Last Run: Last Monday at 9:00 AM (⚠️ FAILED 5/10)      │
│  └─ [✏️ Edit] [⏸️ Pause] [🗑️ Delete]                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 7. Admin Panel

**Purpose:** System administration and monitoring

**Features:**
- User management
- Cluster connection configuration
- System health monitoring
- Audit logs
- Usage statistics

## Technical Implementation

### Frontend Stack

```typescript
// React with TypeScript
- React 18+
- TypeScript 5+
- Material-UI or Ant Design for components
- React Query for data fetching
- Recharts for visualizations
- Socket.io-client for real-time updates
```

### Backend Stack

```typescript
// Node.js/Express API
- Express.js for REST API
- Socket.io for WebSocket connections
- PostgreSQL for data persistence
- Sequelize ORM
- JWT for authentication
- Bull for job queuing
```

### Database Schema

```sql
-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Test configurations
CREATE TABLE test_configs (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    cluster_id VARCHAR(255) NOT NULL,
    database_name VARCHAR(255) NOT NULL,
    config_json JSONB NOT NULL,
    test_cases JSONB NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Test runs
CREATE TABLE test_runs (
    id SERIAL PRIMARY KEY,
    config_id INTEGER REFERENCES test_configs(id),
    status VARCHAR(50),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    results_json JSONB,
    summary_json JSONB,
    triggered_by VARCHAR(50), -- 'manual', 'schedule', 'api'
    triggered_by_user INTEGER REFERENCES users(id)
);

-- Schedules
CREATE TABLE test_schedules (
    id SERIAL PRIMARY KEY,
    config_id INTEGER REFERENCES test_configs(id),
    cron_expression VARCHAR(100),
    enabled BOOLEAN DEFAULT true,
    notifications JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### API Endpoints

```typescript
// Test Configuration Management
POST   /api/configs              - Create test configuration
GET    /api/configs              - List configurations
GET    /api/configs/:id          - Get configuration
PUT    /api/configs/:id          - Update configuration
DELETE /api/configs/:id          - Delete configuration

// Test Execution
POST   /api/tests/run/:configId  - Start test execution
GET    /api/tests/runs           - List test runs
GET    /api/tests/runs/:id       - Get run details
DELETE /api/tests/runs/:id/cancel - Cancel running test

// Results
GET    /api/results/:runId       - Get test results
GET    /api/results/compare      - Compare two runs
GET    /api/results/:runId/export - Export results

// Scheduling
POST   /api/schedules            - Create schedule
GET    /api/schedules            - List schedules
PUT    /api/schedules/:id        - Update schedule
DELETE /api/schedules/:id        - Delete schedule

// WebSocket
WS     /ws/test-progress/:runId  - Real-time test progress
```

### Integration with VS Code Extension

The web service would communicate with VS Code extension via:

1. **RPC over HTTP**
   ```typescript
   // Extension exposes HTTP endpoint
   app.post('/vscode/execute-test', async (req, res) => {
       const result = await testOptimizeQuery(
           context,
           req.body.queryContext
       );
       res.json(result);
   });
   ```

2. **VS Code Extension as Service**
   ```typescript
   // Run VS Code in headless mode on server
   // Extension listens for commands via IPC
   const vscodeService = new VSCodeTestService();
   await vscodeService.initialize();
   const result = await vscodeService.executeTest(config);
   ```

## Deployment

### Single-VM Setup

```bash
# Install dependencies
sudo apt-get update
sudo apt-get install -y nodejs npm postgresql

# Install VS Code Server
wget https://code.visualstudio.com/sha/download?build=stable&os=linux-x64
sudo dpkg -i code_*.deb

# Install extensions
code --install-extension ms-azuretools.vscode-documentdb
code --install-extension github.copilot

# Setup database
sudo -u postgres createdb ai_testing

# Clone and setup application
git clone https://github.com/org/ai-testing-ui
cd ai-testing-ui
npm install
npm run build

# Configure environment
cp .env.example .env
# Edit .env with credentials

# Start services
npm run start:backend &
npm run start:frontend &
```

### Docker Deployment

```dockerfile
FROM node:20-alpine

# Install VS Code Server
RUN wget https://code.visualstudio.com/sha/download?build=stable&os=linux-alpine-x64

# Copy application
COPY . /app
WORKDIR /app

# Install dependencies
RUN npm install
RUN npm run build

# Expose ports
EXPOSE 3000 3001

# Start
CMD ["npm", "run", "start"]
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-testing-service
spec:
  replicas: 2
  selector:
    matchLabels:
      app: ai-testing
  template:
    metadata:
      labels:
        app: ai-testing
    spec:
      containers:
      - name: backend
        image: ai-testing:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: ai-testing-secrets
              key: database-url
```

## Security Considerations

### Authentication & Authorization

- **JWT-based authentication**
- **Role-based access control** (Admin, User, Viewer)
- **API key support** for programmatic access
- **OAuth integration** (GitHub, Azure AD)

### Data Security

- **Encryption at rest** for stored configurations
- **TLS/SSL** for all communications
- **Credential management** via secure vault (HashiCorp Vault)
- **Audit logging** for all actions

### Rate Limiting

- **Per-user rate limits** to prevent abuse
- **Queue management** to prevent system overload
- **Resource quotas** per team/organization

## Cost Considerations

### Infrastructure Costs

- **VM/Container hosting**: $50-200/month
- **Database**: $20-100/month
- **Storage**: $10-50/month
- **Total estimated**: $80-350/month

### Development Effort

- **Frontend Development**: 4-6 weeks
- **Backend Development**: 3-4 weeks
- **Integration**: 2-3 weeks
- **Testing & QA**: 2 weeks
- **Total**: 11-15 weeks (3-4 months)

## Success Metrics

### Usage Metrics

- Number of active users
- Tests executed per day/week/month
- Average test execution time
- Number of scheduled tests
- API request volume

### Quality Metrics

- Test pass rates over time
- AI model accuracy trends
- Performance improvement percentages
- User satisfaction scores

## Alternatives Considered

### 1. VS Code Extension UI

**Pros:**
- No separate deployment needed
- Integrated experience
- Easier authentication

**Cons:**
- Limited collaboration
- No shared state
- Each user needs setup

### 2. GitHub Actions Integration

**Pros:**
- Leverage existing CI/CD
- Version controlled
- Free for public repos

**Cons:**
- Less interactive
- Limited visualization
- Tied to GitHub

### 3. Jupyter Notebook Interface

**Pros:**
- Familiar to data scientists
- Good for exploratory testing
- Rich visualization

**Cons:**
- Not collaborative
- Limited automation
- Requires Python knowledge

## Conclusion

The web-based UI would significantly enhance the AI Testing Framework by:

✅ Enabling team collaboration
✅ Providing better visualization
✅ Automating recurring tests
✅ Tracking performance over time
✅ Reducing setup complexity

However, it comes with:

❌ Significant development effort
❌ Ongoing hosting costs
❌ Additional maintenance burden
❌ Security considerations

**Recommendation:** Implement the core CLI framework first, validate its usefulness, then consider the web UI as a Phase 2 enhancement based on user feedback and demand.
