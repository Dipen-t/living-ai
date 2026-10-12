# EvolveKit — Product Requirements Document (PRD)

**Product:** EvolveKit  
**Tagline:** Make existing software evolve.  
**Version:** 1.0 (Initial PRD)  
**Initial Release Target:** SDK v0.1 (MVP)  
**Status:** Proposed for Development  
**Primary Platform:** React + TypeScript  
**Backend:** Node.js + Fastify  
**Product Category:** Developer SDK / AI-Assisted Application Evolution

---

# 1. Executive Summary

EvolveKit is an SDK that enables existing software applications to propose, preview, validate, approve, and activate feature improvements based on natural-language requests from authorized users.

Traditional applications are static from an end-user perspective. When users need new features, they must communicate requirements to developers, wait for implementation, test the changes, and receive an updated version.

EvolveKit introduces an evolution layer inside existing applications.

A user can describe an improvement in natural language, receive a working preview, interact with the proposed behavior, request revisions, and submit the change for approval.

After authorization, the application incorporates the change through either runtime configuration or, in future versions, validated source-code modifications.

**EvolveKit's long-term vision is to make existing software capable of evolving through controlled, user-driven requests without sacrificing developer ownership, application security, or operational reliability.**

The initial release will focus on runtime-configurable React applications.

It will not attempt unrestricted application code generation or autonomous production deployment.

# 2. Problem Statement

## 2.1 Current Problem

Modern applications are generally developed through a centralized software development lifecycle.

A typical feature request involves:

1. The user discovers a missing feature.
2. The user reports the requirement.
3. A product owner or developer interprets the requirement.
4. A developer modifies the application.
5. The feature undergoes testing and review.
6. The updated application is deployed.
7. The user verifies whether the change meets their expectations.

Even relatively simple changes, such as adding filters, changing table layouts, or modifying forms, may require developer intervention.

This creates several problems.

### Problem A — Feature development bottlenecks

Small interface and workflow changes compete with larger development priorities.

### Problem B — Communication gaps

Users often struggle to describe exactly what they want.

Developers must interpret incomplete requirements, resulting in iterations and rework.

### Problem C — Limited experimentation

Users cannot typically test a proposed feature before it is implemented.

Screenshots and design mockups may not accurately demonstrate actual behavior.

### Problem D — Repetitive application customization

Developers repeatedly implement similar changes across different applications, including:

- Adding table filters
- Showing or hiding columns
- Reordering form fields
- Creating saved views
- Introducing configurable layouts

### Problem E — AI capabilities remain disconnected from application evolution

AI coding tools can generate code, but end users rarely have a controlled interface inside their existing applications to request, test, and approve changes.

## 2.2 Opportunity

Existing technology already provides many required building blocks:

- Large language models
- Schema-constrained generation
- Dynamic React rendering
- Component registries
- Feature flags
- Sandboxed execution
- Coding agents
- Version control
- CI/CD
- Application observability

EvolveKit will integrate these foundations into one controlled application-evolution workflow.

# 3. Product Vision

**Enable authorized users to collaboratively improve existing software through natural-language requests and interactive previews, while allowing developers to retain control over capabilities, permissions, data access, and deployments.**

EvolveKit is not intended to replace developers.

It reduces the manual work involved in supported application customizations and provides a structured path for more advanced feature requests.

## 3.1 Product Principles

1. **Existing applications first:** EvolveKit must integrate into applications without requiring complete rewrites.
2. **Human approval:** Changes must never activate in production without the required authorization.
3. **Preview before publishing:** Users must be able to experience a proposed change before accepting it.
4. **Controlled capabilities:** Applications explicitly define which features may be modified.
5. **No unrestricted AI execution:** AI-generated output is considered untrusted until validated.
6. **Reversibility:** Every activated runtime change must support rollback.
7. **Developer ownership:** EvolveKit does not override application permissions or business rules.
8. **Incremental evolution:** Start with configuration, then workflows, then source-code changes.
9. **Framework interoperability:** The core architecture should remain framework-independent, even though React is the first supported integration.

# 4. Target Users

## 4.1 Primary Users

### Application Developers

Developers integrating EvolveKit into an existing React application.

Their responsibilities include registering pages, declaring available capabilities, integrating approved components, and defining secure data adapters.

### Application Administrators

Authorized application owners who review proposed improvements and decide whether to activate them.

### Application End Users

People using the application who identify missing functionality and request improvements.

They may be nontechnical users such as accountants, salespeople, office managers, or students.

## 4.2 Secondary Users

- Engineering teams maintaining customizable SaaS products
- Internal-tool developers
- ERP and CRM product teams
- Agencies maintaining client applications
- Software vendors offering customer-specific customization

## 4.3 Initial Target Market

React-based internal business applications with repetitive data-heavy workflows.

The MVP will use customer-management and ERP-style interfaces for validation.

# 5. Product Scope

EvolveKit will support two evolution models.

## 5.1 Runtime Evolution — MVP

Runtime Evolution modifies supported application behavior through validated configuration.

Example changes:

- Add an existing filter type to a table.
- Show or hide registered columns.
- Reorder existing form fields.
- Change supported layout properties.
- Create saved table views.
- Modify supported sorting options.

These changes do not require source-code generation after initial developer integration.

The SDK applies approved configuration to existing components.

## 5.2 Code Evolution — Future Release

Code Evolution modifies actual application source code when a request cannot be fulfilled through available runtime capabilities.

Example changes:

- Add new React components.
- Implement new backend endpoints.
- Integrate external services.
- Create new business logic.
- Add new workflow implementations.
- Propose database schema changes.

This engine will rely on coding agents, isolated worktrees, sandboxed execution, automated testing, pull requests, and authorized deployment pipelines.

**Code Evolution is explicitly excluded from SDK v0.1.**

# 6. Core User Experience

## 6.1 Example Use Case

An employee opens the Customers page of an existing ERP application.

The employee enters:

"Add a filter for customers who haven't purchased anything in 90 days."

The system:

1. Identifies the currently active application page.
2. Retrieves the page's registered capabilities.
3. Checks whether the requested change is supported.
4. Generates a structured change proposal.
5. Validates that proposal.
6. Displays an interactive preview using safe sample data.
7. Allows the employee to test and refine the proposal.
8. Submits the proposed change for approval.
9. Allows an authorized administrator to approve or reject it.
10. Publishes the approved configuration.
11. Makes the new filter available to its intended users.
12. Allows administrators to roll back if necessary.

## 6.2 Primary User Journey

**Request → Plan → Validate → Preview → Refine → Approve → Publish → Rollback if needed**

## 6.3 Main UI Components

The React SDK will provide:

- EvolveProvider
- EvolveAssistant
- EvolvePreview
- EvolvableTable
- EvolvableForm (initially limited to safe field presentation changes)
- ProposalStatus
- ApprovalDialog
- EvolutionHistory

The initial implementation may expose these components separately. Applications will choose where to render them.

# 7. Functional Requirements

## FR-01 — SDK Installation and Initialization

**Priority:** P0

Developers must be able to install EvolveKit through npm and initialize it in an existing React application.

The SDK must support:

- Application identification
- Authenticated user context
- API endpoint configuration
- Tenant or organization context where applicable
- Capability registration
- Component registration
- Configuration retrieval

The browser SDK must not contain privileged API secrets.

**Acceptance Criteria:**

- SDK initializes in a React + TypeScript application.
- Missing required configuration produces understandable errors.
- An application can load registered capabilities.
- SDK failure does not prevent unrelated application screens from functioning.
- Privileged operations are authenticated and validated by the backend.

## FR-02 — Application Capability Registry

**Priority:** P0

The application developer must explicitly register the pages, fields, components, and operations that EvolveKit may modify.

Each registration contains:

- Stable page ID
- Route identifier
- Available fields
- Supported field types
- Permitted operations
- Registered component types
- Data adapter references
- Configuration schema
- Applicable scope and permission rules

Example capability declarations:

- add_filter
- add_column
- hide_column
- reorder_columns
- change_layout
- create_saved_view

Unregistered capabilities cannot be activated.

**Acceptance Criteria:**

- Every proposal references registered page and capability identifiers.
- Unregistered fields are rejected.
- Unsupported operations are rejected.
- Runtime configuration cannot invoke arbitrary JavaScript.
- Registry metadata is versioned.

## FR-03 — Natural-Language Feature Requests

**Priority:** P0

Authorized users can describe improvements in natural language.

Requests must include:

- User identity
- Application identity
- Page context
- Tenant context where applicable
- Requested improvement
- Creation timestamp

The request interface must support free-form text.

**Acceptance Criteria:**

- Requests are stored persistently.
- The requesting user can view their request status.
- The AI receives only the capability metadata necessary for proposal generation.
- Users without request permission cannot create proposals.

## FR-04 — Evolution Planner

**Priority:** P0

The Evolution Planner converts natural-language requests into structured proposals.

Inputs:

- User request
- Registered capability definitions
- Page context
- Allowed field metadata
- Relevant configuration schemas
- Applicable constraints

Outputs:

- Proposal type
- Target page
- Required capability
- Proposed configuration
- Summary of expected behavior
- Limitations or unresolved requirements

The LLM must not directly publish changes or execute arbitrary generated code.

Proposal generation should use structured outputs with schema validation.

Unsupported requests must receive a clear explanation and remain inactive.

**Acceptance Criteria:**

- Supported requests generate schema-valid proposals.
- Invalid outputs are rejected.
- Unsupported requests are not silently approximated into unrelated actions.
- The engine does not invent field IDs or capability IDs.
- Repeated requests can produce new draft revisions without overwriting published configurations.

## FR-05 — Proposal Validation

**Priority:** P0

Every proposal must pass server-side validation before becoming previewable or publishable.

Validation must check:

- Proposal schema
- Application ownership
- Registered capabilities
- Field identifiers
- Operation types
- Value types
- Permission requirements
- Tenant boundaries
- Configuration compatibility
- Allowed resource references

The frontend may perform preliminary validation for user experience, but server validation is authoritative.

**Acceptance Criteria:**

- Invalid proposals cannot be approved.
- Unauthorized proposals cannot be published.
- Cross-tenant access is denied.
- Proposal rejection returns understandable validation errors.
- Approval references an immutable proposal revision.

## FR-06 — Interactive Preview Engine

**Priority:** P0

Users must be able to interact with the proposed improvement before activation.

The preview must:

- Render the proposed configuration.
- Use registered application components.
- Display safe synthetic or explicitly authorized test data.
- Remain isolated from published configuration.
- Clearly indicate preview mode.
- Support switching between current and proposed versions.

For the MVP, the preview must not perform real-world side effects such as sending messages, charging payments, or mutating production data.

**Acceptance Criteria:**

- A user can activate and close a preview.
- The original application configuration remains unchanged.
- Preview changes are not visible to unrelated users.
- Interactions behave consistently with the supported runtime capability.
- The preview cannot bypass application authorization.

## FR-07 — Proposal Refinement

**Priority:** P1

Users must be able to request modifications to an existing proposal.

Example:

"Make the default period 60 days instead of 90 days."

Each refinement must create a new immutable revision.

The system must preserve:

- Original request
- Revision history
- Previous configurations
- Current draft revision
- AI-generated explanations
- Validation results

**Acceptance Criteria:**

- Revisions can be compared.
- Previously approved revisions are not silently modified.
- Approval always identifies the exact revision being accepted.

## FR-08 — Approval Workflow

**Priority:** P0

Only authorized users may approve changes.

Initial roles:

- Requester
- Approver
- Application Developer / Owner

Role definitions must be mapped to permissions supplied by the host application.

Approval states:

- Draft
- Validating
- Ready for Preview
- Pending Approval
- Approved
- Rejected
- Published
- Superseded
- Rolled Back

**Acceptance Criteria:**

- Requesters cannot approve changes unless explicitly authorized.
- The server verifies approval permissions.
- Approval applies to a specific immutable proposal revision.
- Every approval action is auditable.
- Rejected proposals cannot be published.

## FR-09 — Configuration Publishing

**Priority:** P0

Approved runtime proposals must become versioned application configurations.

Publishing must:

- Validate the approved revision again.
- Confirm compatibility with the installed SDK and registry version.
- Check for conflicts with changes published since the proposal was created.
- Create a new configuration version.
- Activate it for the intended application scope.
- Preserve the previous version for rollback.

The SDK must retrieve or receive updated configurations without requiring a source-code rebuild.

**Acceptance Criteria:**

- Approved supported features appear in the intended application.
- Changes survive refreshes and application restarts.
- Users outside the publication scope remain unaffected.
- Conflicting versions cannot silently overwrite one another.
- Publishing is atomic from the application's configuration perspective.

## FR-10 — Version History and Rollback

**Priority:** P0

EvolveKit must maintain configuration history.

Each version records:

- Version identifier
- Parent version
- Proposal identifier
- Configuration content
- Configuration hash
- Approver
- Publisher
- Publication timestamp
- Activation scope

Administrators must be able to reactivate an earlier valid version.

**Acceptance Criteria:**

- Rollback requires authorization.
- Earlier configurations remain accessible.
- Restored configuration passes compatibility checks.
- Rollback actions are logged.
- A failed activation does not destroy the last known good configuration.

## FR-11 — Tenant and User Isolation

**Priority:** P0

For multi-tenant applications, all requests, drafts, previews, configurations, approvals, and publication actions must be scoped to the appropriate tenant.

**Acceptance Criteria:**

- Tenant A cannot view Tenant B's proposals.
- Cross-tenant configuration activation is rejected.
- Authorization is enforced server-side.
- Request identifiers alone are insufficient to access restricted resources.

## FR-12 — Audit Logs

**Priority:** P0

EvolveKit must record important lifecycle events, including:

- Proposal creation
- Validation failure
- Revision generation
- Approval or rejection
- Publication
- Rollback
- Permission denial

Sensitive values must be redacted where appropriate.

# 8. SDK Architecture

## 8.1 Packages

The product will begin as a TypeScript monorepo.

### @evolvekit/core

Responsibilities:

- Shared types
- Capability schemas
- Proposal schemas
- Validation contracts
- Configuration version models
- Framework-independent definitions

### @evolvekit/react

Responsibilities:

- React context provider
- Request interface
- Component registry
- Runtime configuration hooks
- Preview components
- Evolvable UI primitives
- Configuration loading

### @evolvekit/server

Responsibilities:

- Authenticated APIs
- Proposal lifecycle
- Capability enforcement
- Approval handling
- Publication
- Version management
- Audit logging
- Tenant enforcement

### @evolvekit/ai

Responsibilities:

- AI provider abstraction
- Natural-language request interpretation
- Structured proposal generation
- Proposal explanations
- Revision generation

The AI package must not own publishing authority.

## 8.2 Initial Repository Structure

```text
evolvekit/
├── apps/
│   ├── demo-erp/
│   └── demo-crm/
│
├── packages/
│   ├── core/
│   │   ├── src/capabilities/
│   │   ├── src/configuration/
│   │   ├── src/proposals/
│   │   └── src/validation/
│   │
│   ├── react/
│   │   ├── src/components/
│   │   ├── src/context/
│   │   ├── src/hooks/
│   │   ├── src/registry/
│   │   └── src/preview/
│   │
│   ├── server/
│   │   ├── src/routes/
│   │   ├── src/services/
│   │   ├── src/auth/
│   │   └── src/repositories/
│   │
│   └── ai/
│       ├── src/planner/
│       └── src/providers/
│
├── docs/
├── tests/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

# 9. High-Level System Workflow

```text
Existing React Application
          |
          v
    EvolveKit SDK
          |
          v
  User Feature Request
          |
          v
      Server API
          |
          v
   Capability Registry
          |
          v
     AI Planner
          |
          v
  Structured Proposal
          |
          v
   Server Validation
          |
          v
  Interactive Preview
          |
          v
  User Refinement / Review
          |
          v
 Authorized Approval
          |
          v
 Versioned Configuration
          |
          v
   Runtime Activation
          |
          v
   Updated Application
```

# 10. Technology Stack

| Area | Proposed Technology |
|---|---|
| Language | TypeScript |
| Frontend SDK | React |
| Backend | Node.js + Fastify |
| Database | PostgreSQL |
| ORM | Prisma |
| Schema validation | Zod |
| AI integration | Provider abstraction supporting structured outputs |
| React configuration renderer | Custom EvolveKit adapter using established schema patterns |
| Authentication | Host application identity integration |
| Authorization | Server-side RBAC / permission policies |
| Package management | pnpm workspaces |
| Monorepo tooling | Turborepo |
| Unit testing | Vitest |
| Component testing | React Testing Library |
| End-to-end testing | Playwright |
| SDK packaging | tsup or equivalent |
| Documentation | TypeDoc and example-driven guides |
| CI | GitHub Actions |
| Initial deployment | Conventional Node hosting + PostgreSQL |

These are proposed implementation choices, not mandatory external dependencies for all consuming applications.

# 11. Database Design

The initial persistent model will include the following entities.

## Applications

Stores registered host applications and ownership information.

## Capability Registry Versions

Stores or references the capabilities supported by a particular application integration.

## Evolution Requests

Stores natural-language user requests and contextual metadata.

## Evolution Proposals

Represents proposed improvements linked to requests.

## Proposal Revisions

Stores immutable generated configurations and their validation results.

## Approvals

Tracks authorization decisions against exact proposal revisions.

## Configuration Versions

Stores validated application configurations and historical versions.

## Active Configurations

Maps application scope to the currently published configuration version.

## Audit Events

Stores significant actions and security-relevant activity.

### Important Design Constraints

- Proposal revisions must be immutable.
- Published configurations must be versioned.
- Every privileged action must be associated with an authenticated principal.
- Application and tenant identifiers must be included in access-control decisions.
- Sensitive production records must not be copied into AI requests by default.

# 12. Initial API Requirements

Illustrative endpoints:

```text
GET    /v1/capabilities
POST   /v1/evolution-requests
GET    /v1/evolution-requests/:id
POST   /v1/proposals/:id/revisions
POST   /v1/proposals/:id/validate
GET    /v1/proposals/:id/preview
POST   /v1/proposals/:id/submit
POST   /v1/proposals/:id/approve
POST   /v1/proposals/:id/reject

GET    /v1/configurations/active
GET    /v1/configurations/history
POST   /v1/configurations/publish
POST   /v1/configurations/rollback

GET    /v1/audit-events
```

These routes are preliminary contracts. They will be refined during API design.

All privileged endpoints require authenticated, server-verified authorization.

# 13. Non-Functional Requirements

## 13.1 Performance

- Existing pages should not require additional AI calls during ordinary rendering.
- Active configuration should be cacheable.
- Preview generation must be asynchronous and provide clear processing states.
- SDK components should avoid unnecessary rerenders.
- An AI outage must not stop the host application from functioning.

## 13.2 Reliability

- Publishing must not leave configuration in a partially activated state.
- Configuration records must remain durable across server restarts.
- Failed proposal generation must not corrupt published versions.
- Rollback must remain available when the AI provider is unavailable.

## 13.3 Security

- Validate all proposals server-side.
- Never execute raw AI-generated JavaScript in the application runtime.
- Never let an LLM authorize its own output.
- Enforce application permissions independently of model responses.
- Treat natural-language inputs and retrieved content as untrusted.
- Prevent cross-tenant data leakage.
- Redact secrets and sensitive data from model inputs.
- Use approved components and registered adapters only.
- Record privileged actions for auditability.

## 13.4 Compatibility

- React and TypeScript are first-class for v0.1.
- SSR and hydration behavior must be tested before claiming Next.js compatibility.
- Other UI frameworks are not in the initial support scope.
- EvolveKit must not require replacement of the application's existing authentication system.

## 13.5 Accessibility

- All provided UI components must support keyboard interaction.
- Preview states must be clearly communicated.
- Approval and rejection controls must be accessible.
- The SDK should support host-application theming.

# 14. MVP Definition

The MVP will demonstrate EvolveKit in two independent React applications.

## Supported Changes

1. Add a filter to a registered table.
2. Show or hide registered columns.
3. Reorder registered columns.
4. Create a saved table view.

## Required Flow

A user must be able to:

1. Enter a natural-language improvement request.
2. Receive a validated structured proposal.
3. Test the proposed change in an interactive preview.
4. Submit the proposal for approval.
5. Obtain approval from an authorized user.
6. Publish the change.
7. View the activated feature after refresh.
8. Roll back to an earlier configuration.

## Explicitly Excluded from the MVP

- Arbitrary React code generation
- Arbitrary backend code generation
- AI-generated database migrations
- Autonomous deployment
- Production write operations from previews
- External service integrations generated on demand
- Cross-framework UI support
- Self-modifying executable code
- Fully autonomous business process generation

# 15. Development Roadmap

## Phase 1 — Core Runtime Foundation

**Goal:** Prove that an existing React application can change supported behavior through validated configuration.

Deliverables:

- Monorepo setup
- Core package
- React provider
- Capability registry
- EvolvableTable
- Configuration validator
- Manual configuration switching
- Initial demo application

**Exit Criteria:** A registered table supports configuration changes without recompilation.

## Phase 2 — AI-Powered Proposals

**Goal:** Translate supported user requests into structured changes.

Deliverables:

- AI provider interface
- Structured proposal schema
- AI planner
- Proposal persistence
- Unsupported-request handling
- Server validation

**Exit Criteria:** Natural-language requests reliably produce valid supported proposals or understandable rejections.

## Phase 3 — Preview System

**Goal:** Allow users to test proposed behavior before publishing.

Deliverables:

- Interactive preview
- Synthetic data integration
- Current/proposed comparison
- Draft isolation
- Preview state management

**Exit Criteria:** A user can test a proposed filter without changing the published application.

## Phase 4 — Approval and Publishing

**Goal:** Safely activate approved changes.

Deliverables:

- Role-based permissions
- Approval lifecycle
- Immutable proposal revisions
- Versioned configurations
- Runtime activation
- Rollback
- Audit events

**Exit Criteria:** Only authorized users can publish a validated configuration and restore an earlier version.

## Phase 5 — Reusability Validation

**Goal:** Prove that EvolveKit is an SDK rather than an application-specific feature.

Deliverables:

- Second React application integration
- Public integration documentation
- Example projects
- Package builds
- Automated integration tests
- Initial developer release

**Exit Criteria:** Both demo applications use the same SDK packages and core contracts without application-specific logic inside the SDK.

# 16. Future Roadmap

## Version 0.2 — Expanded Runtime Evolution

Potential capabilities:

- Dynamic form field presentation
- Saved dashboard layouts
- Predefined workflow automation
- Conditional visibility rules
- Additional data adapters
- Scoped feature activation
- Better application-aware AI planning

## Version 0.3 — Code Evolution Prototype

Potential capabilities:

- GitHub repository integration
- Source-code indexing
- Coding-agent execution
- Isolated Git worktrees
- Containerized development environments
- Generated pull requests
- Automated test execution
- Preview deployments

## Version 0.4 — Advanced Controlled Evolution

Potential capabilities:

- Multi-file change planning
- Developer review workflows
- Application contract verification
- Dependency compatibility checks
- Change-impact analysis
- Staged rollouts
- Automatic rollback triggers based on configured health checks

## Long-Term Vision

EvolveKit should eventually allow applications to support the following interaction:

**User describes a feature → Application understands the request → Proposed implementation is generated → User tests a realistic working preview → Authorized stakeholders approve → Validated changes are deployed → Application evolves.**

The broader system must preserve human control and developer ownership.

# 17. Success Metrics

## 17.1 MVP Technical Metrics

- Successful SDK integration in two independent applications.
- All supported capabilities pass automated validation tests.
- No unauthorized configuration publishing in access-control tests.
- All published runtime configurations have recoverable version history.
- No mutation of production application data during preview tests.
- Existing application remains usable when AI services are unavailable.

## 17.2 Product Validation Metrics

Initial pilot targets:

- At least five external developers attempt SDK integration.
- At least three developers successfully integrate a supported capability without direct assistance.
- Median time to first working preview below 30 minutes for the documented demo setup.
- At least 80% of a curated supported-request test set generates valid proposals.
- At least 90% of curated unsafe or unsupported requests are rejected appropriately.
- At least three pilot users complete the request-to-approved-change workflow.

These are validation targets, not current achievements.

## 17.3 Longer-Term Adoption Indicators

- Weekly active integrated applications
- Successful published changes
- Percentage of previews approved
- Average number of revisions per proposal
- Frequency of rollback
- Developer integration time
- Repeat usage by application teams
- Support issues per integration

# 18. Major Risks and Mitigations

| Risk | Mitigation |
|---|---|
| AI generates unsupported features | Strict capability registry and schema validation |
| AI proposes unauthorized operations | Server-side authorization and allowlisted operations |
| Feature preview differs from published behavior | Shared renderer and configuration contracts |
| Changes break existing layouts | Component validation and automated tests |
| Conflicting proposals overwrite changes | Immutable versions and optimistic concurrency controls |
| Tenant data becomes exposed | Tenant-scoped storage, retrieval, and permissions |
| AI service becomes unavailable | Existing application remains functional |
| SDK is too complex to integrate | Small first API, examples, reusable adapters |
| Product becomes another low-code builder | Focus on evolution of existing apps and in-context requests |
| Runtime model cannot support novel functionality | Separate future Code Evolution engine |
| Generated code introduces vulnerabilities | Future isolated execution, human code review, security gates |

# 19. Dependencies and Assumptions

The MVP assumes that:

- The consuming application uses React.
- Developers can modify their application to install the SDK.
- Developers can register compatible pages and components.
- The application exposes the relevant data through secure adapters.
- An authenticated backend is available.
- The application owner is willing to configure approval permissions.
- The proposed MVP changes fit within registered runtime capabilities.

EvolveKit v0.1 does not automatically understand arbitrary application source code.

That limitation is intentional and must be clearly documented.

# 20. Open Product Decisions

The following decisions should be resolved during technical design:

1. Should capability definitions be registered entirely in code or partially through server-managed metadata?
2. Should EvolveKit offer a hosted backend, self-hosted backend, or both?
3. Should the SDK supply opinionated UI components or support adapters for existing component libraries?
4. How should server-side query adapters interpret supported filter configurations?
5. Should approval be required for every change, or should administrators configure policies for low-risk changes?
6. How should organization-level and user-level configurations interact?
7. How should schema and capability version changes affect previously published configurations?
8. Should the first AI provider be fixed for MVP simplicity or configurable from the beginning?

**Recommended initial decisions:** Code-registered capabilities, self-hostable server, an opinionated table adapter with extensible contracts, mandatory approval, organization-scoped publication, and a narrow single-provider AI implementation behind a provider interface.

# 21. Definition of Done — EvolveKit v0.1

EvolveKit v0.1 is complete only when:

- A developer can integrate the SDK into an existing React application.
- The application registers its supported capabilities.
- A user can describe a supported improvement in natural language.
- The Evolution Planner creates a schema-valid proposal.
- Server-side capability and authorization checks pass.
- A functional preview is generated using safe data.
- The user can test and refine the proposal.
- An authorized approver can accept or reject the exact revision.
- The approved configuration is activated without rebuilding the application.
- The change survives refresh and server restart.
- A previous valid configuration can be restored.
- The same flow works in two separate React applications.
- Automated tests cover validation, authorization, publishing, rollback, and isolation.
- Integration documentation is sufficient for a developer unfamiliar with the project.

---

# 22. Final Product Statement

**EvolveKit is an application-evolution SDK that makes existing software adaptable through AI-assisted, human-approved changes.**

Its initial release focuses on controlled runtime customization.

Its long-term ambition is to enable safe source-code evolution, making the software development lifecycle accessible from within the applications themselves.

Rather than replacing existing technologies, EvolveKit builds on React, AI models, schema validation, sandboxing, version control, and established development workflows to introduce a new interaction between users and the software they depend on.

**Users request. Software proposes. Humans approve. Applications evolve.**
